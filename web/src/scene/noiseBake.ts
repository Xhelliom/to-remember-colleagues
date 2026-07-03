// Bruit baké en textures (préprocess CPU au boot) — évite aux matériaux
// procéduraux (pierre 06, écorce 08, dressing 07, sol) d'évaluer du bruit
// live par pixel (LAAS `gpu/passes/NoiseBake.ts` : ~35 évals/px ≈ 52 ms/frame
// → 2 textures RGBA, avec les canaux gradient PRÉ-DÉRIVÉS pour tenir en 1
// fetch au lieu de 4 différences finies côté shader).
//
// 8 canaux répartis sur 2 DataTexture RGBA :
//   texA : R=value  G=fbm(3 oct)  B=d(fbm)/dx  A=d(fbm)/dz
//   texB : R=ridged G=d(ridged)/dx  B=d(ridged)/dz  A=worley F1
// Toutes les valeurs sont dérivées de `seed` via `hashSeed` (FNV-1a,
// procedural.ts) — jamais de Math.random(). MirroredRepeatWrapping rend le
// tuilage seamless par construction (réflexion au bord), sans exiger que le
// bruit lui-même soit périodique.
import * as THREE from "three";
import { hashSeed } from "../procedural.ts";

export const DEFAULT_RESOLUTION = 128; // côté (px) des textures bakées, au boot uniquement

// Fréquences (en cycles par tuile UV [0,1)) de chaque canal — const nommées,
// pas de magic number inline.
const PERIOD_VALUE = 4;
const PERIOD_FBM_BASE = 6;
const PERIOD_RIDGED_BASE = 5;
const PERIOD_WORLEY = 8;

const FBM_OCTAVES = 3;
const RIDGED_OCTAVES = 3;
const OCTAVE_LACUNARITY = 2; // fréquence x2 par octave
const OCTAVE_GAIN = 0.5;     // amplitude /2 par octave

/** Amplitude max attendue des canaux gradient — sert de plage de remap [-RANGE, RANGE] → octet.
 *  Bornée empiriquement (~14.5 au pire point, octave la plus haute fréquence du fbm/ridged) avec marge. */
export const GRADIENT_RANGE = 16;
const WORLEY_CLAMP = 1.5; // distance F1 max plausible (voisinage 3×3) avant normalisation [0,1]
const BYTE_MAX = 255;

/** Index des canaux RGBA de `texA` (value/fbm) et `texB` (ridged/worley) — évite les magic numbers côté consommateurs. */
export const NOISE_TEX_A_CHANNELS = { value: 0, fbm: 1, dFbmDx: 2, dFbmDz: 3 } as const;
export const NOISE_TEX_B_CHANNELS = { ridged: 0, dRidgedDx: 1, dRidgedDz: 2, worley: 3 } as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Encode une valeur [0,1] en octet (arrondi, sans remap de plage). */
function encodeUnit(v: number): number {
  return Math.round(clamp01(v) * BYTE_MAX);
}
/** Décode l'inverse de `encodeUnit`. */
export function decodeUnit(byte: number): number {
  return byte / BYTE_MAX;
}
/** Encode une valeur signée bornée par `range` en octet (remap [-range,range] → [0,255]). */
function encodeSigned(v: number, range: number): number {
  const n = clamp(v / range, -1, 1);
  return Math.round((n * 0.5 + 0.5) * BYTE_MAX);
}
/** Décode l'inverse de `encodeSigned`. */
export function decodeSigned(byte: number, range: number): number {
  return (byte / BYTE_MAX - 0.5) * 2 * range;
}

/** Hash entier → [0,1), déterministe, accès aléatoire (pas d'état séquentiel :
 *  nécessaire pour interroger un point de treillis quelconque, ex. Worley). */
