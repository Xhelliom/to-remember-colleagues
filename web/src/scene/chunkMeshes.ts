// Construction et destruction des maillages d'une TRANCHE [zStart, zEnd[ de
// cimetière (terrain, herbe, végétation, clôture) — phase 3 du plan. Extrait
// de cemetery.ts pour rester sous la limite de 500 lignes par fichier.
import type * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";
import { distanceToPath, type CemeteryLayout, type ChunkRange } from "../procedural.ts";
import { toLocal, type Frame } from "../worldLayout.ts";
import { buildGroundMaterial, PATH_HALF_WIDTH } from "./grass.ts";
import { GrassField, shouldHaveGrass } from "./grassField.ts";
import { TerrainChunk } from "./terrain.ts";
import { VegetationInstances } from "./vegetation.ts";
import { buildChunkFence, chunkReach, disposeFence } from "./fence.ts";
import { ClusterBiomes } from "./biomes/clairiere/builder.ts";

export type ChunkMeshes = {
  terrain: TerrainChunk;
  grass: GrassField | null;
  veg: VegetationInstances | null;
  fence: THREE.Group;
  biomes: ClusterBiomes | null;
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
  renderer?: THREE.WebGLRenderer,
): Promise<ChunkMeshes> {
  const reach = chunkReach(layout.placements, index, layout.plotWidth / 2);
  // Le sol (terrain/herbe/végétation) est calé sur la même portée que la
  // clôture (2 × reach), pas sur la largeur globale du couloir — sinon le sol
  // dépasse le mur d'enceinte.
  const chunkWidth = reach * 2;
  const clustersInChunk = layout.clusters.filter((c) => c.chunk === index);
  const mat = buildGroundMaterial(companyId, karma, ambiance.seasonKey, reach, layout.pathSegments, range.start, range.end);
  // chunkWidth = étendue du maillage (calée sur la clôture) ; layout.plotWidth =
  // largeur GLOBALE du couloir, utilisée pour le fondu de bordure afin qu'il
  // reste invariant d'un chunk à l'autre (pas de couture aux jointures).
  const terrain = new TerrainChunk(companyId, frame, chunkWidth, layout.plotWidth, layout.plotDepth, range.start, range.end, mat);

  const [grass, veg, biomes] = await Promise.all([
    shouldHaveGrass(karma, ambiance.seasonKey)
      ? GrassField.create(companyId, karma, frame, chunkWidth, layout.plotDepth, range.start, range.end, terrain, {
          // Pas d'herbe sur le chemin peint dans la splat (sol nu cohérent avec la texture).
          exclude: (wx, wz) => {
            const local = toLocal(frame, { x: wx, z: wz });
            return distanceToPath(layout.pathSegments, local.x, local.z) < PATH_HALF_WIDTH;
          },
        })
      : Promise.resolve(null),
    VegetationInstances.create(companyId, frame, chunkWidth, layout.plotDepth, range.start, range.end, terrain, renderer),
    ClusterBiomes.create(companyId, frame, terrain, clustersInChunk),
  ]);

  const fence = buildChunkFence(
    frame, range.start, range.end, reach,
    index === 0, index === layout.chunkCount - 1,
    clustersInChunk, ambiance.scary, terrain,
  );

  return { terrain, grass, veg, fence, biomes };
}

/** Libère toutes les géométries/matériaux d'une tranche. */
export function disposeChunkMeshes(chunk: ChunkMeshes) {
  chunk.terrain.dispose();
  chunk.grass?.dispose();
  chunk.veg?.dispose();
  chunk.biomes?.dispose();
  disposeFence(chunk.fence);
}
