// Sol du monde extérieur (hors parcelles, chantier 2.3) : relief doux
// (terrainHeightAt, même principe que l'intérieur des cimetières, terrain.ts)
// qui s'annule à l'approche de la route (zone visuellement dégagée) ET
// s'ENFONCE à l'approche d'une parcelle — pas juste plate à la même hauteur
// que le terrain intérieur du cimetière, qui occupe la MÊME emprise XZ (les
// deux systèmes sont des géométries indépendantes qui se superposent). Un
// simple fondu vers 0 z-fightait avec ce terrain intérieur dès qu'un chunk
// se chargeait (bug observé : aplat noir scintillant à l'entrée d'un
// cimetière) — l'enfoncement garantit qu'elles ne coïncident jamais.
// Géométrie NON pré-rotée (comme le placeholder d'origine de cemetery.ts) :
// le mesh applique sa propre `rotation.x = -Math.PI / 2`, donc ici la
// "hauteur" se pose sur le composant Z local (cf. dérivation dans le commit).
import * as THREE from "three";
import { hashSeed } from "../procedural.ts";
import { distanceToSlot, type Vec2, type WorldSlot } from "../worldLayout.ts";
import { terrainHeightAt } from "./terrain.ts";

const WORLD_GROUND_SEED = hashSeed("world:ground");
// Amplitude brute de terrainHeightAt = 2 m (terrain.ts) : perceptible mais pas
// montagneux pour un simple fond visuel hors parcelles.
const RELIEF_FACTOR = 0.5;
const CELL_SIZE = 5; // m par maille — bien plus grossier que l'intérieur (1,5 m) : fond, pas sol arpenté
const MAX_SEGMENTS = 96; // plafond par axe quelle que soit la taille du monde (perf)
const ROAD_FADE_WIDTH = 8; // m — distance de fondu vers 0 aux abords de la route
// Large : 4 m sur seulement 6 m (pente ~34°) donnait une vraie falaise, dans l'ombre
// sous presque tous les angles — vu en jeu comme un aplat noir (bug session live-coding).
// 24 m ⇒ pente moyenne ~9°, une dépression douce plutôt qu'un à-pic.
const PARCEL_SINK_WIDTH = 24; // m — distance sur laquelle le sol s'enfonce à l'approche d'une parcelle
const PARCEL_SINK_DEPTH = 4; // m — bien au-delà de l'amplitude du terrain intérieur (±2 m) : jamais coïncident

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
  geo.computeVertexNormals();
  return geo;
}
