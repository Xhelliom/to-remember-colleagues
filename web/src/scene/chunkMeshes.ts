// Construction et destruction des maillages d'une TRANCHE [zStart, zEnd[ de
// cimetière (terrain, herbe, végétation, clôture) — phase 3 du plan. Extrait
// de cemetery.ts pour rester sous la limite de 500 lignes par fichier.
import type * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";
import type { CemeteryLayout, ChunkRange } from "../procedural.ts";
import type { Frame } from "../worldLayout.ts";
import { buildGroundMaterial } from "./grass.ts";
import { GrassField, shouldHaveGrass } from "./grassField.ts";
import { TerrainChunk } from "./terrain.ts";
import { VegetationInstances } from "./vegetation.ts";
import { buildChunkFence, chunkReach, disposeFence } from "./fence.ts";

export type ChunkMeshes = {
  terrain: TerrainChunk;
  grass: GrassField | null;
  veg: VegetationInstances | null;
  fence: THREE.Group;
};

/** Construit les maillages (terrain, herbe, végétation, clôture) d'une tranche. */
export async function buildChunkMeshes(
  companyId: string,
  frame: Frame,
  layout: CemeteryLayout,
  index: number,
  range: ChunkRange,
  karma: number,
  ambiance: Ambiance,
): Promise<ChunkMeshes> {
  const reach = chunkReach(layout.placements, index, layout.plotWidth / 2);
  const clustersInChunk = layout.clusters.filter((c) => c.chunk === index);
  const mat = buildGroundMaterial(companyId, karma, ambiance.seasonKey, reach);
  const terrain = new TerrainChunk(companyId, frame, layout.plotWidth, layout.plotDepth, range.start, range.end, mat);

  const [grass, veg] = await Promise.all([
    shouldHaveGrass(karma, ambiance.seasonKey)
      ? GrassField.create(companyId, karma, frame, layout.plotWidth, layout.plotDepth, range.start, range.end, terrain)
      : Promise.resolve(null),
    VegetationInstances.create(companyId, frame, layout.plotWidth, layout.plotDepth, range.start, range.end, clustersInChunk, terrain),
  ]);

  const fence = buildChunkFence(
    frame, range.start, range.end, reach,
    index === 0, index === layout.chunkCount - 1,
    clustersInChunk, ambiance.scary, terrain,
  );

  return { terrain, grass, veg, fence };
}

/** Libère toutes les géométries/matériaux d'une tranche. */
export function disposeChunkMeshes(chunk: ChunkMeshes) {
  chunk.terrain.dispose();
  chunk.grass?.dispose();
  chunk.veg?.dispose();
  disposeFence(chunk.fence);
}
