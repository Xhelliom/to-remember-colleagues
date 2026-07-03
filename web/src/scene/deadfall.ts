// Bois mort de décor (troncs couchés, souches, champignons) — ambiance
// cimetière à l'abandon. Référence de CONCEPT : LAAS `vegetation/Deadfall.ts`
// (troncs à 3 états de décomposition, souches, champignons).
//
// Réutilise le MÊME champ d'altération que la pierre (`scene/stone.ts`,
// mission 06 — `sampleWeathering`/`WeatheringParams`, bruit bâké de
// `noiseBake.ts`) : crevasses/grain s'appliquent aussi bien à une écorce en
// décomposition qu'à une pierre usée — un seul système plutôt que d'en
// réinventer un pour le bois. `dressingFor` (mission 07, `dressing.ts`)
// pilote en plus la mousse/le lichen selon l'exposition (upness = hauteur du
// normal, cf. LAAS `dot(normal, up)`) et un état de décomposition traduit en
// "entretien" fictif (bois pourri = négligé, bois frais = entretenu).
//
// Module BUILDER PUR : produit des géométries/groupes prêts à être placés,
// mais ne décide PAS où — le placement dans le monde est DIFFÉRÉ (une
// prochaine mission câblera ceci dans worldStreamer.ts/vegetation.ts).
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { sampleWeathering, type WeatheringParams } from "./stone.ts";
import { dressingFor } from "./dressing.ts";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

// --- États de décomposition (LAAS : troncs à 3 états) ---
export const DECAY_STATES = ["fresh", "weathered", "rotten"] as const;
export type DecayState = (typeof DECAY_STATES)[number];

/** Décorrèle le tirage de l'état de décomposition du reste de la géométrie
 *  (déjà dérivée de la même graine) — évite un biais si les deux tirages
 *  utilisaient la même sous-suite du PRNG. */
const DECAY_SEED_SALT = 0xd34df411;

/** État de décomposition déterministe pour une graine — même graine → même
 *  état, toujours (jamais de `Math.random`). */
export function decayStateForSeed(seed: number): DecayState {
  const rand = seededRandom(seed ^ DECAY_SEED_SALT);
  const index = Math.min(Math.floor(rand() * DECAY_STATES.length), DECAY_STATES.length - 1);
  return DECAY_STATES[index];
}

// --- Paramètres d'altération + "entretien" fictif par état ---
const DECAY_WEATHERING: Record<DecayState, WeatheringParams> = {
  fresh: { warpAmplitude: 0.03, strataCount: 3, strataTilt: 0.4, strataAmplitude: 0.012, crackIntensity: 0.12, crackDepth: 0.02, grainAmplitude: 0.01 },
  weathered: { warpAmplitude: 0.07, strataCount: 4, strataTilt: 0.5, strataAmplitude: 0.02, crackIntensity: 0.45, crackDepth: 0.045, grainAmplitude: 0.018 },
  rotten: { warpAmplitude: 0.13, strataCount: 5, strataTilt: 0.65, strataAmplitude: 0.03, crackIntensity: 0.8, crackDepth: 0.07, grainAmplitude: 0.03 },
};

/** "Entretien" fictif ∈ [0,1] dérivé de l'état de décomposition — réutilise
 *  `dressingFor` (axe `maintenance`) sans dupliquer sa logique : bois frais =
 *  entretenu (peu d'habillage), bois pourri = négligé (habillage maximal). */
const DECAY_MAINTENANCE: Record<DecayState, number> = { fresh: 0.85, weathered: 0.45, rotten: 0.05 };

// --- Couleurs (bois + habillage mousse/lichen) ---
const WOOD_HUE_BASE = 0.08; // brun bois
const WOOD_HUE_RANGE = 0.02;
const WOOD_SATURATION = 0.35;
const WOOD_LIGHTNESS_MIN = 0.16; // fond des creux
const WOOD_LIGHTNESS_RANGE = 0.22;
const DRESSING_MOSS_COLOR = 0x4f6b34;
const DRESSING_LICHEN_COLOR = 0xb7c48a;
const DRESSING_MAX_BLEND = 0.8;

