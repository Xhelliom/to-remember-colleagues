// Pierre procédurale (issue #25) — icosphère soudée déformée par un champ de bruit
// en couches (macro warp + strates inclinées + fissures + grain), qui alimente à la
// fois les rochers de décor (`buildRock`) et les stèles de tombes (`graveStone.ts`,
// via `sampleWeathering` réutilisé — DRY, un seul système de pierre altérée).
//
// Référence de CONCEPT : LAAS `vegetation/RockBuilder.ts` (icosphère → squash → warp
// macro → strates → fractures → grain, avec un `vdata` hue/strata/cavité/mousse par
// sommet). Ici en Three.js WebGLRenderer pur, bruit réutilisé depuis `noiseBake.ts`
// (mission 03) plutôt que ré-inventé — jamais de `Math.random()`.
//
// Le bruit est échantillonné au moment de la CONSTRUCTION du maillage (une fois par
// rocher/stèle, côté CPU), jamais par pixel ni par frame : c'est la même discipline
// que le bake de `noiseBake.ts`, appliquée ici à de la géométrie plutôt qu'à une texture.
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEFAULT_RESOLUTION, evalNoiseAt } from "./noiseBake.ts";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// --- Seuil de fissure : au-dessus, la crête de bruit "ridged" est considérée comme
// une fracture visible. `crackIntensity` (0..1, dérivé de l'entretien/votes côté
// consommateur) abaisse ce seuil → davantage de sommets comptent comme fissurés. ---
// Calibrés empiriquement sur la distribution réelle de `ridged` (concentrée en
// [0.65, 0.95] — voir noiseBake.ts) : un seuil à 0.82/0.32 saturerait quasi tous les
// sommets quel que soit `crackIntensity`, faute de couvrir la plage effective du bruit.
const CRACK_THRESHOLD_MAX = 0.93; // crackIntensity = 0 : quasi aucune fissure qualifiée
const CRACK_THRESHOLD_MIN = 0.65; // crackIntensity = 1 : fissures fréquentes
/** Seuil de fissure pour une intensité donnée — MAX (peu fissuré) → MIN (très fissuré). */
export function crackThreshold(intensity: number): number {
  const t = clamp01(intensity);
  return CRACK_THRESHOLD_MAX + (CRACK_THRESHOLD_MIN - CRACK_THRESHOLD_MAX) * t;
}

const MOSS_CAVITY_WEIGHT = 0.6; // poids de la cavité (creux) vs. de l'ombrage (value) dans l'ouverture à la mousse

/** Paramètres de forme du champ d'altération — indépendants de tout axe de jeu :
 *  `graveStone.ts` les dérive de `GraveAxes`, un décor de rocher les fixe en dur. */
export type WeatheringParams = {
  /** Amplitude de la déformation macro (basse fréquence), en unités du rayon. */
  warpAmplitude: number;
  /** Nombre de strates (bandes) visibles sur la circonférence. */
  strataCount: number;
  /** Cisaillement des strates selon `v` — incline les bandes plutôt que des anneaux plats. */
  strataTilt: number;
  /** Amplitude du relief entre strates. */
  strataAmplitude: number;
  /** 0..1 — probabilité/étendue des fissures (pilote `crackThreshold`). */
  crackIntensity: number;
  /** Profondeur (en unités du rayon) des entailles de fissure. */
  crackDepth: number;
  /** Amplitude du grain micro (bruit haute fréquence). */
  grainAmplitude: number;
};

export type WeatheringSample = {
  /** Déplacement signé le long de la normale/direction, unités du rayon. */
  displacement: number;
  /** [0,1] teinte brute (variation de couleur grain-scale). */
  hue: number;
  /** [0,1] position dans la strate courante. */
  strataT: number;
  /** [0,1] occlusion approx. dans les creux (1 = creux profond). */
  cavityAO: number;
  /** [0,1] potentiel d'accroche de la mousse/lichen (creux + zones ombrées). */
  mossOpenness: number;
  /** [0,1] intensité de crête "ridged" au point — sert à compter les fissures via seuil. */
  crackStrength: number;
};

/**
 * Échantillon du champ d'altération en un point (u, v) ∈ [0,1)² — réutilisé tel quel
 * par `buildRock` (UV sphérique) et `graveStone.ts` (UV planaire sur la stèle) : un
 * seul système de pierre usée/fissurée/moussue pour tout le jeu.
 */
