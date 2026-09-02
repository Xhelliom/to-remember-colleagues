// Enceinte d'une tranche de cimetière (phase 3.2) : elle suit le contour réel
// du chemin — une portée de mur variable par chunk, pas un rectangle unique
// pour tout le cimetière — plus un muret bas autour de chaque cluster.
//
// Le mur passe AU-DESSUS du regard (cf. EYE_HEIGHT) : le cimetière doit être un
// lieu clos, pas un enclos qu'on survole des yeux. Une haie plantée à l'intérieur
// le dépasse encore (hedge.ts), pour que la ligne d'horizon soit végétale.
//
// Tout est fusionné en DEUX maillages par tranche (pierre, verdure) : les
// tronçons sont courts pour épouser le relief, mais un tronçon = un draw call
// aurait coûté une trentaine de passes de dessin par chunk.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toWorld, type Frame } from "../worldLayout.ts";
import { EYE_HEIGHT } from "./controls.ts";
import { CLUSTER_RADIUS, hashSeed, type ClusterInfo, type Placement } from "../procedural.ts";
import { buildHedgeGeometry, buildHedgeMaterial } from "./hedge.ts";
import type { TerrainChunk } from "./terrain.ts";

/** Mur d'enceinte : au-dessus des yeux, on ne voit pas par-dessus. */
export const WALL_HEIGHT = EYE_HEIGHT + 0.7;
/** Muret d'un rond-point de cluster : bas, il ceinture sans enfermer les tombes. */
const CLUSTER_RING_HEIGHT = 0.6;
const WALL_THICKNESS = 0.3;
const WALL_COLOR = 0x8a8378;
const SCARY_WALL_COLOR = 0x3a3630;
const WALL_MARGIN = 2; // dégagement entre les tombes et la clôture
const ENTRANCE_OPENING = 3; // demi-largeur de l'ouverture sous l'arche (chunk d'entrée)
const CLUSTER_RING_MARGIN = 1;
const CLUSTER_RING_SEGMENTS = 12;
/** Longueur max d'un tronçon : au-delà, un mur droit décolle du sol vallonné. */
const SEGMENT_MAX_LEN = 4;
/** Enfoncement du pied dans le sol : masque les marches entre tronçons voisins. */
const FOOT_SINK = 0.35;
/** Retrait de la haie vers l'intérieur, depuis l'axe du mur. */
const HEDGE_INSET = 0.7;

/** Demi-largeur de clôture pour un chunk : englobe ses tombes, ou `fallback` si vide (chunk d'entrée sans tombe). */
export function chunkReach(placements: Placement[], chunk: number, fallback: number): number {
  let maxAbsX = 0;
  for (const p of placements) if (p.chunk === chunk) maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
  return maxAbsX > 0 ? maxAbsX + WALL_MARGIN : fallback;
}

/** Segment orienté en coordonnées LOCALES du cimetière. */
type LocalSegment = { x0: number; z0: number; x1: number; z1: number };

/**
 * Découpe un segment en tronçons courts et pose chacun sur le terrain (un mur
 * d'un seul tenant flotterait au-dessus des creux), en accumulant les
 * géométries déjà transformées en repère MONDE — prêtes à fusionner.
 * `make(length, index)` construit la géométrie d'un tronçon, centrée, le long de +Z.
 */
function pushRun(
  out: THREE.BufferGeometry[], frame: Frame, seg: LocalSegment,
  terrain: TerrainChunk | undefined, lift: number,
  make: (length: number, index: number) => THREE.BufferGeometry,
) {
  const total = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
  const count = Math.max(1, Math.ceil(total / SEGMENT_MAX_LEN));
  const matrix = new THREE.Matrix4();
  const euler = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const t0 = i / count, t1 = (i + 1) / count;
    const ax = seg.x0 + (seg.x1 - seg.x0) * t0, az = seg.z0 + (seg.z1 - seg.z0) * t0;
    const bx = seg.x0 + (seg.x1 - seg.x0) * t1, bz = seg.z0 + (seg.z1 - seg.z0) * t1;
    const length = Math.max(0.05, Math.hypot(bx - ax, bz - az));
    const world = toWorld(frame, (ax + bx) / 2, (az + bz) / 2);
    const groundY = terrain ? terrain.getHeightAt(world.x, world.z) : 0;
    euler.set(0, frame.rotY + Math.atan2(bx - ax, bz - az), 0);
    matrix.makeRotationFromEuler(euler).setPosition(world.x, groundY + lift, world.z);
    out.push(make(length, i).applyMatrix4(matrix));
  }
}

