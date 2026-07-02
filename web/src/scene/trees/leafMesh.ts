// Feuillage : vraies feuilles (lames planes), pas des sprites plaqués — posées
// aux ancres du squelette (phyllotaxie, cf. skeleton.ts), groupées en SPRAYS
// (plusieurs lames par ancre, tuft dense) et fusionnées en une seule
// géométrie non indexée. Prépare la capture d'atlas de la mission 09.
import * as THREE from "three";
import type { LeafAnchor, Vec3 } from "./skeleton.ts";
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";

/** Nombre de lames par ancre selon le palier de LOD (0 = hero, le plus dense). */
const LEAVES_PER_ANCHOR_BY_LOD = [6, 4, 2, 1] as const; // + dense (feuillage trop clairsemé)
const LEAF_LENGTH = 0.14; // m — feuille de hêtre stylisée, agrandie pour combler la couronne
const LEAF_WIDTH = 0.085; // m
/** Écart angulaire entre les lames d'un même spray, autour de l'axe de pousse. */
const SPRAY_SPREAD_ANGLE = 0.6; // rad

/** Nombre de lames du bouquet synthétique de capture d'atlas (mission 09) —
 *  dense pour bien remplir une tuile, indépendant de la densité par ancre du
 *  feuillage réel (`LEAVES_PER_ANCHOR_BY_LOD`). */
const ATLAS_SPRAY_LEAF_COUNT = 11;
/** Rayon (m) du bouquet de capture — sert aussi à cadrer la caméra ortho de
 *  `atlasCapture.ts` (mission 09), les deux doivent rester cohérents. */
export const SPRAY_CAPTURE_RADIUS = 0.3;
/** Décalage en profondeur (m) du bouquet, en plus/moins de `SPRAY_CAPTURE_RADIUS`
 *  — donne un peu de volume vu de biais sans faire sortir les lames du cadrage. */
const ATLAS_SPRAY_DEPTH_JITTER = 0.4;

/** Silhouette locale d'une lame (x = largeur, y = longueur depuis la base attachée à la brindille). */
const LEAF_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.55, 0.28],
  [0.65, 0.6],
  [0, 1],
  [-0.65, 0.6],
  [-0.55, 0.28],
];

export type LeafMeshResult = { readonly geometry: THREE.BufferGeometry; readonly triangleCount: number };

type VertSpec = { readonly p: THREE.Vector3; readonly n: THREE.Vector3; readonly u: number; readonly v: number };

function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function pushTri(positions: number[], normals: number[], uvs: number[], a: VertSpec, b: VertSpec, c: VertSpec): void {
  for (const s of [a, b, c]) {
    positions.push(s.p.x, s.p.y, s.p.z);
    normals.push(s.n.x, s.n.y, s.n.z);
    uvs.push(s.u, s.v);
  }
}

function leavesPerAnchorForLod(lod: number): number {
  const i = Math.max(0, Math.min(lod, LEAVES_PER_ANCHOR_BY_LOD.length - 1));
  return LEAVES_PER_ANCHOR_BY_LOD[i];
}

/** Repère local d'une lame : axe de longueur = normale de l'ancre (direction
 *  de pousse), normale de face = `up` de l'ancre tourné de `sprayAngle`
 *  autour de l'axe de longueur — fait « éventailler » les lames d'un spray. */
function leafBasis(anchor: LeafAnchor, sprayAngle: number) {
  const lengthAxis = toVector3(anchor.normal).normalize();
  const faceNormal = toVector3(anchor.up).applyAxisAngle(lengthAxis, sprayAngle).normalize();
  const right = new THREE.Vector3().crossVectors(faceNormal, lengthAxis).normalize();
  return { right, lengthAxis, faceNormal };
}

function pushLeaf(
  positions: number[], normals: number[], uvs: number[],
  anchor: LeafAnchor, index: number, count: number,
): void {
  const sprayAngle = count > 1 ? (index - (count - 1) / 2) * SPRAY_SPREAD_ANGLE : 0;
  const { right, lengthAxis, faceNormal } = leafBasis(anchor, sprayAngle);
  const base = toVector3(anchor.position);
  for (let i = 1; i < LEAF_OUTLINE.length - 1; i++) {
    const tri = [LEAF_OUTLINE[0], LEAF_OUTLINE[i], LEAF_OUTLINE[i + 1]].map(([lx, ly]) => ({
      p: base.clone()
        .addScaledVector(right, lx * LEAF_WIDTH * anchor.scale)
        .addScaledVector(lengthAxis, ly * LEAF_LENGTH * anchor.scale),
      n: faceNormal,
      u: lx * 0.5 + 0.5,
      v: ly,
    }));
    pushTri(positions, normals, uvs, tri[0], tri[1], tri[2]);
  }
}

/** Feuillage complet : `leavesPerAnchorForLod(lod)` lames par ancre du
 *  squelette, fusionnées en une seule géométrie non indexée. */
export function buildFoliageGeometry(anchors: readonly LeafAnchor[], lod = 0): LeafMeshResult {
  const perAnchor = leavesPerAnchorForLod(lod);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const anchor of anchors) {
    for (let i = 0; i < perAnchor; i++) pushLeaf(positions, normals, uvs, anchor, i, perAnchor);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return { geometry, triangleCount: positions.length / 9 };
}

// --- Bouquet synthétique pour la capture d'atlas (mission 09, atlasCapture.ts) ---

/** Vecteur perpendiculaire quelconque à `n` (repère local) — variante THREE de
 *  la fonction du même nom dans skeleton.ts (fichier interdit à l'édition par
 *  la partition de la mission 09, cf. plan/09-arbres-cards-atlas.md). */
function perpendicularUnit(n: THREE.Vector3): THREE.Vector3 {
  const reference = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(n, reference).normalize();
}

/**
 * Bouquet synthétique de feuilles (pas un vrai squelette) pour la capture
 * d'atlas : les lames sont majoritairement tournées vers la caméra de capture
 * (+Z) avec un peu de dispersion 3D, pour un effet "touffe" une fois vues de
 * biais. Une variante par tuile de l'atlas 2×2 (`variantSeed` = index de
 * tuile), déterministe (mulberry32 + FNV-1a, comme le reste de la génération).
 */
export function buildAtlasSprayAnchors(variantSeed: number): LeafAnchor[] {
  const rand = seededRandom(hashSeed(`leaf-spray:${variantSeed}`));
  const anchors: LeafAnchor[] = [];
  for (let i = 0; i < ATLAS_SPRAY_LEAF_COUNT; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = SPRAY_CAPTURE_RADIUS * Math.sqrt(rand()); // disque uniforme
    const depth = (rand() - 0.5) * SPRAY_CAPTURE_RADIUS * ATLAS_SPRAY_DEPTH_JITTER;
    const position: Vec3 = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: depth };
    const normal = new THREE.Vector3((rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6, 0.7 + rand() * 0.3).normalize();
    const up = perpendicularUnit(normal);
    anchors.push({
      position,
      normal: { x: normal.x, y: normal.y, z: normal.z },
      up: { x: up.x, y: up.y, z: up.z },
      scale: 0.85 + rand() * 0.3,
    });
  }
  return anchors;
}
