// Garde anti-NaN/Infini avant le bloom (chantier 2.5) : un pixel non fini (NaN ou
// Infini), une fois entré dans la chaîne de flou multi-mip d'UnrealBloomPass,
// contamine ses voisins à chaque passe et peut finir par couvrir tout l'écran d'un
// aplat noir — bug observé en session (herbe animée par le vent + bloom, cause
// exacte non isolée malgré investigation poussée). Cette passe est un filet de
// sécurité générique : elle ne corrige pas la cause, elle empêche un pixel
// non fini de se propager plus loin dans la chaîne de post-traitement.
import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

const NAN_GUARD_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NAN_GUARD_FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    bool bad = any(isnan(color.rgb)) || any(isinf(color.rgb));
    gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : color;
  }
`;

/** Remplace tout pixel non fini (NaN/Infini) par du noir — no-op sur une image saine. */
export class NanGuardPass extends Pass {
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: NAN_GUARD_VERTEX_SHADER,
      fragmentShader: NAN_GUARD_FRAGMENT_SHADER,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
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
