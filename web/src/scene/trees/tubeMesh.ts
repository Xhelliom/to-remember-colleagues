// Maillage de l'écorce (tronc + branches) : UN anneau par nœud du squelette,
// relié à l'anneau de son parent. Le repère de chaque anneau est propagé depuis
// la racine par TRANSPORT PARALLÈLE (rotation minimale d'une tangente à la
// suivante) → aucune vrille entre segments, donc pas de couture ; l'anneau d'un
// nœud est PARTAGÉ entre son segment entrant et ses segments sortants → les
// fourches n'ont plus de double-anneau désaligné. Les bouts de brindille sont
// refermés par un capuchon en éventail.
import * as THREE from "three";
import type { SkeletonNode, TreeSkeleton, Vec3 } from "./skeleton.ts";

/** Segments radiaux par palier de LOD (index 0 = hero, le plus détaillé). */
const RADIAL_SEGMENTS_BY_LOD = [10, 6, 5, 4] as const;
const TWO_PI = Math.PI * 2;
/** Distance (× rayon) de l'apex du capuchon au-delà du dernier nœud d'une brindille. */
const CAP_APEX_RATIO = 1.15;
/** En-deçà, deux tangentes sont considérées colinéaires (pas de rotation de repère). */
const FRAME_EPSILON = 1e-6;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);

export type TubeMeshResult = { readonly geometry: THREE.BufferGeometry; readonly triangleCount: number };

type VertSpec = { readonly p: THREE.Vector3; readonly n: THREE.Vector3; readonly u: number; readonly v: number };
type NodeFrame = { readonly tangent: THREE.Vector3; readonly right: THREE.Vector3; readonly up: THREE.Vector3 };
type RingVert = { readonly p: THREE.Vector3; readonly n: THREE.Vector3 };

function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function radialSegmentsForLod(lod: number): number {
  const i = Math.max(0, Math.min(lod, RADIAL_SEGMENTS_BY_LOD.length - 1));
  return RADIAL_SEGMENTS_BY_LOD[i];
}

/** Base orthonormée perpendiculaire à `dir`, stable même proche de la verticale
 *  (bascule sur un axe de secours plutôt que de dégénérer) — repère de la racine. */
function ringBasis(dir: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const reference = Math.abs(dir.dot(WORLD_UP)) > 0.98 ? FALLBACK_AXIS : WORLD_UP;
  const right = new THREE.Vector3().crossVectors(dir, reference).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}

/** Transport parallèle du repère `prev` le long du changement de tangente
 *  (rotation de Rodrigues d'angle minimal) → pas de vrille accumulée. */
function transportFrame(prev: NodeFrame, tangent: THREE.Vector3): NodeFrame {
  const axis = new THREE.Vector3().crossVectors(prev.tangent, tangent);
  const sin = axis.length();
  if (sin < FRAME_EPSILON) return { tangent, right: prev.right.clone(), up: prev.up.clone() };
  axis.normalize();
  const angle = Math.atan2(sin, prev.tangent.dot(tangent));
  return {
    tangent,
    right: prev.right.clone().applyAxisAngle(axis, angle),
    up: prev.up.clone().applyAxisAngle(axis, angle),
  };
}

/** Un repère par nœud, propagé depuis la racine (les nœuds sont en ordre :
 *  `parent` toujours avant l'enfant, cf. skeleton.ts → une seule passe). */
function computeNodeFrames(nodes: readonly SkeletonNode[]): NodeFrame[] {
  const frames: NodeFrame[] = [];
  nodes.forEach((node, i) => {
    if (node.parent === -1) {
      const { right, up } = ringBasis(WORLD_UP);
      frames[i] = { tangent: WORLD_UP.clone(), right, up };
      return;
    }
    const tangent = toVector3(node.position).sub(toVector3(nodes[node.parent].position));
    if (tangent.lengthSq() < FRAME_EPSILON) tangent.copy(frames[node.parent].tangent);
    else tangent.normalize();
    frames[i] = transportFrame(frames[node.parent], tangent);
  });
  return frames;
}

/** Anneau de `segments + 1` sommets (le dernier duplique le premier pour la
 *  coupure d'UV) autour du nœud, dans le plan (right, up) du repère. */