export function sampleWeathering(u: number, v: number, seed: number, p: WeatheringParams): WeatheringSample {
  const n = evalNoiseAt(seed, u, v, DEFAULT_RESOLUTION);

  // Strates inclinées : cisaille `u` par `v` avant de découper en bandes périodiques.
  const sheared = u + v * p.strataTilt;
  const bandRaw = sheared * p.strataCount;
  const strataT = bandRaw - Math.floor(bandRaw);
  const strataWave = Math.sin(strataT * Math.PI * 2) * p.strataAmplitude;

  // Fissures : entaille négative où la crête "ridged" dépasse le seuil dérivé de l'intensité.
  const crackStrength = n.ridged;
  const threshold = crackThreshold(p.crackIntensity);
  const crackCarve = crackStrength > threshold ? -(crackStrength - threshold) * p.crackDepth : 0;

  const grain = (n.value - 0.5) * p.grainAmplitude;
  const macro = n.fbm * p.warpAmplitude;
  const displacement = macro + strataWave + crackCarve + grain;

  const cavityAO = clamp01(1 - n.worley);
  const mossOpenness = clamp01(cavityAO * MOSS_CAVITY_WEIGHT + (1 - n.value) * (1 - MOSS_CAVITY_WEIGHT));

  return { displacement, hue: n.value, strataT, cavityAO, mossOpenness, crackStrength };
}

// --- Rocher (icosphère soudée) ---

export type RockParams = {
  radius: number;
  /** Niveau de subdivision de l'icosphère (0 = 20 tris ... N = 20·(N+1)²) — sert de LOD. */
  detail: number;
  /** Échelle non-uniforme appliquée après le bruit — aplati/étiré selon les axes. */
  squash: { x: number; y: number; z: number };
  weathering: WeatheringParams;
};

export type RockVertexData = {
  hue: Float32Array;
  strataT: Float32Array;
  cavityAO: Float32Array;
  mossOpenness: Float32Array;
  crackStrength: Float32Array;
};

export type Rock = { geometry: THREE.BufferGeometry; vdata: RockVertexData };

const ROCK_HUE_BASE = 0.09; // gris-brun neutre
const ROCK_HUE_RANGE = 0.04;
const ROCK_SATURATION = 0.12;
const ROCK_LIGHTNESS_MIN = 0.28; // au fond des creux (cavityAO = 1)
const ROCK_LIGHTNESS_RANGE = 0.22;

/** Préréglage d'altération neutre pour un rocher de décor (pas d'axes de jeu). */
export const DEFAULT_ROCK_WEATHERING: WeatheringParams = {
  warpAmplitude: 0.14,
  strataCount: 4,
  strataTilt: 0.8,
  strataAmplitude: 0.03,
  crackIntensity: 0.35,
  crackDepth: 0.09,
  grainAmplitude: 0.02,
};

/** Construit des `RockParams` par défaut pour un rocher de décor de rayon/detail donnés. */
export function defaultRockParams(radius: number, detail: number): RockParams {
  return { radius, detail, squash: { x: 1, y: 0.82, z: 1 }, weathering: DEFAULT_ROCK_WEATHERING };
}

/**
 * Construit un rocher : icosphère soudée (positions/normales fusionnées par position,
 * sans les UV qui dupliqueraient la couture) déplacée par `sampleWeathering`, avec un
 * `vdata` par sommet (hue/strataT/cavityAO/mossOpenness/crackStrength — les deux
 * derniers alimentent le dressing mission 07). Même `seed`/`weathering` à un `detail`
 * différent → même champ échantillonné → silhouette cohérente entre LODs.
 */
export function buildRock(params: RockParams, seed: number): Rock {
  const raw = new THREE.IcosahedronGeometry(1, params.detail);
  raw.deleteAttribute("uv"); // pas de couture UV : on veut une vraie soudure par position
  raw.deleteAttribute("normal"); // recalculées après déplacement
  const geometry = mergeVertices(raw) as THREE.BufferGeometry;

  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const count = pos.count;
  const vdata: RockVertexData = {
    hue: new Float32Array(count),
    strataT: new Float32Array(count),
    cavityAO: new Float32Array(count),
    mossOpenness: new Float32Array(count),
    crackStrength: new Float32Array(count),
  };
  const colors = new Float32Array(count * 3);
  const dir = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    const u = 0.5 + Math.atan2(dir.z, dir.x) / (Math.PI * 2);
    const v = 0.5 - Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / Math.PI;
    const s = sampleWeathering(u, v, seed, params.weathering);
    vdata.hue[i] = s.hue;
    vdata.strataT[i] = s.strataT;
    vdata.cavityAO[i] = s.cavityAO;
    vdata.mossOpenness[i] = s.mossOpenness;
    vdata.crackStrength[i] = s.crackStrength;

    const r = params.radius + s.displacement * params.radius;
    pos.setXYZ(i, dir.x * params.squash.x * r, dir.y * params.squash.y * r, dir.z * params.squash.z * r);

    const lightness = ROCK_LIGHTNESS_MIN + (1 - s.cavityAO) * ROCK_LIGHTNESS_RANGE;
    color.setHSL(ROCK_HUE_BASE + s.hue * ROCK_HUE_RANGE, ROCK_SATURATION, lightness);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return { geometry, vdata };
}
