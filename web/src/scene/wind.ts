// Champ de vent PARTAGÉ, consommé par l'herbe (grassField.ts, mission 04) ET
// les arbres instanciés (vegetation.ts, mission 08) : un seul temps, une
// seule direction, une seule force — un seul champ de vent, pas deux
// horloges qui divergent.
//
// Référence de concept : LAAS `render/Wind.ts` (hiérarchie fake-skeletal :
// lean ∝ force², sway à fréquence propre par instance, rafales advectées,
// branches en retard). Porté ici en GLSL injecté via `onBeforeCompile`, pas
// de WebGPU/TSL (Three.js 0.185 WebGLRenderer).
//
// RÈGLE D'OR (protégée par wind.test.ts) : la phase de l'oscillateur de sway
// est TOUJOURS `t * f_instance + phase0_instance`, jamais `t * f(t)`. Seule
// l'AMPLITUDE dépend de la force du vent (rafale) ; la FRÉQUENCE n'en dépend
// jamais — sinon la phase dérive et le feuillage « explose » après quelques
// minutes de session.

import * as THREE from "three";

// --- Constantes du modèle (aucun nombre magique ailleurs dans ce fichier) --

/** Force de vent par défaut du champ partagé (unité modèle, brise légère). */
const DEFAULT_WIND_FORCE = 0.5;

/** Lean max (déplacement latéral, unités monde) pour une force de vent = 1. */
const LEAN_COEFF = 0.6;

/** Amplitude du sway = cette fraction du lean courant (oscillation AUTOUR de
 *  la position penchée, pas un déplacement indépendant). */
const SWAY_AMPLITUDE_RATIO = 0.5;

/** Bornes de fréquence de sway (rad/s) tirées par instance depuis sa graine —
 *  jamais depuis la force du vent (cf. RÈGLE D'OR). */
const SWAY_FREQ_MIN = 1.6;
const SWAY_FREQ_MAX = 3.2;

/** Constantes de hash déterministe (sin-hash), même formule côté JS et GLSL
 *  pour que le modèle testé et le shader injecté restent en accord. */
const HASH_FREQ_A = 12.9898;
const HASH_FREQ_B = 78.233;
const HASH_SCALE_A = 43758.5453;
const HASH_SCALE_B = 12543.987;

/** Rafale = 2 octaves de bruit advecté (périodes en secondes, poids relatifs,
 *  déphasage pour éviter un battement symétrique visible entre les octaves). */
const GUST_PERIOD_A = 5.3;
const GUST_PERIOD_B = 1.7;
const GUST_OCTAVE_A_WEIGHT = 0.35;
const GUST_OCTAVE_B_WEIGHT = 0.15;
const GUST_PHASE_B_OFFSET = 1.9;

/** Vitesse d'advection spatiale de la rafale le long de la direction du vent
 *  (m/s) : la rafale « voyage » dans le champ au lieu d'être synchrone partout. */
const GUST_ADVECTION_SPEED = 2.2;

const TWO_PI = Math.PI * 2;

// --- Modèle pur (testé par wind.test.ts) ------------------------------------

function fract(x: number): number {
  return x - Math.floor(x);
}

/** Hash déterministe dans [0, 1[ à partir d'une graine (sin-hash classique). */
function hash(seed: number, freq: number, scale: number): number {
  return fract(Math.sin(seed * freq) * scale);
}

/** Lean (inclinaison globale) pour une force de vent donnée. Monotone
 *  croissante, ∝ force² : une rafale deux fois plus forte penche 4×. */
export function windLean(force: number): number {
  return LEAN_COEFF * force * force;
}

/** Fréquence de sway d'une instance — dépend UNIQUEMENT de sa graine, jamais
 *  de la force du vent. `force` est accepté pour la symétrie d'API avec
 *  `windLean`/`windOffset` mais n'a aucun effet : ce test d'invariance
 *  protège la RÈGLE D'OR contre une régression future. */
export function swayFreq(seed: number, _force: number = 0): number {
  const h = hash(seed, HASH_FREQ_A, HASH_SCALE_A);
  return SWAY_FREQ_MIN + h * (SWAY_FREQ_MAX - SWAY_FREQ_MIN);
}

/** Décalage de phase propre à l'instance (dans [0, 2π[), pour décorréler des
 *  voisines qui partageraient sinon la même fréquence de base. */
export function swayPhaseOffset(seed: number): number {
  return hash(seed, HASH_FREQ_B, HASH_SCALE_B) * TWO_PI;
}

/** Phase de l'oscillateur au temps `t` (secondes) pour une instance : linéaire
 *  en `t` par construction (fréquence constante dans le temps) → aucune
 *  dérive ni saut, même après des heures de session (cf. RÈGLE D'OR). */
