// Herbe « partout » : anneau (grille toroïdale) de touffes centré sur la caméra,
// dense près, jamais chauve loin — remplace le champ fixe plafonné par tranche
// (grassField.ts) sur les portions du monde où le flag GRASS_RING_ENABLED est
// activé (voir worldStreamer.ts, câblage minimal/additif). Module AUTONOME :
// aucune dépendance à chunkMeshes.ts/grassField.ts, seulement grassBlade.ts
// (mission 04), wind.ts et distanceLod.ts.
//
// Référence de concept (LAAS `vegetation/GroundRing.ts` — portée en Three.js
// WebGLRenderer, aucun code copié) : clipmap toroïdal centré caméra, amincissement
// continu compensé par élargissement des brins (couverture ~constante), 3 bandes
// LOD (géométrie qui se dégrade avec la distance) avec crossfade par dither
// complémentaire (zéro pop de géométrie à la frontière d'une bande).
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { selectLodTier } from "./distanceLod.ts";
import { BLADE_SEGS, bladeClump } from "./grassBlade.ts";
import { addWindWeightAttribute, applyWind, GRASS_WIND_POOL } from "./wind.ts";

/** Taille de cellule (m) de la grille toroïdale — identité d'une cellule dérivée
 *  de ses coordonnées entières (cx, cz), jamais de l'historique de la caméra :
 *  recyclage sans couture quand la caméra se déplace (même cellule absolue →
 *  toujours le même contenu, cf. `cellSeed`). */
export const GRASS_CELL = 4;

/** Bandes de distance (m) séparant les 3 paliers de géométrie — palier 0 = proche
 *  (plein détail), palier 2 = loin (« tuft » : peu de segments, brins fusionnés). */
export const RING_BAND_NEAR_OUTER = 14;
export const RING_BAND_MID_OUTER = 26;
export const RING_BAND_THRESHOLDS: readonly number[] = [RING_BAND_NEAR_OUTER, RING_BAND_MID_OUTER];
/** Rayon externe de l'anneau (m) — au-delà, aucune touffe (hors du champ de vision utile). */
export const RING_FAR_RADIUS = 40;
/** Marge d'hystérésis (m) anti-clignotement à la frontière d'une bande (cf. distanceLod.ts). */
export const RING_HYSTERESIS = 1.5;

const RING_BAND_COUNT = RING_BAND_THRESHOLDS.length + 1; // 3
/** Segments verticaux par brin, par bande (mission 04 `grassBlade.ts`) — dégrade
 *  la courbe de flexion avec la distance ; palier loin = « tuft » à 1 segment. */
const RING_BAND_SEGS: readonly number[] = [BLADE_SEGS, 2, 1];
/** Brins fusionnés par touffe, par bande — moins de brins loin (perf). */
const RING_BAND_BLADES_PER_CLUMP: readonly number[] = [5, 3, 2];
/** Capacité (instances/touffes) allouée par bande — les cellules les plus
 *  lointaines de la file triée sont sacrifiées en premier si dépassée. */
const RING_BAND_CAPACITY: readonly number[] = [2000, 1800, 1000];

/** En-deçà (m) : densité pleine (amincissement = 1). */
const RING_THIN_START = 10;
/** Fraction de touffes jamais perdue au-delà de RING_FAR_RADIUS — « jamais chauve loin ». */
const RING_KEEP_FLOOR = 0.12;
/** Touffes par cellule à densité pleine (keep = 1). */
const RING_BASE_CLUMPS_PER_CELL = 6;
/** Plancher absolu de touffes par cellule, même très amincie (pas de trou net). */
const RING_MIN_CLUMPS_PER_CELL = 1;

/** Constantes de hash déterministe pour le dither de transition (même famille que wind.ts). */
const DITHER_HASH_FREQ = 91.345;
const DITHER_HASH_SCALE = 47453.156;
const DITHER_INDEX_SALT = 7.111;

const RING_GRASS_COLOR = new THREE.Color(0x4c6b2c);
const RING_ROUGHNESS = 0.85;
/** Décorrèle la phase de vent du ring de celle des autres pools (grassField.ts, vegetation.ts). */
const RING_WIND_SEED_OFFSET = 9001;
const RING_GEOMETRY_SEED = 733;

const TWO_PI = Math.PI * 2;

// --- Grille toroïdale : identité de cellule et énumération ------------------

export type CellCoord = { cx: number; cz: number };
type RingCell = CellCoord & { distance: number };

/** Cellule congruente la plus proche de (x, z) — identité stable : une petite
 *  variation de la caméra (< cellSize/2) reste dans la même cellule. */
export function cellIndex(x: number, z: number, cellSize: number = GRASS_CELL): CellCoord {
  return { cx: Math.round(x / cellSize), cz: Math.round(z / cellSize) };
}

/** Centre monde d'une cellule (coordonnées entières → mètres). */
export function cellCenter(cell: CellCoord, cellSize: number = GRASS_CELL): { x: number; z: number } {
  return { x: cell.cx * cellSize, z: cell.cz * cellSize };
}