function hash01(seed: number, ix: number, iz: number): number {
  let h = (seed ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bruit valeur (hash de treillis + interpolation quintique) — [0,1]. */
function valueNoise2D(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  return lerp(
    lerp(hash01(seed, xi, yi), hash01(seed, xi + 1, yi), u),
    lerp(hash01(seed, xi, yi + 1), hash01(seed, xi + 1, yi + 1), u),
    v,
  );
}

/** Gradient 2D unitaire au nœud de treillis (angle haché). */
function gradientAt(seed: number, ix: number, iz: number): readonly [number, number] {
  const a = hash01(seed, ix, iz) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

/** Bruit gradient (façon Perlin) une octave — ≈ [-1, 1]. */
function perlin2D(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const dot = (gx: number, gy: number, dx: number, dy: number) => {
    const [ga, gb] = gradientAt(seed, gx, gy);
    return ga * dx + gb * dy;
  };
  return lerp(
    lerp(dot(xi, yi, xf, yf), dot(xi + 1, yi, xf - 1, yf), u),
    lerp(dot(xi, yi + 1, xf, yf - 1), dot(xi + 1, yi + 1, xf - 1, yf - 1), u),
    v,
  );
}

/** FBM 3 octaves du bruit gradient — ≈ [-1, 1]. */
function fbm3(seed: number, x: number, y: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < FBM_OCTAVES; o++) {
    sum += perlin2D(seed, x * freq, y * freq) * amp;
    norm += amp;
    amp *= OCTAVE_GAIN;
    freq *= OCTAVE_LACUNARITY;
  }
  return sum / norm;
}

/** Bruit "ridged" (crêtes) 3 octaves : 1 - |perlin| par octave — [0, 1]. */
function ridged3(seed: number, x: number, y: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < RIDGED_OCTAVES; o++) {
    sum += (1 - Math.abs(perlin2D(seed, x * freq, y * freq))) * amp;
    norm += amp;
    amp *= OCTAVE_GAIN;
    freq *= OCTAVE_LACUNARITY;
  }
  return sum / norm;
}

/** Distance F1 (cellulaire/Worley) au point le plus proche parmi les cellules voisines (3×3). */
function worleyF1(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  let minDist = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cz = yi + dz;
      const jx = cx + hash01(seed, cx, cz);
      const jz = cz + hash01(seed ^ 0x9e3779b9, cx, cz);
      minDist = Math.min(minDist, Math.hypot(jx - x, jz - y));
    }
  }
  return minDist;
}

export type NoiseSample = {
  value: number;      // [0,1]
  fbm: number;         // [-1,1]
  dFbmDx: number;
  dFbmDz: number;
  ridged: number;      // [0,1]
  dRidgedDx: number;
  dRidgedDz: number;
  worley: number;      // [0,1], F1 normalisé
};

/** Sous-graines indépendantes dérivées de `seed` (FNV-1a, procedural.ts). */
function subSeeds(seed: number) {
  return {
    value: hashSeed(`${seed}:value`),
    fbm: hashSeed(`${seed}:fbm`),
    ridged: hashSeed(`${seed}:ridged`),
    worley: hashSeed(`${seed}:worley`),
  };
}

/**
 * Échantillon "live" (non baké) du bruit combiné en un point UV normalisé
 * (u, v) ∈ [0,1) — référence pour valider le bake, et fallback CPU possible.
 * `resolution` fixe le pas des différences finies des canaux gradient : il
 * DOIT correspondre à la résolution de bake pour que le gradient précalculé
 * égale ce qu'un fetch 4-tap live aurait donné (tout l'intérêt du bake).
 */
export function evalNoiseAt(seed: number, u: number, v: number, resolution: number): NoiseSample {
  const s = subSeeds(seed);
  const h = 1 / resolution; // pas d'un texel en UV

  const value = valueNoise2D(s.value, u * PERIOD_VALUE, v * PERIOD_VALUE);

  const fbmAt = (uu: number, vv: number) => fbm3(s.fbm, uu * PERIOD_FBM_BASE, vv * PERIOD_FBM_BASE);
  const fbm = fbmAt(u, v);
  const dFbmDx = (fbmAt(u + h, v) - fbmAt(u - h, v)) / (2 * h);
  const dFbmDz = (fbmAt(u, v + h) - fbmAt(u, v - h)) / (2 * h);

  const ridgedAt = (uu: number, vv: number) => ridged3(s.ridged, uu * PERIOD_RIDGED_BASE, vv * PERIOD_RIDGED_BASE);
  const ridged = ridgedAt(u, v);
  const dRidgedDx = (ridgedAt(u + h, v) - ridgedAt(u - h, v)) / (2 * h);
  const dRidgedDz = (ridgedAt(u, v + h) - ridgedAt(u, v - h)) / (2 * h);

  const worley = Math.min(1, worleyF1(s.worley, u * PERIOD_WORLEY, v * PERIOD_WORLEY) / WORLEY_CLAMP);

  return { value, fbm, dFbmDx, dFbmDz, ridged, dRidgedDx, dRidgedDz, worley };
}

export type BakedNoiseData = { resolution: number; texA: Uint8Array; texB: Uint8Array };