export function swayPhase(t: number, seed: number): number {
  return t * swayFreq(seed) + swayPhaseOffset(seed);
}

/** Déplacement total (lean + sway) au temps `t`, pour une force de vent et
 *  une instance données. Repos (0) quand la force est nulle, quel que soit `t`. */
export function windOffset(t: number, force: number, seed: number): number {
  const lean = windLean(force);
  const amplitude = lean * SWAY_AMPLITUDE_RATIO;
  return lean + amplitude * Math.sin(swayPhase(t, seed));
}

// --- Champ de vent partagé (un seul, consommé par 04 et 08) ---------------

/** Uniforms partagés par TOUS les matériaux « vent » — un seul temps, une
 *  seule direction, une seule force. On mute `.value`, jamais on ne recrée
 *  l'objet : tous les matériaux clonés y pointent (cf. `applyWind`). */
export const windUniforms: {
  uTime: { value: number };
  uWindDirection: { value: THREE.Vector2 };
  uWindForce: { value: number };
} = {
  uTime: { value: 0 },
  uWindDirection: { value: new THREE.Vector2(1, 0) },
  uWindForce: { value: DEFAULT_WIND_FORCE },
};

/** Avance l'horloge du champ de vent (appelé une fois par frame depuis la
 *  boucle de rendu, temps écoulé en secondes depuis le lancement). */
export function setWindTime(elapsedSeconds: number): void {
  windUniforms.uTime.value = elapsedSeconds;
}

/** Change la direction/force du vent (ambiance, météo…). La direction n'a
 *  pas besoin d'être normalisée : elle l'est côté shader. */
export function setWindField(directionXZ: THREE.Vector2, force: number): void {
  windUniforms.uWindDirection.value.copy(directionXZ);
  windUniforms.uWindForce.value = force;
}

// --- Pools (paramétrage par famille d'objet) --------------------------------

export interface WindPool {
  /** Identifiant unique → clé de cache de programme (un seul programme WebGL
   *  compilé par pool, cf. `THREE.Material.customProgramCacheKey`). */
  readonly cacheKey: string;
  /** Multiplicateur de lean/sway : tige souple (herbe) > tronc rigide. */
  readonly leanScale: number;
  /** Exposant hauteur→poids de l'attribut `aWindWeight` : herbe cantilever
   *  ≈ 2 (la pointe bouge bien plus que la base), arbre plus rigide ≈ 1. */
  readonly tipExponent: number;
}

export const GRASS_WIND_POOL: WindPool = { cacheKey: "wind-grass", leanScale: 1, tipExponent: 2 };
export const RIGID_TREE_WIND_POOL: WindPool = { cacheKey: "wind-tree-rigid", leanScale: 0.35, tipExponent: 1 };
export const SOFT_TREE_WIND_POOL: WindPool = { cacheKey: "wind-tree-soft", leanScale: 0.7, tipExponent: 1.3 };

// --- Géométrie : attribut de poids par vertex --------------------------------

/** Ajoute l'attribut `aWindWeight` : 0 à la base du mesh, jusqu'à 1 au sommet
 *  (bounding box Y), passé par `pool.tipExponent` (cantilever) — le poids du
 *  vent croît avec la hauteur, plus vite pour un pool cantilever (herbe). */
export function addWindWeightAttribute(geo: THREE.BufferGeometry, pool: WindPool): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const yMin = geo.boundingBox!.min.y;
  const yRange = geo.boundingBox!.max.y - yMin || 1;
  const weight = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - yMin) / yRange;
    weight[i] = Math.pow(h, pool.tipExponent);
  }
  geo.setAttribute("aWindWeight", new THREE.BufferAttribute(weight, 1));
}

// --- Injection shader --------------------------------------------------------

/** `#define` figeant les constantes du modèle à la compilation (pas d'uniform
 *  supplémentaire pour des valeurs qui ne changent jamais à l'exécution). */
