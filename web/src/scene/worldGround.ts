// Sol du monde extérieur (hors parcelles, chantier 2.3) : relief doux
// (terrainHeightAt, même principe que l'intérieur des cimetières, terrain.ts)
// qui s'annule à l'approche des parcelles et de la route — les deux restent
// plates, comme le fondu de bordure du terrain intérieur (borderFade).
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
const FADE_WIDTH = 8; // m — distance de fondu vers 0 aux abords parcelles/route

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

/** [0,1] — 0 tout près d'une parcelle ou de la route (sol plat imposé), 1 au
 *  loin (relief plein). Même principe que `terrain.ts:borderFade`. */
function reliefFade(x: number, z: number, roadPoints: readonly Vec2[], slots: readonly WorldSlot[]): number {
  let minDist = Infinity;
  for (const s of slots) minDist = Math.min(minDist, distanceToSlot(s, { x, z }));
  for (let i = 0; i < roadPoints.length - 1; i++) {
    minDist = Math.min(minDist, distToSegment(x, z, roadPoints[i], roadPoints[i + 1]));
  }
  return Math.max(0, Math.min(1, minDist / FADE_WIDTH));
}

/** Hauteur du sol extérieur en un point MONDE — SOURCE UNIQUE réutilisée pour
 *  la géométrie du sol ET le placement des arbres de la forêt de transition
 *  (world.ts), afin qu'ils reposent exactement dessus (pas de flottement). */
export function worldGroundHeightAt(x: number, z: number, roadPoints: readonly Vec2[], slots: readonly WorldSlot[]): number {
  const fade = reliefFade(x, z, roadPoints, slots);
  return terrainHeightAt(WORLD_GROUND_SEED, x, z) * RELIEF_FACTOR * fade;
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
