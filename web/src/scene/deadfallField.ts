// Placement du bois mort dans le monde, PAR CHUNK (plan REVUE_AMELIORATIONS_
// RENDU_PARCOURS.md §2.7) : deadfall.ts est un builder pur déjà codé/testé
// mais jamais monté — ce module décide OÙ (hors chemin, densité liée au
// karma/entretien moyen du cimetière : un lieu négligé accumule les troncs
// moussus).
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { distanceToPath, hashSeed, type PathSegment } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { disposeObject } from "./disposeObject.ts";
import { PATH_HALF_WIDTH } from "./grass.ts";
import { buildFallenTrunk, buildMushroomCluster, buildStump, type DeadfallPiece } from "./deadfall.ts";
import type { TerrainChunk } from "./terrain.ts";

const BORDER_MARGIN = 1.5; // reste en-deçà du mur d'enceinte (cf. grassField.ts)
const NEGLECTED_KARMA_THRESHOLD = -5; // même seuil que grass.ts (paysage désolé)
const BASE_PIECE_COUNT = 1;
const MAX_PIECE_COUNT = 3;
const PLACEMENT_ATTEMPTS = 8; // tentatives de rejet (hors chemin) avant d'abandonner une pièce
const DEADFALL_PATH_CLEARANCE = PATH_HALF_WIDTH * 1.6; // marge sup. à l'herbe : objet solide, pas juste une texture
const MUSHROOM_CHANCE = 0.4; // proba de champignons au pied d'une pièce fraîchement posée

const PIECE_BUILDERS: readonly ((seed: number) => DeadfallPiece)[] = [buildFallenTrunk, buildStump];

/** Position locale hors chemin (rejet), ou `null` si aucune place trouvée en
 *  `PLACEMENT_ATTEMPTS` essais (chunk étroit / chemin qui occupe tout). */
function randomClearLocalPosition(
  rand: () => number, halfWidth: number, zStart: number, zEnd: number, pathSegments: PathSegment[],
): { lx: number; lz: number } | null {
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const lx = (rand() * 2 - 1) * halfWidth;
    const lz = zStart + rand() * (zEnd - zStart);
    if (distanceToPath(pathSegments, lx, lz) >= DEADFALL_PATH_CLEARANCE) return { lx, lz };
  }
  return null;
}

/** Nombre de pièces (1..MAX_PIECE_COUNT) : monte avec le négligé (entretien
 *  bas et/ou karma très négatif, même seuil que grass.ts). */
export function pieceCountFor(karma: number, maintenance: number): number {
  const neglect = (maintenance < 0.5 ? 1 : 0) + (karma < NEGLECTED_KARMA_THRESHOLD ? 1 : 0);
  return Math.min(MAX_PIECE_COUNT, BASE_PIECE_COUNT + neglect);
}

export class DeadfallField {
  readonly group = new THREE.Group();

  /** `null` si aucune pièce n'a pu être placée (chunk sans place hors chemin). */
  static create(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    zStart: number,
    zEnd: number,
    pathSegments: PathSegment[],
    terrain: TerrainChunk,
    karma: number,
    maintenance: number,
  ): DeadfallField | null {
    const halfWidth = plotWidth / 2 - BORDER_MARGIN;
    const fieldSeed = hashSeed(`${companyId}:deadfall:${zStart}`);
    const rand = seededRandom(fieldSeed);
    const pieceCount = pieceCountFor(karma, maintenance);
    const field = new DeadfallField();

    for (let i = 0; i < pieceCount; i++) {
      const pos = randomClearLocalPosition(rand, halfWidth, zStart, zEnd, pathSegments);
      if (!pos) continue;
      const world = toWorld(frame, pos.lx, pos.lz);
      const y = terrain.getHeightAt(world.x, world.z);

      const builder = PIECE_BUILDERS[Math.floor(rand() * PIECE_BUILDERS.length)];
      const pieceSeed = hashSeed(`${companyId}:deadfall:${zStart}:${i}`);
      const piece = builder(pieceSeed);
      piece.group.position.set(world.x, y, world.z);
      piece.group.rotation.y = rand() * Math.PI * 2;
      field.group.add(piece.group);

      if (rand() < MUSHROOM_CHANCE) {
        const mushroomSeed = hashSeed(`${companyId}:deadfall-mushroom:${zStart}:${i}`);
        const mushrooms = buildMushroomCluster(mushroomSeed);
        mushrooms.group.position.set(world.x, y, world.z);
        field.group.add(mushrooms.group);
      }
    }

    return field.group.children.length > 0 ? field : null;
  }

  dispose(): void {
    disposeObject(this.group);
  }
}
