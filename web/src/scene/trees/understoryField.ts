// Dispersion du sous-bois (buissons/fougères/fleurs) sous les couronnes
// d'arbres d'un chunk (plan REVUE_AMELIORATIONS_RENDU_PARCOURS.md §2.7) :
// understory.ts est un builder pur déjà codé/testé (`scatterUnderstory`) mais
// jamais monté — ce module lui fournit les vraies couronnes (`TreeLodField.
// placements`) et place hors chemin, en repère MONDE (comme les arbres, cf.
// vegetation.ts).
import * as THREE from "three";
import { distanceToPath, hashSeed, type PathSegment } from "../../procedural.ts";
import { toLocal, toWorld, type Frame } from "../../worldLayout.ts";
import { disposeObject } from "../disposeObject.ts";
import { PATH_HALF_WIDTH } from "../grass.ts";
import { BEECH_SPECIES } from "./skeleton.ts";
import type { TreePlacement } from "./treeLod.ts";
import { buildBush, buildFern, buildFlower, scatterUnderstory, type CanopyDisc } from "./understory.ts";
import type { TerrainChunk } from "../terrain.ts";

const BORDER_MARGIN = 1.5; // reste en-deçà du mur d'enceinte (cf. grassField.ts/deadfallField.ts)
// Densité calée sur le harnais de référence (mountUnderstoryDemoScene) :
// 90 candidats sur un carré 6,4×6,4 m ≈ 2,2 candidats/m² — reproduit ici pour
// un chunk de taille quelconque, plafonnée pour ne pas exploser sur un grand chunk.
const CANDIDATE_DENSITY = 2.2;
const MAX_CANDIDATE_COUNT = 400;
// Marge de dégagement au bord du chemin — plus faible que deadfallField.ts
// (plantes basses, pas des troncs qui bloquent le passage).
const UNDERSTORY_PATH_CLEARANCE = PATH_HALF_WIDTH * 1.3;

export class UnderstoryField {
  readonly group = new THREE.Group();

  /** `null` si aucun arbre dans le chunk (couverture de canopée toujours
   *  nulle → aucun candidat retenu) ou si tous les candidats tombent hors
   *  chemin/couloir. */
  static create(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    zStart: number,
    zEnd: number,
    pathSegments: PathSegment[],
    terrain: TerrainChunk,
    treePlacements: readonly TreePlacement[],
  ): UnderstoryField | null {
    if (treePlacements.length === 0) return null;

    const halfWidth = plotWidth / 2 - BORDER_MARGIN;
    const chunkCenterZ = (zStart + zEnd) / 2;
    const halfExtent = Math.max(halfWidth, (zEnd - zStart) / 2);

    // `scatterUnderstory` disperse toujours candidats ET couronnes autour de
    // l'origine (0,0) — on centre donc tout sur (localX=0, localZ=chunkCenterZ)
    // et on décale le résultat de +chunkCenterZ ensuite.
    const canopies: CanopyDisc[] = treePlacements.map((p) => {
      const local = toLocal(frame, { x: p.x, z: p.z });
      return { cx: local.x, cz: local.z - chunkCenterZ, radius: BEECH_SPECIES.crownRadiusXZ * p.scale };
    });

    const candidateCount = Math.min(MAX_CANDIDATE_COUNT, Math.round(CANDIDATE_DENSITY * (halfExtent * 2) ** 2));
    const seed = hashSeed(`${companyId}:understory:${zStart}`);
    const raw = scatterUnderstory(seed, halfExtent, candidateCount, canopies);

    const field = new UnderstoryField();
    for (const p of raw) {
      const lz = p.z + chunkCenterZ;
      if (Math.abs(p.x) > halfWidth) continue; // hors couloir (fenêtre carrée déborde du rectangle du chunk)
      if (lz < zStart || lz >= zEnd) continue;
      if (distanceToPath(pathSegments, p.x, lz) < UNDERSTORY_PATH_CLEARANCE) continue; // abords de l'épine dégagés

      const world = toWorld(frame, p.x, lz);
      const y = terrain.getHeightAt(world.x, world.z);
      const build = p.kind === "fern" ? buildFern(p.seed) : p.kind === "flower" ? buildFlower(p.seed) : buildBush(p.seed);
      build.group.position.set(world.x, y, world.z);
      build.group.rotation.y = p.rotationY;
      field.group.add(build.group);
    }

    return field.group.children.length > 0 ? field : null;
  }

  dispose(): void {
    disposeObject(this.group);
  }
}