/** Graine déterministe d'une cellule — dépend UNIQUEMENT de ses coordonnées
 *  absolues : recyclage toroïdal sans couture (même cellule → même contenu). */
export function cellSeed(cell: CellCoord): number {
  return hashSeed(`ring:${cell.cx}:${cell.cz}`);
}

/**
 * Cellules de la grille toroïdale à portée de l'anneau (rayon RING_FAR_RADIUS),
 * triées de la plus proche à la plus lointaine — les plus lointaines sont
 * sacrifiées en premier si une bande dépasse sa capacité (cf. GrassRing.update).
 * Déterministe : ne dépend que de la position caméra (via sa cellule).
 */
export function cellsInRing(camX: number, camZ: number, cellSize: number = GRASS_CELL): RingCell[] {
  const cam = cellIndex(camX, camZ, cellSize);
  const radiusCells = Math.ceil(RING_FAR_RADIUS / cellSize) + 1;
  const cells: RingCell[] = [];
  for (let dz = -radiusCells; dz <= radiusCells; dz++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const cx = cam.cx + dx;
      const cz = cam.cz + dz;
      const center = cellCenter({ cx, cz }, cellSize);
      const distance = Math.hypot(center.x - camX, center.z - camZ);
      if (distance > RING_FAR_RADIUS) continue;
      cells.push({ cx, cz, distance });
    }
  }
  cells.sort((a, b) => a.distance - b.distance || a.cz - b.cz || a.cx - b.cx);
  return cells;
}

// --- Amincissement continu + compensation de largeur (couverture constante) -

/** Fraction de touffes gardées à `distance` — monotone DÉCROISSANTE, jamais
 *  nulle (plancher RING_KEEP_FLOOR : « jamais chauve loin »). */
export function thinningKeep(distance: number): number {
  if (distance <= RING_THIN_START) return 1;
  const t = (distance - RING_THIN_START) / (RING_FAR_RADIUS - RING_THIN_START);
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - clamped * (1 - RING_KEEP_FLOOR);
}

/** Élargissement compensatoire : largeur ∝ 1/√densité, pour que la couverture
 *  visuelle (densité × largeur²) reste constante malgré l'amincissement. */
export function widthScaleForKeep(keep: number): number {
  return 1 / Math.sqrt(keep);
}

/** Couverture (densité × largeur²) à `distance` — doit rester ≈ constante par
 *  construction (`widthScaleForKeep` est l'inverse exact de `thinningKeep`). */
export function ringCoverage(distance: number): number {
  const keep = thinningKeep(distance);
  return keep * widthScaleForKeep(keep) ** 2;
}

// --- Crossfade dither complémentaire (anti-pop à la frontière d'une bande) --

/** Progression (0→1) dans la fenêtre de transition [seuil-hystérésis, seuil+hystérésis]
 *  autour d'un seuil de bande — fonction pure et continue, sans état. */
export function transitionProgress(distance: number, threshold: number, hysteresis: number): number {
  const t = (distance - (threshold - hysteresis)) / (2 * hysteresis);
  return Math.min(1, Math.max(0, t));
}

/** Valeur de dither déterministe dans [0, 1[ pour la `index`-ième touffe d'une
 *  cellule de graine `seed` (même famille de hash que wind.ts). */
function ditherValue(seed: number, index: number): number {
  const v = Math.sin((seed + index * DITHER_INDEX_SALT) * DITHER_HASH_FREQ) * DITHER_HASH_SCALE;
  return v - Math.floor(v);
}

/** Vrai si la touffe (valeur de dither `dither`) reste dans sa bande d'origine à
 *  la progression `progress` — complémentaire par construction : la fraction
 *  gardée décroît linéairement de 1 à 0 pendant que la bande voisine grandit
 *  symétriquement de 0 à 1, sans jamais qu'une touffe compte dans les deux. */
export function keepInHomeBand(dither: number, progress: number): boolean {
  return dither >= progress;
}

/** Bande voisine vers laquelle une cellule bascule progressivement quand elle
 *  approche d'un seuil (dans la fenêtre d'hystérésis), sinon `null` (pleinement
 *  dans sa bande d'origine). */
function neighborTransition(distance: number, homeBand: number): { band: number; progress: number } | null {
  const outer = RING_BAND_THRESHOLDS[homeBand];
  if (outer !== undefined && distance > outer - RING_HYSTERESIS) {
    return { band: homeBand + 1, progress: transitionProgress(distance, outer, RING_HYSTERESIS) };
  }
  const inner = RING_BAND_THRESHOLDS[homeBand - 1];
  if (inner !== undefined && distance < inner + RING_HYSTERESIS) {
    return { band: homeBand - 1, progress: 1 - transitionProgress(distance, inner, RING_HYSTERESIS) };
  }
  return null;
}

// --- Matériau (vent partagé, cf. wind.ts) ------------------------------------