function windGlslDefines(pool: WindPool): string {
  return `
    #define WIND_LEAN_COEFF ${LEAN_COEFF.toFixed(6)}
    #define WIND_SWAY_RATIO ${SWAY_AMPLITUDE_RATIO.toFixed(6)}
    #define WIND_FREQ_MIN ${SWAY_FREQ_MIN.toFixed(6)}
    #define WIND_FREQ_MAX ${SWAY_FREQ_MAX.toFixed(6)}
    #define WIND_HASH_FREQ_A ${HASH_FREQ_A.toFixed(6)}
    #define WIND_HASH_FREQ_B ${HASH_FREQ_B.toFixed(6)}
    #define WIND_HASH_SCALE_A ${HASH_SCALE_A.toFixed(6)}
    #define WIND_HASH_SCALE_B ${HASH_SCALE_B.toFixed(6)}
    #define WIND_GUST_PERIOD_A ${GUST_PERIOD_A.toFixed(6)}
    #define WIND_GUST_PERIOD_B ${GUST_PERIOD_B.toFixed(6)}
    #define WIND_GUST_WEIGHT_A ${GUST_OCTAVE_A_WEIGHT.toFixed(6)}
    #define WIND_GUST_WEIGHT_B ${GUST_OCTAVE_B_WEIGHT.toFixed(6)}
    #define WIND_GUST_PHASE_B ${GUST_PHASE_B_OFFSET.toFixed(6)}
    #define WIND_GUST_ADVECTION ${GUST_ADVECTION_SPEED.toFixed(6)}
    #define WIND_TWO_PI ${TWO_PI.toFixed(6)}
    #define WIND_LEAN_SCALE ${pool.leanScale.toFixed(6)}
    attribute float aWindWeight;
    uniform float uTime;
    uniform vec2 uWindDirection;
    uniform float uWindForce;
    uniform float uWindSeedOffset;
  `;
}

/** Injecté dans `#include <begin_vertex>` : calcule le déplacement du vent
 *  pour ce vertex et le somme dans `transformed`. Miroir GLSL de
 *  `windOffset` (JS), avec en plus l'advection spatiale de la rafale.
 *  RÈGLE D'OR : `_windFreq` ne dépend ni du temps ni de la force — seule
 *  l'amplitude (`_windLean`/`_windSway`) dépend de `_windForce`. */
function windGlslDisplacement(): string {
  return `
    #include <begin_vertex>
    #ifdef USE_INSTANCING
      vec2 _windOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    #else
      vec2 _windOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    #endif
    vec2 _windDir = normalize(uWindDirection);
    float _windAdvT = uTime - dot(_windOrigin, _windDir) / WIND_GUST_ADVECTION;
    float _windGust = 1.0
      + WIND_GUST_WEIGHT_A * sin(_windAdvT * (WIND_TWO_PI / WIND_GUST_PERIOD_A))
      + WIND_GUST_WEIGHT_B * sin(_windAdvT * (WIND_TWO_PI / WIND_GUST_PERIOD_B) + WIND_GUST_PHASE_B);
    float _windForce = uWindForce * max(_windGust, 0.0);
    float _windSeed = float(gl_InstanceID) + uWindSeedOffset;
    float _windFreq = mix(WIND_FREQ_MIN, WIND_FREQ_MAX, fract(sin(_windSeed * WIND_HASH_FREQ_A) * WIND_HASH_SCALE_A));
    float _windPhase0 = fract(sin(_windSeed * WIND_HASH_FREQ_B) * WIND_HASH_SCALE_B) * WIND_TWO_PI;
    float _windLean = WIND_LEAN_COEFF * _windForce * _windForce * WIND_LEAN_SCALE;
    float _windSway = _windLean * WIND_SWAY_RATIO * sin(uTime * _windFreq + _windPhase0);
    float _windMag = (_windLean + _windSway) * aWindWeight;
    transformed.x += _windDir.x * _windMag;
    transformed.z += _windDir.y * _windMag;
  `;
}

export interface ApplyWindOptions {
  /** Pool (famille d'objet) : herbe, arbre rigide, arbre souple… */
  readonly pool: WindPool;
  /** Décalage ajouté à `gl_InstanceID` pour décorréler deux `InstancedMesh`
   *  distincts qui partageraient sinon les mêmes graines d'instance (0, 1…). */
  readonly seedOffset?: number;
}

/** Clone `src` et y injecte le champ de vent partagé (temps/direction/force
 *  communs, cf. `windUniforms`). Un seul programme WebGL compilé par pool
 *  (`customProgramCacheKey`) : les constantes du modèle sont figées en
 *  `#define` à la compilation plutôt qu'en uniforms redondants. Nécessite
 *  l'attribut `aWindWeight` sur la géométrie (cf. `addWindWeightAttribute`). */
export function applyWind(src: THREE.Material, opts: ApplyWindOptions): THREE.Material {
  const { pool, seedOffset = 0 } = opts;
  const mat = src.clone();
  mat.customProgramCacheKey = () => pool.cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindDirection = windUniforms.uWindDirection;
    shader.uniforms.uWindForce = windUniforms.uWindForce;
    shader.uniforms.uWindSeedOffset = { value: seedOffset };
    shader.vertexShader = windGlslDefines(pool) + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", windGlslDisplacement());
  };
  return mat;
}
