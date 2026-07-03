// Brume de hauteur ANALYTIQUE, calculée par fragment à partir du depth buffer déjà
// rendu (reconstruction position-monde) — PAS de froxels (grille volumétrique). Passe
// additive dans l'EffectComposer existant (main.ts), gate `?post=1`. Sélective par
// construction (opacité plafonnée `MAX_FOG_OPACITY`) : ne devient jamais un
// « fog-as-cover » qui masquerait toute la scène.

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

// --- Constantes (aucun nombre magique ailleurs dans ce fichier) ------------

const DEFAULT_FOG_HEIGHT = 2; // échelle caractéristique (m) : facteur ≈ 1/e à cette hauteur
const DEFAULT_FOG_DENSITY = 0.04; // atténuation exponentielle par distance (1/m)
const DEFAULT_FOG_COLOR = new THREE.Color(0x8b9aa0);
const MAX_FOG_OPACITY = 0.75; // jamais 100% opaque — « sélective, sans fog-as-cover »

export type GroundFogParams = {
  readonly height?: number;
  readonly density?: number;
  readonly color?: THREE.Color;
};

// --- Modèle pur (testé par groundFog.test.ts) -------------------------------

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Facteur de brume dû à la hauteur (0..1) — décroissance exponentielle
 *  au-dessus du sol (y=0). MONOTONE décroissant : jamais de brume qui « couvre »
 *  le ciel en altitude. */
export function heightFogFactor(worldY: number, fogHeight: number = DEFAULT_FOG_HEIGHT): number {
  const above = Math.max(0, worldY);
  return clamp01(Math.exp(-above / fogHeight));
}

/** Facteur de brume dû à la distance caméra→fragment (0..1) — croissant avec la
 *  distance (même forme que `THREE.FogExp2`, réutilisée en analytique post). */
export function distanceFogFactor(distance: number, density: number = DEFAULT_FOG_DENSITY): number {
  return clamp01(1 - Math.exp(-density * Math.max(0, distance)));
}

/** Opacité finale de la brume (0..MAX_FOG_OPACITY) pour un fragment donné. */
export function groundFogOpacity(
  worldY: number,
  distance: number,
  fogHeight: number = DEFAULT_FOG_HEIGHT,
  density: number = DEFAULT_FOG_DENSITY,
): number {
  return Math.min(MAX_FOG_OPACITY, heightFogFactor(worldY, fogHeight) * distanceFogFactor(distance, density));
}

// --- Passe GPU ---------------------------------------------------------------

const FOG_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FOG_FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform mat4 uProjectionInverse;
  uniform mat4 uViewInverse;
  uniform vec3 uFogColor;
  uniform float uFogHeight;
  uniform float uFogDensity;
  uniform float uMaxOpacity;
  varying vec2 vUv;

  vec3 worldPositionAt(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjectionInverse * clip;
    view /= view.w;
    vec4 world = uViewInverse * view;
    return world.xyz;
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    vec3 worldPos = worldPositionAt(vUv);
    vec3 camPos = uViewInverse[3].xyz;
    float dist = distance(worldPos, camPos);
    float heightFactor = clamp(exp(-max(0.0, worldPos.y) / uFogHeight), 0.0, 1.0);
    float distFactor = clamp(1.0 - exp(-uFogDensity * dist), 0.0, 1.0);
    float opacity = min(uMaxOpacity, heightFactor * distFactor);
    gl_FragColor = vec4(mix(color.rgb, uFogColor, opacity), color.a);
  }
`;

/**
 * Reconstruit la position monde par fragment à partir du depth buffer (matrices
 * inverses de la caméra) et mélange une brume de hauteur analytique. Nécessite un
 * `readBuffer.depthTexture` (voir `createFogRenderTarget`) — si absent, la passe
 * est un no-op sûr (`needsSwap = false`, buffer inchangé).
 */
export class GroundFogPass extends Pass {
  private readonly camera: THREE.Camera;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor(camera: THREE.Camera, params: GroundFogParams = {}) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uProjectionInverse: { value: new THREE.Matrix4() },
        uViewInverse: { value: new THREE.Matrix4() },
        uFogColor: { value: (params.color ?? DEFAULT_FOG_COLOR).clone() },
        uFogHeight: { value: params.height ?? DEFAULT_FOG_HEIGHT },
        uFogDensity: { value: params.density ?? DEFAULT_FOG_DENSITY },
        uMaxOpacity: { value: MAX_FOG_OPACITY },
      },
      vertexShader: FOG_VERTEX_SHADER,
      fragmentShader: FOG_FRAGMENT_SHADER,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const depthTexture = readBuffer.depthTexture;
    this.needsSwap = depthTexture !== null;
    if (!depthTexture) return; // pas de depthTexture attachée : no-op sûr (voir createFogRenderTarget)

    const cam = this.camera as THREE.PerspectiveCamera;
    const uniforms = this.material.uniforms;
    uniforms.tDiffuse.value = readBuffer.texture;
    uniforms.tDepth.value = depthTexture;
    (uniforms.uProjectionInverse.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (uniforms.uViewInverse.value as THREE.Matrix4).copy(cam.matrixWorld);

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * Construit le render target à passer à `new EffectComposer(renderer, target)` pour
 * que le buffer porte une `depthTexture` (nécessaire à `GroundFogPass`). Un seul
 * target suffit : `EffectComposer` clone ce target pour son second buffer, chacun
 * avec SA PROPRE depthTexture (voir `RenderTarget.copy()`).
 */
export function createFogRenderTarget(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const width = Math.max(1, Math.round(size.width * pixelRatio));
  const height = Math.max(1, Math.round(size.height * pixelRatio));
  const depthTexture = new THREE.DepthTexture(width, height);
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthTexture });
}
