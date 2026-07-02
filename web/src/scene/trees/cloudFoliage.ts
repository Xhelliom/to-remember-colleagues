// Feuillage « nuage » (mission banc-générateur) : gros blobs low-poly —
// icosphères déformées par un bruit LISSE directionnel — posés sur les clusters
// d'ancres du squelette (skeleton.ts), à la place des lames individuelles. Donne
// une canopée pleine et facettée, façon dessin/illustration. Réutilise le
// clustering déterministe des cartes (foliageCards.ts).
import * as THREE from "three";
import type { LeafAnchor } from "./skeleton.ts";
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";
import { addWindWeightAttribute, applyWind, SOFT_TREE_WIND_POOL } from "../wind.ts";
import { clusterFoliageAnchors, type CardCluster } from "./foliageCards.ts";

const CLOUD_COLOR = 0x4c7a34;
const CLOUD_ROUGHNESS = 0.9;
const CLOUD_DETAIL = 1; // subdivisions d'icosphère (bas = facetté « dessin »)
const CLOUD_MIN_RADIUS = 0.55; // rayon plancher d'un blob (m)
const CLOUD_RADIUS_SCALE = 1.7; // blob > étendue du cluster → recouvrement = canopée pleine
const CLOUD_LUMP_AMP = 0.28; // amplitude de bosselure (0 = sphère lisse)
const LUMP_FREQ_MIN = 2;
const LUMP_FREQ_RANGE = 3;

type Lump = { fx: number; fy: number; fz: number; px: number; py: number; pz: number };

function lumpParams(rand: () => number): Lump {
  const f = (): number => LUMP_FREQ_MIN + rand() * LUMP_FREQ_RANGE;
  const p = (): number => rand() * Math.PI * 2;
  return { fx: f(), fy: f(), fz: f(), px: p(), py: p(), pz: p() };
}

/** Déformation lisse (∈ ~[-1,1]) selon la DIRECTION du sommet — fonction
 *  continue, donc les sommets voisins bougent de façon cohérente (pas
 *  d'éclatement du maillage), tout en donnant un contour bosselé de nuage. */
function lumpFactor(dir: THREE.Vector3, l: Lump): number {
  return (Math.sin(dir.x * l.fx + l.px) + Math.sin(dir.y * l.fy + l.py) + Math.sin(dir.z * l.fz + l.pz)) / 3;
}

/** Pousse un blob (icosphère déformée) centré sur le cluster. Normales par
 *  sommet : radiales si `smooth` (ombrage lisse), de face sinon (facettes
 *  « dessin »). Pas de `computeVertexNormals` global → chaque blob décide. */
function pushPuff(
  positions: number[], normals: number[], cluster: CardCluster, seed: number, index: number, smooth: boolean,
): void {
  const rand = seededRandom(hashSeed(`cloud:${seed}:${index}`));
  const lump = lumpParams(rand);
  const radius = Math.max(CLOUD_MIN_RADIUS, cluster.radius * CLOUD_RADIUS_SCALE);
  const ico = new THREE.IcosahedronGeometry(1, CLOUD_DETAIL);
  const geo = ico.index ? ico.toNonIndexed() : ico;
  const src = geo.getAttribute("position");
  const dirs: THREE.Vector3[] = [];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < src.count; i++) {
    const dir = new THREE.Vector3(src.getX(i), src.getY(i), src.getZ(i)).normalize();
    const scale = radius * (1 + CLOUD_LUMP_AMP * lumpFactor(dir, lump));
    dirs.push(dir);
    pts.push(new THREE.Vector3(cluster.center.x + dir.x * scale, cluster.center.y + dir.y * scale, cluster.center.z + dir.z * scale));
  }
  for (let t = 0; t < pts.length; t += 3) {
    const faceN = smooth ? undefined
      : new THREE.Vector3().crossVectors(pts[t + 1].clone().sub(pts[t]), pts[t + 2].clone().sub(pts[t])).normalize();
    for (let k = 0; k < 3; k++) {
      const p = pts[t + k], n = faceN ?? dirs[t + k];
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
    }
  }
  if (geo !== ico) geo.dispose();
  ico.dispose();
}

export type CloudFoliageBuild = {
  readonly mesh: THREE.Mesh;
  readonly triangleCount: number;
  readonly cloudCount: number;
  dispose(): void;
};

/** Mesh « nuage » complet : un blob par cluster d'ancres, fusionnés en UNE
 *  géométrie non indexée (normales de face → facettes stylisées), vent souple
 *  partagé (comme le feuillage réel). Déterministe : même `(anchors, seed)` →
 *  mêmes blobs (clustering + bruit dérivés de la graine, pas de Math.random). */
export function buildCloudFoliage(anchors: readonly LeafAnchor[], seed: number, smooth = false): CloudFoliageBuild {
  const clusters = clusterFoliageAnchors(anchors, seed);
  const positions: number[] = [];
  const normals: number[] = [];
  clusters.forEach((cluster, i) => pushPuff(positions, normals, cluster, seed, i, smooth));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  addWindWeightAttribute(geometry, SOFT_TREE_WIND_POOL);

  const base = new THREE.MeshStandardMaterial({ color: CLOUD_COLOR, roughness: CLOUD_ROUGHNESS });
  const material = applyWind(base, { pool: SOFT_TREE_WIND_POOL });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    triangleCount: positions.length / 9,
    cloudCount: clusters.length,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