function buildRingMaterial(seedOffset: number): THREE.Material {
  const base = new THREE.MeshStandardMaterial({ color: RING_GRASS_COLOR, roughness: RING_ROUGHNESS, side: THREE.DoubleSide });
  return applyWind(base, { pool: GRASS_WIND_POOL, seedOffset });
}

// --- Anneau : 3 InstancedMesh (un par bande = 3 draw calls max) -------------

/**
 * Anneau d'herbe centré caméra : 3 `InstancedMesh` (une par bande de LOD), dont
 * le contenu est entièrement recalculé à chaque `update()` à partir de la
 * grille toroïdale (`cellsInRing`) — pas de recyclage incrémental cellule par
 * cellule.
 * ponytail: rebuild complet par frame (quelques milliers d'instances, sub-ms) ;
 * passer à un recyclage incrémental (ne toucher que les cellules qui entrent/
 * sortent) si le profilage à l'intégration montre un coût CPU réel.
 */
export class GrassRing {
  readonly group = new THREE.Group();
  private readonly meshes: readonly THREE.InstancedMesh[];
  private readonly dummy = new THREE.Object3D();
  private cellHomeBand = new Map<string, number>();

  private constructor(meshes: readonly THREE.InstancedMesh[]) {
    this.meshes = meshes;
    for (const mesh of meshes) this.group.add(mesh);
  }

  static create(seedOffset: number = RING_WIND_SEED_OFFSET): GrassRing {
    const meshes: THREE.InstancedMesh[] = [];
    for (let band = 0; band < RING_BAND_COUNT; band++) {
      const geo = bladeClump(RING_BAND_BLADES_PER_CLUMP[band], RING_BAND_SEGS[band], RING_GEOMETRY_SEED + band);
      addWindWeightAttribute(geo, GRASS_WIND_POOL);
      const mat = buildRingMaterial(seedOffset + band);
      const mesh = new THREE.InstancedMesh(geo, mat, RING_BAND_CAPACITY[band]);
      mesh.count = 0; // rien tant qu'aucun update() n'a été appelé
      meshes.push(mesh);
    }
    return new GrassRing(meshes);
  }

  /** Repositionne l'anneau autour de (camX, camZ) : reconstruit entièrement les
   *  3 bandes depuis la grille toroïdale. `heightAt`/`exclude` — mêmes contrats
   *  que `GrassField` (grassField.ts) : hauteur du sol, zones sans herbe. */
  update(
    camX: number,
    camZ: number,
    heightAt: (x: number, z: number) => number,
    exclude?: (x: number, z: number) => boolean,
  ): void {
    const cursors = new Array<number>(RING_BAND_COUNT).fill(0);
    const nextHomeBand = new Map<string, number>();
    for (const cell of cellsInRing(camX, camZ)) {
      this.placeCell(cell, heightAt, exclude, cursors, nextHomeBand);
    }
    this.cellHomeBand = nextHomeBand;
    for (let band = 0; band < RING_BAND_COUNT; band++) {
      this.meshes[band].count = cursors[band];
      this.meshes[band].instanceMatrix.needsUpdate = true;
    }
  }

  private placeCell(
    cell: RingCell,
    heightAt: (x: number, z: number) => number,
    exclude: ((x: number, z: number) => boolean) | undefined,
    cursors: number[],
    nextHomeBand: Map<string, number>,
  ): void {
    const key = `${cell.cx}:${cell.cz}`;
    const prevHome = this.cellHomeBand.get(key) ?? 0;
    const homeBand = selectLodTier(cell.distance, RING_BAND_THRESHOLDS, prevHome, RING_HYSTERESIS);
    nextHomeBand.set(key, homeBand);

    const neighbor = neighborTransition(cell.distance, homeBand);
    const keep = thinningKeep(cell.distance);
    const widthScale = widthScaleForKeep(keep);
    const count = Math.max(RING_MIN_CLUMPS_PER_CELL, Math.round(RING_BASE_CLUMPS_PER_CELL * keep));

    const seed = cellSeed(cell);
    const rand = seededRandom(seed);
    const center = cellCenter(cell);

    for (let i = 0; i < count; i++) {
      const x = center.x + (rand() - 0.5) * GRASS_CELL;
      const z = center.z + (rand() - 0.5) * GRASS_CELL;
      const yaw = rand() * TWO_PI;
      if (exclude?.(x, z)) continue;
      const band = neighbor && !keepInHomeBand(ditherValue(seed, i), neighbor.progress) ? neighbor.band : homeBand;
      this.writeInstance(band, cursors, x, heightAt(x, z), z, yaw, widthScale);
    }
  }

  private writeInstance(
    band: number,
    cursors: number[],
    x: number, y: number, z: number,
    yaw: number,
    widthScale: number,
  ): void {
    if (band < 0 || band >= this.meshes.length || cursors[band] >= RING_BAND_CAPACITY[band]) return;
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(0, yaw, 0);
    this.dummy.scale.set(widthScale, 1, widthScale);
    this.dummy.updateMatrix();
    this.meshes[band].setMatrixAt(cursors[band]++, this.dummy.matrix);
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
