// Maillage de l'écorce (tronc + branches) : un tronçon conique par lien
// parent→enfant du squelette (rayon dégressif), assemblés en UNE géométrie
// non indexée. Approximation volontaire — pas de continuité de repère entre
// segments ni de fusion propre aux fourches (ponytail : suffisant pour un
// hero UNIQUE ; à raffiner seulement si des coutures deviennent visibles à
// l'écran, cf. plan/08-arbres-grammaire.md).
import * as THREE from "three";
import type { SkeletonNode, TreeSkeleton, Vec3 } from "./skeleton.ts";

/** Segments radiaux par palier de LOD (index 0 = hero, le plus détaillé). */
const RADIAL_SEGMENTS_BY_LOD = [6, 5, 4, 3] as const;
const TWO_PI = Math.PI * 2;
/** Distance (× rayon) de l'apex du capuchon au-delà du dernier nœud d'une brindille. */
const CAP_APEX_RATIO = 1.15;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);

export type TubeMeshResult = { readonly geometry: THREE.BufferGeometry; readonly triangleCount: number };

type VertSpec = { readonly p: THREE.Vector3; readonly n: THREE.Vector3; readonly u: number; readonly v: number };

function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function radialSegmentsForLod(lod: number): number {
  const i = Math.max(0, Math.min(lod, RADIAL_SEGMENTS_BY_LOD.length - 1));
  return RADIAL_SEGMENTS_BY_LOD[i];
}

/** Base orthonormée perpendiculaire à `dir`, stable même proche de la verticale
 *  (bascule sur un axe de secours plutôt que de dégénérer). */
function ringBasis(dir: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const reference = Math.abs(dir.dot(WORLD_UP)) > 0.98 ? FALLBACK_AXIS : WORLD_UP;
  const right = new THREE.Vector3().crossVectors(dir, reference).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}

function ringNormal(basis: { right: THREE.Vector3; up: THREE.Vector3 }, angle: number): THREE.Vector3 {
  return new THREE.Vector3()
    .addScaledVector(basis.right, Math.cos(angle))
    .addScaledVector(basis.up, Math.sin(angle));
}

function pushTri(positions: number[], normals: number[], uvs: number[], a: VertSpec, b: VertSpec, c: VertSpec): void {
  for (const s of [a, b, c]) {
    positions.push(s.p.x, s.p.y, s.p.z);
    normals.push(s.n.x, s.n.y, s.n.z);
    uvs.push(s.u, s.v);
  }
}

/** Tronçon conique parent→enfant : un anneau de `segments` côtés à chaque
 *  bout, rayon interpolé. Renvoie la direction (réutilisée par le capuchon
 *  de bout de brindille). */
function pushSegment(
  positions: number[], normals: number[], uvs: number[],
  from: SkeletonNode, to: SkeletonNode, segments: number,
): THREE.Vector3 {
  const fromPos = toVector3(from.position);
  const toPos = toVector3(to.position);
  const dir = toPos.clone().sub(fromPos);
  if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0); else dir.normalize();
  const basis = ringBasis(dir);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TWO_PI;
    const a1 = ((i + 1) / segments) * TWO_PI;
    const n0 = ringNormal(basis, a0);
    const n1 = ringNormal(basis, a1);
    const p0f: VertSpec = { p: fromPos.clone().addScaledVector(n0, from.radius), n: n0, u: i / segments, v: 0 };
    const p1f: VertSpec = { p: fromPos.clone().addScaledVector(n1, from.radius), n: n1, u: (i + 1) / segments, v: 0 };
    const p0t: VertSpec = { p: toPos.clone().addScaledVector(n0, to.radius), n: n0, u: i / segments, v: 1 };
    const p1t: VertSpec = { p: toPos.clone().addScaledVector(n1, to.radius), n: n1, u: (i + 1) / segments, v: 1 };
    pushTri(positions, normals, uvs, p0f, p1f, p1t);
    pushTri(positions, normals, uvs, p0f, p1t, p0t);
  }
  return dir;
}

/** Capuchon en éventail au bout d'une brindille (aucun enfant) — referme le tube. */
function pushCap(
  positions: number[], normals: number[], uvs: number[],
  node: SkeletonNode, dir: THREE.Vector3, segments: number,
): void {
  const center = toVector3(node.position);
  const basis = ringBasis(dir);
  const apex = center.clone().addScaledVector(dir, node.radius * CAP_APEX_RATIO);
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TWO_PI;
    const a1 = ((i + 1) / segments) * TWO_PI;
    const n0 = ringNormal(basis, a0);
    const n1 = ringNormal(basis, a1);
    pushTri(
      positions, normals, uvs,
      { p: center.clone().addScaledVector(n0, node.radius), n: dir, u: i / segments, v: 1 },
      { p: center.clone().addScaledVector(n1, node.radius), n: dir, u: (i + 1) / segments, v: 1 },
      { p: apex, n: dir, u: 0.5, v: 1 },
    );
  }
}

/** Indices de nœuds ayant au moins un enfant (les autres sont des bouts de brindille). */
function computeHasChildren(nodes: readonly SkeletonNode[]): boolean[] {
  const has = new Array(nodes.length).fill(false);
  for (const n of nodes) if (n.parent !== -1) has[n.parent] = true;
  return has;
}

/** Écorce (tronc + branches) en UNE géométrie non indexée — tronçons coniques
 *  reliant chaque nœud à son parent, capuchonnés aux bouts de brindille. */
export function buildBarkGeometry(skeleton: TreeSkeleton, lod = 0): TubeMeshResult {
  const segments = radialSegmentsForLod(lod);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const hasChildren = computeHasChildren(skeleton.nodes);

  skeleton.nodes.forEach((node, i) => {
    if (node.parent === -1) return;
    const from = skeleton.nodes[node.parent];
    const dir = pushSegment(positions, normals, uvs, from, node, segments);
    if (!hasChildren[i]) pushCap(positions, normals, uvs, node, dir, segments);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  // Attribut custom (pas "uv" standard three) : évite toute dépendance à
  // USE_UV/vUv, qui ne sont générés que si le matériau a une texture map —
  // notre bruit d'écorce baké (treeBuilder.ts) déclare/consomme son propre
  // varying, exactement comme `aWindWeight` dans wind.ts.
  geometry.setAttribute("aBarkUv", new THREE.Float32BufferAttribute(uvs, 2));
  return { geometry, triangleCount: positions.length / 9 };
}