/** Tronçons de mur droit le long d'un segment local. */
function pushWall(
  out: THREE.BufferGeometry[], frame: Frame, seg: LocalSegment,
  terrain: TerrainChunk | undefined, height = WALL_HEIGHT,
) {
  pushRun(out, frame, seg, terrain, height / 2 - FOOT_SINK,
    (length) => new THREE.BoxGeometry(WALL_THICKNESS, height, length));
}

/** Haie longeant un segment, décalée de (`inX`, `inZ`) vers l'intérieur. */
function pushHedge(
  out: THREE.BufferGeometry[], frame: Frame, seg: LocalSegment,
  terrain: TerrainChunk | undefined, inX: number, inZ: number, seed: string,
) {
  pushRun(
    out, frame,
    { x0: seg.x0 + inX, z0: seg.z0 + inZ, x1: seg.x1 + inX, z1: seg.z1 + inZ },
    terrain, 0,
    (length, i) => buildHedgeGeometry(length, hashSeed(`hedge:${seed}:${i}`)),
  );
}

/** Rond-point de muret bas autour du centre d'un cluster. */
function pushClusterRing(
  out: THREE.BufferGeometry[], frame: Frame, center: ClusterInfo, terrain: TerrainChunk | undefined,
) {
  const radius = CLUSTER_RADIUS + CLUSTER_RING_MARGIN;
  for (let i = 0; i < CLUSTER_RING_SEGMENTS; i++) {
    const a0 = (i / CLUSTER_RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CLUSTER_RING_SEGMENTS) * Math.PI * 2;
    pushWall(out, frame, {
      x0: center.x + Math.cos(a0) * radius, z0: center.z + Math.sin(a0) * radius,
      x1: center.x + Math.cos(a1) * radius, z1: center.z + Math.sin(a1) * radius,
    }, terrain, CLUSTER_RING_HEIGHT);
  }
}

/** Fusionne les géométries en un maillage unique et l'ajoute au groupe. */
function addMerged(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material) {
  if (!geos.length) return;
  const merged = mergeGeometries(geos);
  for (const g of geos) g.dispose(); // seule la fusion survit
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * Clôture d'une tranche [zStart, zEnd[ : deux murs latéraux à ±`reach` doublés
 * d'une haie intérieure, un bouchon d'entrée (avec ouverture) sur le premier
 * chunk, un bouchon plein sur le dernier, et un muret bas autour de chaque
 * cluster de la tranche.
 * ponytail: pas de raccord perpendiculaire aux jointures internes entre deux
 * tranches de portées différentes — léger écart possible, accepté pour rester simple.
 */
export function buildChunkFence(
  frame: Frame,
  zStart: number,
  zEnd: number,
  reach: number,
  isFirstChunk: boolean,
  isLastChunk: boolean,
  clustersInChunk: ClusterInfo[],
  scary: boolean,
  terrain: TerrainChunk | undefined,
): THREE.Group {
  const stone: THREE.BufferGeometry[] = [];
  const hedge: THREE.BufferGeometry[] = [];

  for (const side of [-1, 1]) {
    const seg = { x0: side * reach, z0: zStart, x1: side * reach, z1: zEnd };
    pushWall(stone, frame, seg, terrain);
    pushHedge(hedge, frame, seg, terrain, -side * HEDGE_INSET, 0, `${zStart}:${side}`);
  }

  if (isFirstChunk) {
    // Entrée : mur seul, sans haie — la percée sous l'arche doit rester lisible.
    for (const side of [-1, 1]) {
      pushWall(stone, frame, { x0: side * ENTRANCE_OPENING, z0: zStart, x1: side * reach, z1: zStart }, terrain);
    }
  }
  if (isLastChunk) {
    const seg = { x0: -reach, z0: zEnd, x1: reach, z1: zEnd };
    pushWall(stone, frame, seg, terrain);
    pushHedge(hedge, frame, seg, terrain, 0, -HEDGE_INSET, `${zEnd}:fond`);
  }

  for (const c of clustersInChunk) pushClusterRing(stone, frame, c, terrain);

  const group = new THREE.Group();
  addMerged(group, stone, new THREE.MeshStandardMaterial({ color: scary ? SCARY_WALL_COLOR : WALL_COLOR, roughness: 1 }));
  addMerged(group, hedge, buildHedgeMaterial());
  return group;
}

/** Libère géométries et matériaux d'un groupe de clôture. */
export function disposeFence(group: THREE.Group) {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    (mesh.material as THREE.Material | undefined)?.dispose();
  }
}
