// Construction et destruction des maillages d'une TRANCHE [zStart, zEnd[ de
// cimetière (terrain, herbe, végétation, clôture) — phase 3 du plan. Extrait
// de cemetery.ts pour rester sous la limite de 500 lignes par fichier.
import type * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";
import { distanceToPath, type CemeteryLayout, type ChunkRange } from "../procedural.ts";
import { toLocal, toWorld, type Frame } from "../worldLayout.ts";
import { buildGroundMaterial, PATH_HALF_WIDTH } from "./grass.ts";
import { GrassField, shouldHaveGrass } from "./grassField.ts";
import { TerrainChunk } from "./terrain.ts";
import { VegetationInstances } from "./vegetation.ts";
import { buildChunkFence, chunkReach, disposeFence } from "./fence.ts";
import { ClusterBiomes } from "./biomes/clairiere/builder.ts";
import { DeadfallField } from "./deadfallField.ts";
import { UnderstoryField } from "./trees/understoryField.ts";
import { buildLanterns } from "./roadLanterns.ts";
import { disposeObject } from "./disposeObject.ts";
import { buildPondWater, cemeteryPonds, pondDepth, pondsInRange } from "./pond.ts";

const LAMP_HEIGHT = 3.2;    // m — un vrai lampadaire, pas une borne de jardin
const LAMP_SPACING = 11;    // m entre deux lampadaires le long de l'allée
const LAMP_OFFSET = 1.8;    // m — en bord d'allée, hors du passage
const LAMP_INTENSITY = 2.4;
/** PointLight réelles par tranche : au-delà, le coût de compilation des shaders
 *  grimpe pour chaque objet éclairé. Les autres têtes se contentent de l'émissif. */
const LIT_LAMPS_PER_CHUNK = 2;

export type ChunkMeshes = {
  terrain: TerrainChunk;
  lamps: THREE.Group;
  water: THREE.Group;
  grass: GrassField | null;
  veg: VegetationInstances | null;
  fence: THREE.Group;
  biomes: ClusterBiomes | null;
  deadfall: DeadfallField | null;
  understory: UnderstoryField | null;
};

/**
 * Lampadaires bordant l'allée dans les limites de la tranche.
 * ponytail: toujours allumés, y compris de jour — comme les bornes de la route.
 * Les indexer sur l'heure imposerait de les retrouver et de les rallumer quand
 * l'ambiance change ; en plein soleil, une tête jaune faible ne se voit pas.
 */
function buildChunkLamps(
  frame: Frame, spinePoints: readonly { x: number; z: number }[], range: ChunkRange, terrain: TerrainChunk,
): THREE.Group {
  const inRange = spinePoints.filter((p) => p.z >= range.start && p.z <= range.end);
  return buildLanterns(inRange.map((p) => toWorld(frame, p.x, p.z)), {
    offset: LAMP_OFFSET,
    spacing: LAMP_SPACING,
    poleHeight: LAMP_HEIGHT,
    litCount: LIT_LAMPS_PER_CHUNK,
    lightIntensity: LAMP_INTENSITY,
    groundY: (x, z) => terrain.getHeightAt(x, z),
  });
}

/** Construit les maillages (terrain, herbe, végétation, clôture) d'une tranche. */
export async function buildChunkMeshes(
  companyId: string,
  frame: Frame,
  layout: CemeteryLayout,
  index: number,
  range: ChunkRange,
  karma: number,
  maintenance: number,
  ambiance: Ambiance,
  renderer?: THREE.WebGLRenderer,
): Promise<ChunkMeshes> {
  const reach = chunkReach(layout.placements, index, layout.plotWidth / 2);
  // Le sol (terrain/herbe/végétation) est calé sur la même portée que la
  // clôture (2 × reach), pas sur la largeur globale du couloir — sinon le sol
  // dépasse le mur d'enceinte.
  const chunkWidth = reach * 2;
  const clustersInChunk = layout.clusters.filter((c) => c.chunk === index);
  const mat = buildGroundMaterial(
    companyId, karma, ambiance.seasonKey, reach, layout.pathSegments, range.start, range.end, ambiance.grassColor,
  );
  // chunkWidth = étendue du maillage (calée sur la clôture) ; layout.plotWidth =
  // largeur GLOBALE du couloir, utilisée pour le fondu de bordure afin qu'il
  // reste invariant d'un chunk à l'autre (pas de couture aux jointures).
  // Les étangs sont calculés pour TOUT le cimetière (déterministe, invariant au
  // découpage) : la tranche ne retient que ceux qu'elle touche, mais le terrain
  // les creuse tous — un étang à cheval sur deux tranches doit se raccorder.
  const ponds = cemeteryPonds(companyId, layout);
  const terrain = new TerrainChunk(
    companyId, frame, chunkWidth, layout.plotWidth, layout.plotDepth, range.start, range.end, mat,
    layout.pathSegments, ponds,
  );
  const water = buildPondWater(pondsInRange(ponds, range.start, range.end), (x, z) => toWorld(frame, x, z));

  const veg = VegetationInstances.create(companyId, frame, chunkWidth, layout.plotDepth, range.start, range.end, terrain, renderer);
  const biomes = ClusterBiomes.create(companyId, frame, terrain, clustersInChunk);
  const grass = await (shouldHaveGrass(karma, ambiance.seasonKey)
      ? GrassField.create(companyId, karma, frame, chunkWidth, layout.plotDepth, range.start, range.end, terrain, {
          // Pas d'herbe sur le chemin peint dans la splat (sol nu cohérent avec
          // la texture) ni dans l'eau.
          // ponytail: seule l'herbe est exclue des étangs. Arbres et rochers y
          // sont mille fois moins denses (0,004/m²) ; les en écarter voudrait
          // dire propager les étangs jusqu'à vegetation/deadfall/understory.
          exclude: (wx, wz) => {
            const local = toLocal(frame, { x: wx, z: wz });
            return distanceToPath(layout.pathSegments, local.x, local.z) < PATH_HALF_WIDTH
              || pondDepth(local.x, local.z, ponds) > 0;
          },
        })
    : Promise.resolve(null));

  const fence = buildChunkFence(
    frame, range.start, range.end, reach,
    index === 0, index === layout.chunkCount - 1,
    clustersInChunk, ambiance.scary, terrain,
  );

  const deadfall = DeadfallField.create(
    companyId, frame, chunkWidth, range.start, range.end, layout.pathSegments, terrain, karma, maintenance,
  );
  const understory = UnderstoryField.create(
    companyId, frame, chunkWidth, range.start, range.end, layout.pathSegments, terrain, veg?.treeLod?.placements ?? [],
  );

  const lamps = buildChunkLamps(frame, layout.spinePoints, range, terrain);

  return { terrain, lamps, water, grass, veg, fence, biomes, deadfall, understory };
}

/** Libère toutes les géométries/matériaux d'une tranche. */
export function disposeChunkMeshes(chunk: ChunkMeshes) {
  chunk.terrain.dispose();
  disposeObject(chunk.lamps);
  disposeObject(chunk.water);
  chunk.grass?.dispose();
  chunk.veg?.dispose();
  chunk.biomes?.dispose();
  chunk.deadfall?.dispose();
  chunk.understory?.dispose();
  disposeFence(chunk.fence);
}