function nodeRing(node: SkeletonNode, frame: NodeFrame, segments: number): RingVert[] {
  const center = toVector3(node.position);
  const ring: RingVert[] = [];
  for (let k = 0; k <= segments; k++) {
    const a = (k / segments) * TWO_PI;
    const n = frame.right.clone().multiplyScalar(Math.cos(a)).addScaledVector(frame.up, Math.sin(a));
    ring.push({ p: center.clone().addScaledVector(n, node.radius), n });
  }
  return ring;
}

function pushTri(positions: number[], normals: number[], uvs: number[], a: VertSpec, b: VertSpec, c: VertSpec): void {
  for (const s of [a, b, c]) {
    positions.push(s.p.x, s.p.y, s.p.z);
    normals.push(s.n.x, s.n.y, s.n.z);
    uvs.push(s.u, s.v);
  }
}

/** Relie l'anneau `from` (v = `vFrom`) à l'anneau `to` (v = `vTo`) — winding
 *  SORTANT (cf. tubeMesh.test.ts), normales radiales par sommet (lissage). */
function connectRings(
  positions: number[], normals: number[], uvs: number[],
  from: RingVert[], to: RingVert[], vFrom: number, vTo: number, segments: number,
): void {
  for (let k = 0; k < segments; k++) {
    const u0 = k / segments, u1 = (k + 1) / segments;
    const pf0: VertSpec = { p: from[k].p, n: from[k].n, u: u0, v: vFrom };
    const pf1: VertSpec = { p: from[k + 1].p, n: from[k + 1].n, u: u1, v: vFrom };
    const pt0: VertSpec = { p: to[k].p, n: to[k].n, u: u0, v: vTo };
    const pt1: VertSpec = { p: to[k + 1].p, n: to[k + 1].n, u: u1, v: vTo };
    pushTri(positions, normals, uvs, pf0, pt1, pf1);
    pushTri(positions, normals, uvs, pf0, pt0, pt1);
  }
}

/** Capuchon en éventail au bout d'une brindille (aucun enfant) — referme le tube. */
function pushCap(
  positions: number[], normals: number[], uvs: number[],
  node: SkeletonNode, frame: NodeFrame, ring: RingVert[], v: number, segments: number,
): void {
  const apex = toVector3(node.position).addScaledVector(frame.tangent, node.radius * CAP_APEX_RATIO);
  for (let k = 0; k < segments; k++) {
    // n1 avant n0 : même winding sortant que connectRings.
    pushTri(
      positions, normals, uvs,
      { p: ring[k + 1].p, n: frame.tangent, u: (k + 1) / segments, v },
      { p: ring[k].p, n: frame.tangent, u: k / segments, v },
      { p: apex, n: frame.tangent, u: 0.5, v },
    );
  }
}

/** Indices de nœuds ayant au moins un enfant (les autres sont des bouts de brindille). */
function computeHasChildren(nodes: readonly SkeletonNode[]): boolean[] {
  const has = new Array(nodes.length).fill(false);
  for (const n of nodes) if (n.parent !== -1) has[n.parent] = true;
  return has;
}

/** Écorce (tronc + branches) en UNE géométrie non indexée : un anneau par nœud
 *  (repère transporté → sans couture), relié à l'anneau de son parent. `v` =
 *  longueur cumulée le long de la chaîne (continuité du bruit d'écorce). */
export function buildBarkGeometry(skeleton: TreeSkeleton, lod = 0): TubeMeshResult {
  const segments = radialSegmentsForLod(lod);
  const { nodes } = skeleton;
  const frames = computeNodeFrames(nodes);
  const rings = nodes.map((node, i) => nodeRing(node, frames[i], segments));
  const hasChildren = computeHasChildren(nodes);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const vAt: number[] = [];

  nodes.forEach((node, i) => {
    if (node.parent === -1) { vAt[i] = 0; return; }
    const parent = nodes[node.parent];
    vAt[i] = vAt[node.parent] + toVector3(node.position).distanceTo(toVector3(parent.position));
    connectRings(positions, normals, uvs, rings[node.parent], rings[i], vAt[node.parent], vAt[i], segments);
    if (!hasChildren[i]) pushCap(positions, normals, uvs, node, frames[i], rings[i], vAt[i], segments);
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
