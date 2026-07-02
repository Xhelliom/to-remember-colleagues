// Grade filmique split teal/orange, couplé à l'heure via `ambiance.ts`
// (`getFilmGrade`). Passe `ShaderPass` additive dans l'EffectComposer existant
// (main.ts), gate `?post=1` — n'affecte jamais le rendu par défaut.

import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { FilmGrade } from "../../ambiance.ts";

const LUMA_WEIGHTS = new THREE.Vector3(0.2126, 0.7152, 0.0722);

const GRADE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GRADE_FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uContrast;
  uniform float uSaturation;
  uniform vec3 uLumaWeights;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, uLumaWeights);
    vec3 saturated = mix(vec3(l), c.rgb, uSaturation);
    // Split teal/orange : les tons sombres tirent vers uShadowTint, les hautes
    // lumières vers uHighlightTint (transition douce autour du gris moyen).
    vec3 tinted = saturated * mix(uShadowTint, uHighlightTint, smoothstep(0.15, 0.85, l));
    vec3 graded = (tinted - 0.5) * uContrast + 0.5;
    gl_FragColor = vec4(clamp(graded, 0.0, 1.0), c.a);
  }
`;

/** Shader d'étalonnage filmique — uniforms neutres par défaut, ajustés via
 *  `applyFilmGrade`. Exposé pour être réutilisé tel quel par `ShaderPass`. */
export const GOLDEN_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uHighlightTint: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uSaturation: { value: 1 },
    uLumaWeights: { value: LUMA_WEIGHTS },
  },
  vertexShader: GRADE_VERTEX_SHADER,
  fragmentShader: GRADE_FRAGMENT_SHADER,
};

/** Construit la passe de grade filmique (uniforms neutres, à peupler via
 *  `applyFilmGrade`). */
export function createGoldenGradePass(): ShaderPass {
  return new ShaderPass(GOLDEN_GRADE_SHADER);
}

/** Pousse un `FilmGrade` (issu de `ambiance.ts`, couplé à l'heure) dans les
 *  uniforms de la passe. */
export function applyFilmGrade(pass: ShaderPass, grade: FilmGrade): void {
  (pass.uniforms.uShadowTint.value as THREE.Vector3).set(...grade.shadowTint);
  (pass.uniforms.uHighlightTint.value as THREE.Vector3).set(...grade.highlightTint);
  pass.uniforms.uContrast.value = grade.contrast;
  pass.uniforms.uSaturation.value = grade.saturation;
}