/**
 * Déplace/colore les sommets d'une géométrie UV-mappée (cylindre) selon le
 * champ d'altération du bois (mission 06) + l'habillage mousse/lichen
 * (mission 07, `upness` = composante Y de la normale — un sommet qui regarde
 * le ciel attrape plus de lichen qu'un sommet qui regarde le sol). Réutilisé
 * par le tronc couché ET la souche : un seul pipeline bois altéré.
 */
function weatherWoodSurface(geometry: THREE.BufferGeometry, seed: number, decay: DecayState): void {
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const params = DECAY_WEATHERING[decay];
  const maintenance = DECAY_MAINTENANCE[decay];
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const s = sampleWeathering(uv.getX(i), uv.getY(i), seed, params);
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    pos.setXYZ(i, pos.getX(i) + nx * s.displacement, pos.getY(i) + ny * s.displacement, pos.getZ(i) + nz * s.displacement);

    const lightness = WOOD_LIGHTNESS_MIN + (1 - s.cavityAO) * WOOD_LIGHTNESS_RANGE;
    color.setHSL(WOOD_HUE_BASE + s.hue * WOOD_HUE_RANGE, WOOD_SATURATION, lightness);

    const dressing = dressingFor({ upness: clamp01(ny), cavity: s.cavityAO, maintenance, votes: 0 });
    if (dressing.mossIntensity > 0) color.lerp(new THREE.Color(DRESSING_MOSS_COLOR), dressing.mossIntensity * DRESSING_MAX_BLEND);
    if (dressing.lichenIntensity > 0) color.lerp(new THREE.Color(DRESSING_LICHEN_COLOR), dressing.lichenIntensity * DRESSING_MAX_BLEND);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
}

function woodMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95 });
}

/** Une pièce de bois mort construite : groupe prêt à être placé (position
 *  encore à l'origine) + son état de décomposition. */
export type DeadfallPiece = {
  readonly group: THREE.Group;
  readonly decayState: DecayState;
  dispose(): void;
};

// --- Tronc couché ---
const TRUNK_RADIAL_SEGMENTS = 8;
const TRUNK_HEIGHT_SEGMENTS = 6;
const TRUNK_TAPER_RATIO = 0.72; // rayon au bout fin / rayon à la base
const DEFAULT_TRUNK_LENGTH = 3.2;
const DEFAULT_TRUNK_RADIUS = 0.22;

export type TrunkOptions = { readonly length?: number; readonly radius?: number };

/** Tronc abattu, couché au sol : cylindre effilé altéré (mission 06) + habillé
 *  (mission 07). Déterministe : même `seed` → même géométrie/état. */
export function buildFallenTrunk(seed: number, opts: TrunkOptions = {}): DeadfallPiece {
  const decayState = decayStateForSeed(seed);
  const length = opts.length ?? DEFAULT_TRUNK_LENGTH;
  const radius = opts.radius ?? DEFAULT_TRUNK_RADIUS;

  const geometry = new THREE.CylinderGeometry(
    radius * TRUNK_TAPER_RATIO, radius, length, TRUNK_RADIAL_SEGMENTS, TRUNK_HEIGHT_SEGMENTS,
  );
  geometry.rotateZ(Math.PI / 2); // l'axe du cylindre (Y) devient l'axe X : couché au sol
  weatherWoodSurface(geometry, seed, decayState);

  const material = woodMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = radius; // repose sur le sol
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.userData.decayState = decayState;

  return { group, decayState, dispose: () => { geometry.dispose(); material.dispose(); } };
}

// --- Souche ---
const STUMP_RADIAL_SEGMENTS = 8;
const STUMP_HEIGHT_SEGMENTS = 3;
const STUMP_FLARE_RATIO = 1.25; // élargissement à la base (contreforts racinaires)
const DEFAULT_STUMP_HEIGHT = 0.45;
const DEFAULT_STUMP_RADIUS = 0.28;

export type StumpOptions = { readonly height?: number; readonly radius?: number };

