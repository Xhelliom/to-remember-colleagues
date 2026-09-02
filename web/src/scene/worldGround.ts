// Sol du monde extérieur (hors parcelles, chantier 2.3) : relief doux
// (terrainHeightAt, même principe que l'intérieur des cimetières, terrain.ts)
// qui s'annule à l'approche de la route (zone visuellement dégagée).
//
// Sous une parcelle, le terrain intérieur du cimetière occupe la MÊME emprise
// XZ : deux géométries indépendantes superposées, qui z-fightaient (aplat noir
// scintillant à l'entrée). La parade est de ne PAS mailler là — `carveParcels`
// retire ces triangles — et de n'enfoncer que la mince bordure restante, celle
// que le découpage sur grille ne peut pas retirer proprement. L'enfoncement
// large de 4 m qui servait auparavant de parade creusait un cratère autour de
// chaque cimetière : invisible tant que la caméra flottait à hauteur fixe,
// infranchissable depuis qu'elle suit le sol.
// Géométrie NON pré-rotée (comme le placeholder d'origine de cemetery.ts) :
// le mesh applique sa propre `rotation.x = -Math.PI / 2`, donc ici la
// "hauteur" se pose sur le composant Z local (cf. dérivation dans le commit).
import * as THREE from "three";
import { hashSeed } from "../procedural.ts";
import { distanceToSlot, toLocal, type Vec2, type WorldSlot } from "../worldLayout.ts";
import { terrainHeightAt } from "./terrain.ts";

const WORLD_GROUND_SEED = hashSeed("world:ground");
// Amplitude brute de terrainHeightAt = 2 m (terrain.ts) : perceptible mais pas
// montagneux pour un simple fond visuel hors parcelles.
const RELIEF_FACTOR = 0.5;
const CELL_SIZE = 5; // m par maille — bien plus grossier que l'intérieur (1,5 m) : fond, pas sol arpenté
const MAX_SEGMENTS = 96; // plafond par axe quelle que soit la taille du monde (perf)
const ROAD_FADE_WIDTH = 8; // m — distance de fondu vers 0 aux abords de la route
// Bordure : seule la frange non découpée s'enfonce, juste assez pour passer
// sous le terrain intérieur sans creuser une marche que le visiteur sentirait.
const PARCEL_SINK_WIDTH = 3;
const PARCEL_SINK_DEPTH = 0.6;
/** Retrait du découpage vers l'intérieur de la parcelle (m) : le bord dentelé
 *  du trou reste ainsi recouvert par le terrain intérieur, sans fente. */
const PARCEL_CARVE_INSET = 2;

function segmentsFor(size: number): number {
  return Math.max(1, Math.min(MAX_SEGMENTS, Math.round(size / CELL_SIZE)));
}

/** Distance d'un point au segment [a,b] dans le plan XZ. */
function distToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** [0,1] — 0 tout près de la route (sol plat dégagé), 1 au loin (relief plein). */
function roadFade(x: number, z: number, roadPoints: readonly Vec2[]): number {
  let minDist = Infinity;
  for (let i = 0; i < roadPoints.length - 1; i++) minDist = Math.min(minDist, distToSegment(x, z, roadPoints[i], roadPoints[i + 1]));
  return Math.max(0, Math.min(1, minDist / ROAD_FADE_WIDTH));
}

/** [0,1] — 1 dans/tout près d'une parcelle (enfoncement max), 0 au-delà de
 *  `PARCEL_SINK_WIDTH`. `distanceToSlot` vaut 0 n'importe où DANS le rectangle
 *  réel de la parcelle (pas juste au centre), cf. worldLayout.ts. */
function parcelProximity(x: number, z: number, slots: readonly WorldSlot[]): number {
  let minDist = Infinity;
  for (const s of slots) minDist = Math.min(minDist, distanceToSlot(s, { x, z }));
  return 1 - Math.max(0, Math.min(1, minDist / PARCEL_SINK_WIDTH));
}

/** Hauteur du sol extérieur en un point MONDE — SOURCE UNIQUE réutilisée pour
 *  la géométrie du sol ET le placement des arbres de la forêt de transition
 *  (world.ts), afin qu'ils reposent exactement dessus (pas de flottement). */
export function worldGroundHeightAt(x: number, z: number, roadPoints: readonly Vec2[], slots: readonly WorldSlot[]): number {
  const relief = terrainHeightAt(WORLD_GROUND_SEED, x, z) * RELIEF_FACTOR * roadFade(x, z, roadPoints);
  const sink = parcelProximity(x, z, slots) * PARCEL_SINK_DEPTH;
  return relief - sink;
}

/** Le point est-il dans la parcelle, rétrécie de `inset` sur chaque bord ? */
function insideSlot(slot: WorldSlot, x: number, z: number, inset: number): boolean {
  const local = toLocal(slot, { x, z });
  const half = slot.plotWidth / 2 - inset;
  return Math.abs(local.x) < half && local.z > inset && local.z < slot.plotDepth - inset;
}

/**
 * Retire les triangles qui tombent dans l'emprise d'une parcelle : le terrain
 * intérieur du cimetière y est déjà, et deux sols coplanaires z-fightent.
 */
function carveParcels(
  geo: THREE.BufferGeometry, cx: number, cz: number, slots: readonly WorldSlot[],
): void {
  const index = geo.getIndex();
  if (!index || slots.length === 0) return;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    let sumX = 0;
    let sumY = 0;
    for (let k = 0; k < 3; k++) {
      const v = index.getX(t + k);
      sumX += pos.getX(v);
      sumY += pos.getY(v);
    }
    // Même dérivation locale → monde que la boucle de déplacement ci-dessous.
    const worldX = cx + sumX / 3;
    const worldZ = cz - sumY / 3;
    if (slots.some((s) => insideSlot(s, worldX, worldZ, PARCEL_CARVE_INSET))) continue;
    kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
  }
  geo.setIndex(kept);
}

/**
 * Géométrie du sol extérieur, subdivisée et déplacée en hauteur — à assigner
 * telle quelle à `cemetery.ts`'s `this.ground.geometry` (le mesh garde sa
 * rotation -90° existante, pas de changement d'orientation ici).
 */
export function buildWorldGroundGeometry(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  roadPoints: readonly Vec2[],
  slots: readonly WorldSlot[],
): THREE.BufferGeometry {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const wSeg = segmentsFor(width);
  const dSeg = segmentsFor(depth);
  const geo = new THREE.PlaneGeometry(width, depth, wSeg, dSeg);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const worldX = cx + lx;
    const worldZ = cz - ly; // cf. dérivation en tête de fichier (rotation X -90° du mesh)
    pos.setZ(i, worldGroundHeightAt(worldX, worldZ, roadPoints, slots));
  }
  pos.needsUpdate = true;
  carveParcels(geo, cx, cz, slots);
  geo.computeVertexNormals();
  return geo;
}
