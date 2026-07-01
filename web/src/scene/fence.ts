// Clôture par segment (phase 3.2) : suit le contour réel du chemin — une
// portée de mur variable par chunk (pas un rectangle unique pour tout le
// cimetière), plus un rond-point de mur autour de chaque cluster.
// ponytail: un seul type câblé ("mur") ; WallType existe pour brancher les
// autres plus tard (haie/clôture — hors scope pour l'instant).
import * as THREE from "three";
import { toWorld, type Frame } from "../worldLayout.ts";
import type { ClusterInfo, Placement } from "../procedural.ts";
import { CLUSTER_RADIUS } from "../procedural.ts";
import type { TerrainChunk } from "./terrain.ts";

export type WallType = "haie" | "cloture" | "mur";

const WALL_HEIGHT = 1;
const WALL_THICKNESS = 0.3;
const WALL_COLOR = 0x8a8378;
const SCARY_WALL_COLOR = 0x3a3630;
const WALL_MARGIN = 2; // dégagement entre les tombes et la clôture
const ENTRANCE_OPENING = 3; // demi-largeur de l'ouverture sous l'arche (chunk d'entrée)
const CLUSTER_RING_MARGIN = 1;
const CLUSTER_RING_SEGMENTS = 12;

/** Demi-largeur de clôture pour un chunk : englobe ses tombes, ou `fallback` si vide (chunk d'entrée sans tombe). */
export function chunkReach(placements: Placement[], chunk: number, fallback: number): number {
  let maxAbsX = 0;
  for (const p of placements) if (p.chunk === chunk) maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
  return maxAbsX > 0 ? maxAbsX + WALL_MARGIN : fallback;
}

/** Segment de mur droit entre deux points LOCAUX (repère du cimetière). */
function buildWallSegment(
  frame: Frame,
  lx0: number, lz0: number, lx1: number, lz1: number,
  mat: THREE.Material,
  terrain: TerrainChunk | undefined,
): THREE.Mesh {
  const dx = lx1 - lx0;
  const dz = lz1 - lz0;
  const length = Math.max(0.05, Math.hypot(dx, dz));
  const geo = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, length);
  const mesh = new THREE.Mesh(geo, mat);
  const midX = (lx0 + lx1) / 2;
  const midZ = (lz0 + lz1) / 2;
  const world = toWorld(frame, midX, midZ);
  const groundY = terrain ? terrain.getHeightAt(world.x, world.z) : 0;
  mesh.position.set(world.x, groundY + WALL_HEIGHT / 2, world.z);
  mesh.rotation.y = frame.rotY + Math.atan2(dx, dz);
  mesh.castShadow = true;
  return mesh;
}

/** Rond-point de mur bas autour du centre d'un cluster. */
function buildClusterRing(
  frame: Frame,
  center: ClusterInfo,
  mat: THREE.Material,
  terrain: TerrainChunk | undefined,
): THREE.Group {
  const group = new THREE.Group();
  const radius = CLUSTER_RADIUS + CLUSTER_RING_MARGIN;
  for (let i = 0; i < CLUSTER_RING_SEGMENTS; i++) {
    const a0 = (i / CLUSTER_RING_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CLUSTER_RING_SEGMENTS) * Math.PI * 2;
    group.add(buildWallSegment(
      frame,
      center.x + Math.cos(a0) * radius, center.z + Math.sin(a0) * radius,
      center.x + Math.cos(a1) * radius, center.z + Math.sin(a1) * radius,
      mat, terrain,
    ));
  }
  return group;
}

/**
 * Clôture d'une tranche [zStart, zEnd[ : deux rails latéraux à ±`reach`, un
 * bouchon d'entrée (avec ouverture) sur le premier chunk, un bouchon plein sur
 * le dernier, et un rond-point autour de chaque cluster de la tranche.
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
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: scary ? SCARY_WALL_COLOR : WALL_COLOR, roughness: 1 });

  for (const side of [-1, 1]) {
    group.add(buildWallSegment(frame, side * reach, zStart, side * reach, zEnd, mat, terrain));
  }

  if (isFirstChunk) {
    for (const side of [-1, 1]) {
      group.add(buildWallSegment(frame, side * ENTRANCE_OPENING, zStart, side * reach, zStart, mat, terrain));
    }
  }
  if (isLastChunk) {
    group.add(buildWallSegment(frame, -reach, zEnd, reach, zEnd, mat, terrain));
  }

  for (const c of clustersInChunk) group.add(buildClusterRing(frame, c, mat, terrain));

  return group;
}