/** Souche : cylindre légèrement évasé à la base, altéré/habillé comme le tronc. */
export function buildStump(seed: number, opts: StumpOptions = {}): DeadfallPiece {
  const decayState = decayStateForSeed(seed);
  const height = opts.height ?? DEFAULT_STUMP_HEIGHT;
  const radius = opts.radius ?? DEFAULT_STUMP_RADIUS;

  const geometry = new THREE.CylinderGeometry(
    radius, radius * STUMP_FLARE_RATIO, height, STUMP_RADIAL_SEGMENTS, STUMP_HEIGHT_SEGMENTS,
  );
  weatherWoodSurface(geometry, seed, decayState);

  const material = woodMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.userData.decayState = decayState;

  return { group, decayState, dispose: () => { geometry.dispose(); material.dispose(); } };
}

// --- Champignons ---
const MUSHROOM_CAP_PALETTE = [0x8b4a2b, 0xc9762f, 0xe8d9b5, 0x6b3d2e] as const;
const MUSHROOM_STEM_COLOR = 0xe4d9c0;
const MUSHROOM_CAP_RADIUS_MIN = 0.02;
const MUSHROOM_CAP_RADIUS_RANGE = 0.03;
const MUSHROOM_STEM_HEIGHT_MIN = 0.03;
const MUSHROOM_STEM_HEIGHT_RANGE = 0.04;
const MUSHROOM_STEM_RADIAL_SEGMENTS = 5;
const MUSHROOM_STEM_TOP_RADIUS_RATIO = 0.25; // fraction du rayon du chapeau
const MUSHROOM_STEM_BASE_RADIUS_RATIO = 0.3;
const MUSHROOM_CAP_WIDTH_SEGMENTS = 6;
const MUSHROOM_CAP_HEIGHT_SEGMENTS = 4;
const MUSHROOM_CAP_ARC = Math.PI * 0.55; // dôme (pas une sphère complète)
const DEFAULT_MUSHROOM_COUNT = 5;
const DEFAULT_MUSHROOM_SPREAD = 0.35; // rayon de dispersion (m) autour de l'origine

export type MushroomClusterOptions = { readonly count?: number; readonly spread?: number };

/** Petite colonie de champignons (tige + chapeau), typiquement posée au pied
 *  d'un tronc/souche pourrissant. Positions et tailles déterministes par
 *  graine (mulberry32, jamais `Math.random`). */
export function buildMushroomCluster(seed: number, opts: MushroomClusterOptions = {}): DeadfallPiece {
  const decayState = decayStateForSeed(seed); // les champignons signent toujours un bois qui pourrit
  const rand = seededRandom(seed);
  const count = opts.count ?? DEFAULT_MUSHROOM_COUNT;
  const spread = opts.spread ?? DEFAULT_MUSHROOM_SPREAD;

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  for (let i = 0; i < count; i++) {
    const capRadius = MUSHROOM_CAP_RADIUS_MIN + rand() * MUSHROOM_CAP_RADIUS_RANGE;
    const stemHeight = MUSHROOM_STEM_HEIGHT_MIN + rand() * MUSHROOM_STEM_HEIGHT_RANGE;
    const angle = rand() * Math.PI * 2;
    const dist = rand() * spread;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const stemGeo = new THREE.CylinderGeometry(
      capRadius * MUSHROOM_STEM_TOP_RADIUS_RATIO, capRadius * MUSHROOM_STEM_BASE_RADIUS_RATIO,
      stemHeight, MUSHROOM_STEM_RADIAL_SEGMENTS,
    );
    const stemMat = new THREE.MeshStandardMaterial({ color: MUSHROOM_STEM_COLOR, roughness: 0.8 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(x, stemHeight / 2, z);
    group.add(stem);
    geometries.push(stemGeo);
    materials.push(stemMat);

    const capGeo = new THREE.SphereGeometry(
      capRadius, MUSHROOM_CAP_WIDTH_SEGMENTS, MUSHROOM_CAP_HEIGHT_SEGMENTS, 0, Math.PI * 2, 0, MUSHROOM_CAP_ARC,
    );
    const capColor = MUSHROOM_CAP_PALETTE[Math.floor(rand() * MUSHROOM_CAP_PALETTE.length)];
    const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.7 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, stemHeight, z);
    group.add(cap);
    geometries.push(capGeo);
    materials.push(capMat);
  }

  group.userData.decayState = decayState;

  return {
    group,
    decayState,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