/** Bake CPU déterministe : évalue `evalNoiseAt` sur une grille `resolution × resolution`. */
export function bakeNoiseData(seed: number, resolution: number = DEFAULT_RESOLUTION): BakedNoiseData {
  const texA = new Uint8Array(resolution * resolution * 4);
  const texB = new Uint8Array(resolution * resolution * 4);

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const s = evalNoiseAt(seed, ix / resolution, iz / resolution, resolution);
      const i = (iz * resolution + ix) * 4;
      texA[i] = encodeUnit(s.value);
      texA[i + 1] = encodeSigned(s.fbm, 1);
      texA[i + 2] = encodeSigned(s.dFbmDx, GRADIENT_RANGE);
      texA[i + 3] = encodeSigned(s.dFbmDz, GRADIENT_RANGE);
      texB[i] = encodeUnit(s.ridged);
      texB[i + 1] = encodeSigned(s.dRidgedDx, GRADIENT_RANGE);
      texB[i + 2] = encodeSigned(s.dRidgedDz, GRADIENT_RANGE);
      texB[i + 3] = encodeUnit(s.worley);
    }
  }
  return { resolution, texA, texB };
}

/** Réflexion `GL_MIRRORED_REPEAT` sur un axe : seamless par construction (le
 *  bord se réfléchit sur lui-même), sans exiger que le bruit soit périodique. */
export function foldMirrored(t: number): number {
  const period = 2;
  let m = t % period;
  if (m < 0) m += period;
  return m <= 1 ? m : period - m;
}

function makeDataTexture(bytes: Uint8Array, resolution: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(bytes, resolution, resolution, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; // pas de mip pour un LUT de bruit — évite le flou/artefacts au bord miroir
  tex.needsUpdate = true;
  return tex;
}

export type BakedNoiseTextures = { texA: THREE.DataTexture; texB: THREE.DataTexture; dispose(): void };

/** Préprocess au boot : à appeler UNE fois par cimetière/graine, jamais par frame. */
export function bakeNoiseTextures(seed: number, resolution: number = DEFAULT_RESOLUTION): BakedNoiseTextures {
  const data = bakeNoiseData(seed, resolution);
  const texA = makeDataTexture(data.texA, resolution);
  const texB = makeDataTexture(data.texB, resolution);
  return { texA, texB, dispose: () => { texA.dispose(); texB.dispose(); } };
}

// Noms d'uniform attendus par `NOISE_SAMPLE_GLSL`, exportés pour éviter les
// chaînes magiques côté matériaux consommateurs (06/07/08).
export const NOISE_TEX_A_UNIFORM = "uNoiseTexA";
export const NOISE_TEX_B_UNIFORM = "uNoiseTexB";

/**
 * Helpers GLSL d'échantillonnage à injecter (ex. `onBeforeCompile`, cf.
 * `windSway.ts`) en tête de fragment shader. Un fetch par canal au lieu de
 * ré-évaluer le bruit ou de faire 4 différences finies pour le gradient.
 */
export const NOISE_SAMPLE_GLSL = `
uniform sampler2D ${NOISE_TEX_A_UNIFORM}; // R=value G=fbm B=d(fbm)/dx A=d(fbm)/dz
uniform sampler2D ${NOISE_TEX_B_UNIFORM}; // R=ridged G=d(ridged)/dx B=d(ridged)/dz A=worley F1
float sampleBakedValue(vec2 uv) { return texture2D(${NOISE_TEX_A_UNIFORM}, uv).r; }
float sampleBakedFbm(vec2 uv) { return texture2D(${NOISE_TEX_A_UNIFORM}, uv).g * 2.0 - 1.0; }
vec2 sampleBakedGradient(vec2 uv) {
  return (texture2D(${NOISE_TEX_A_UNIFORM}, uv).ba * 2.0 - 1.0) * ${GRADIENT_RANGE.toFixed(4)};
}
float sampleBakedRidged(vec2 uv) { return texture2D(${NOISE_TEX_B_UNIFORM}, uv).r; }
vec2 sampleBakedRidgedGradient(vec2 uv) {
  return (texture2D(${NOISE_TEX_B_UNIFORM}, uv).gb * 2.0 - 1.0) * ${GRADIENT_RANGE.toFixed(4)};
}
float sampleBakedWorley(vec2 uv) { return texture2D(${NOISE_TEX_B_UNIFORM}, uv).a; }
`;
