// Auto-exposition GPU : downsample de l'image déjà rendue vers 1×1 (moyenne de
// luminance stratifiée), lecture CPU, puis adaptation temporelle → exposition du
// renderer. Référence LAAS : « GPU auto-exposure ». S'insère dans l'EffectComposer
// existant (main.ts) comme une passe supplémentaire qui ne modifie JAMAIS le buffer
// visible (`needsSwap = false`) — un pur effet de bord sur `renderer.toneMappingExposure`.
//
// ponytail: pas de chaîne de mips GPU (lecture d'un niveau de mip précis n'est pas
// exposée simplement par WebGLRenderer) — un pass unique à cible 1×1 avec une grille
// de prises stratifiées sur toute l'image est équivalent pour du metering d'exposition,
// beaucoup plus simple. Upgrade path : vraie chaîne de mips si un jour le coût des
// prises devient mesurable (il ne l'est pas : 64 texture2D sur 1 pixel).

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

// --- Constantes (aucun nombre magique ailleurs dans ce fichier) ------------

const METER_TARGET_SIZE = 1; // downsample cible : 1×1 (moyenne de toute l'image)
const METER_SAMPLE_TAPS = 8; // grille TAPS×TAPS de prises stratifiées sur l'image entière
// Metering pondéré sol/centre (classique photo/jeu) : le ciel occupe une large
// part du cadre et est nettement plus lumineux que le sol — sans ça, un ciel de
// jour tire l'exposition vers le bas et écrase le sol/les arbres en noir.
const METER_GROUND_V_MAX = 0.6; // ne prend en compte que le tiers-bas..0,6 de l'image (v=1 = haut d'écran)
const DEFAULT_TARGET_LUMINANCE = 0.45; // luminance moyenne visée après exposition (0..1)
const DEFAULT_MIN_EXPOSURE = 0.4;
const DEFAULT_MAX_EXPOSURE = 2.2;
const DEFAULT_ADAPT_SPEED = 1.4; // vitesse d'adaptation temporelle (1/s) — plus grand = plus rapide
const MIN_MEASURABLE_LUMINANCE = 1e-4; // évite la division par ~0 en scène noire
const DEFAULT_INITIAL_EXPOSURE = 1;

export type AutoExposureParams = {
  readonly targetLuminance?: number;
  readonly minExposure?: number;
  readonly maxExposure?: number;
  readonly adaptSpeed?: number;
};

// --- Modèle pur (testé par autoExposure.test.ts) ----------------------------

/**
 * Exposition désirée pour une luminance moyenne mesurée — mapping MONOTONE
 * décroissant (scène plus lumineuse ⇒ exposition plus basse), clampé à
 * `[minExposure, maxExposure]`.
 */
export function luminanceToExposure(
  luminance: number,
  targetLuminance: number = DEFAULT_TARGET_LUMINANCE,
  minExposure: number = DEFAULT_MIN_EXPOSURE,
  maxExposure: number = DEFAULT_MAX_EXPOSURE,
): number {
  const safeLuminance = Math.max(luminance, MIN_MEASURABLE_LUMINANCE);
  const desired = targetLuminance / safeLuminance;
  return Math.min(maxExposure, Math.max(minExposure, desired));
}

/**
 * Adaptation temporelle exponentielle vers l'exposition désirée — jamais de saut
 * brusque (l'œil s'habitue progressivement à la lumière, cf. LAAS).
 */
export function adaptExposure(
  current: number,
  desired: number,
  dt: number,
  adaptSpeed: number = DEFAULT_ADAPT_SPEED,
): number {
  const blend = 1 - Math.exp(-adaptSpeed * Math.max(0, dt));
  return current + (desired - current) * blend;
}

// --- Passe GPU ---------------------------------------------------------------

const METER_VERTEX_SHADER = `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const METER_FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  void main() {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${METER_SAMPLE_TAPS}; i++) {
      for (int j = 0; j < ${METER_SAMPLE_TAPS}; j++) {
        float u = (float(i) + 0.5) / float(${METER_SAMPLE_TAPS});
        float v = (float(j) + 0.5) / float(${METER_SAMPLE_TAPS}) * ${METER_GROUND_V_MAX};
        sum += texture2D(tDiffuse, vec2(u, v)).rgb;
      }
    }
    vec3 avg = sum / float(${METER_SAMPLE_TAPS * METER_SAMPLE_TAPS});
    float lum = dot(avg, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(vec3(lum), 1.0);
  }
`;

/**
 * Passe d'auto-exposition. Ne modifie jamais le buffer visible — lit `readBuffer`,
 * en déduit une luminance moyenne, et pousse une exposition adaptée dans
 * `renderer.toneMappingExposure` (effective à partir de la frame SUIVANTE : léger
 * retard réaliste, cf. adaptation de l'œil).
 */
export class AutoExposurePass extends Pass {
  private readonly meterTarget: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly pixel = new Uint8Array(4);
  private readonly params: Required<AutoExposureParams>;
  currentExposure: number;

  constructor(params: AutoExposureParams = {}) {
    super();
    this.needsSwap = false;
    this.params = {
      targetLuminance: params.targetLuminance ?? DEFAULT_TARGET_LUMINANCE,
      minExposure: params.minExposure ?? DEFAULT_MIN_EXPOSURE,
      maxExposure: params.maxExposure ?? DEFAULT_MAX_EXPOSURE,
      adaptSpeed: params.adaptSpeed ?? DEFAULT_ADAPT_SPEED,
    };
    this.currentExposure = DEFAULT_INITIAL_EXPOSURE;
    this.meterTarget = new THREE.WebGLRenderTarget(METER_TARGET_SIZE, METER_TARGET_SIZE, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: METER_VERTEX_SHADER,
        fragmentShader: METER_FRAGMENT_SHADER,
      }),
    );
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime = 0,
  ): void {
    const material = this.quad.material as THREE.ShaderMaterial;
    material.uniforms.tDiffuse.value = readBuffer.texture;

    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.meterTarget);
    this.quad.render(renderer);
    renderer.readRenderTargetPixels(this.meterTarget, 0, 0, METER_TARGET_SIZE, METER_TARGET_SIZE, this.pixel);
    renderer.setRenderTarget(previousTarget);

    const luminance = this.pixel[0] / 255;
    const desired = luminanceToExposure(
      luminance,
      this.params.targetLuminance,
      this.params.minExposure,
      this.params.maxExposure,
    );
    this.currentExposure = adaptExposure(this.currentExposure, desired, deltaTime, this.params.adaptSpeed);
    renderer.toneMappingExposure = this.currentExposure;
  }

  dispose(): void {
    this.meterTarget.dispose();
    this.quad.dispose();
  }
}
