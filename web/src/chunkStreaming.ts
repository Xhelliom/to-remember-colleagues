// Décisions PURES de streaming intra-cimetière (phase 5) : à l'approche, seul
// le chunk d'entrée charge ; une fois l'emprise franchie (2.4), les chunks
// suivants chargent par proximité individuelle, comme le streaming inter-
// cimetières mais un niveau plus bas. Marge d'hystérésis entre charge et
// décharge pour ne jamais osciller à la frontière.
import type { ChunkRange } from "./procedural.ts";
import { distanceToSlot, toLocal, type Vec2, type WorldSlot } from "./worldLayout.ts";

export const CHUNK_LOAD_RADIUS = 24; // marge d'approche pour charger un chunk « à vue »
export const CHUNK_UNLOAD_RADIUS = 40; // hystérèse : > CHUNK_LOAD_RADIUS, jamais d'oscillation

/** Distance d'un point MONDE au rectangle d'UN chunk (0 si dedans), même
 *  principe que `distanceToSlot` mais borné à sa propre tranche [start, end[. */
function distanceToChunk(slot: WorldSlot, range: ChunkRange, p: Vec2): number {
  const local = toLocal(slot, p);
  const half = slot.plotWidth / 2;
  const dx = Math.max(Math.abs(local.x) - half, 0);
  const dz = Math.max(range.start - local.z, local.z - range.end, 0);
  return Math.hypot(dx, dz);
}

/**
 * Chunks à charger : le chunk d'entrée (0) dès l'approche du cimetière ;
 * les suivants seulement une fois l'emprise franchie, et chacun à sa propre
 * portée (pas besoin des autres chunks pour se charger).
 */
export function chunksToLoad(
  camWorld: Vec2,
  slot: WorldSlot,
  chunkRanges: ChunkRange[],
  loadedIndices: ReadonlySet<number>,
): number[] {
  const footprintDist = distanceToSlot(slot, camWorld);
  if (footprintDist > CHUNK_LOAD_RADIUS) return [];

  const toLoad: number[] = [];
  if (!loadedIndices.has(0)) toLoad.push(0);
  if (footprintDist === 0) {
    for (let i = 1; i < chunkRanges.length; i++) {
      if (loadedIndices.has(i)) continue;
      if (distanceToChunk(slot, chunkRanges[i], camWorld) < CHUNK_LOAD_RADIUS) toLoad.push(i);
    }
  }
  return toLoad;
}

/** Chunks à décharger : au-delà de `CHUNK_UNLOAD_RADIUS` de leur propre tranche. */
export function chunksToUnload(
  camWorld: Vec2,
  slot: WorldSlot,
  chunkRanges: ChunkRange[],
  loadedIndices: ReadonlySet<number>,
): number[] {
  const toUnload: number[] = [];
  for (const i of loadedIndices) {
    if (distanceToChunk(slot, chunkRanges[i], camWorld) > CHUNK_UNLOAD_RADIUS) toUnload.push(i);
  }
  return toUnload;
}
