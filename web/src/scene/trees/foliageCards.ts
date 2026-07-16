// Feuillage en cartes (mission 09) : regroupe les ancres de feuille du
// squelette (skeleton.ts) en clusters spatiaux, pose UNE carte alpha-testée
// par cluster (2 quads croisés = 4 tris) échantillonnant l'atlas capturé
// (atlasCapture.ts) — un volume de couronne bon marché, à la place de
// milliers de lames individuelles (leafMesh.ts) pour les arbres instanciés en
// masse. Le clustering est une fonction PURE (testable sans WebGL), la
// géométrie/matériau consomment Three.js.
import * as THREE from "three";
import type { LeafAnchor, Vec3 } from "./skeleton.ts";
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";
import { addWindWeightAttribute, applyWind, SOFT_TREE_WIND_POOL } from "../wind.ts";
import { ATLAS_GRID } from "./atlasCapture.ts";
import { attachDepthPrepass, buildDepthTwinMaterial, isPrepassEnabled } from "../vegPrepass.ts";

/** Granularité (m) du regroupement d'ancres en clusters — les ancres d'une
 *  même brindille (dispersées dans un rayon `leafSpread` ≈ 0,35 m autour de
 *  son bout, cf. skeleton.ts) tombent presque toujours dans la même cellule. */
const CARD_CLUSTER_CELL = 0.6;
/** Rayon de "portée" (m) d'une feuille individuelle au-delà de son ancre —
 *  pad la carte pour couvrir tout le feuillage réel du cluster sans le rogner. */
const LEAF_FOOTPRINT_PAD = 0.6;
const CARD_MIN_SIZE = 1.2;
const CARD_MAX_SIZE = 3.5;
const CARD_ALPHA_TEST = 0.5;
const CARD_ROUGHNESS = 0.85; // même valeur que FOLIAGE_ROUGHNESS de treeBuilder.ts
const CARD_TILE_UV_STEP = 1 / ATLAS_GRID;
const CARD_TILE_COUNT = ATLAS_GRID * ATLAS_GRID;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);
/** Seuil en-deçà duquel une normale moyenne est considérée dégénérée (mêmes ordre
 *  de grandeur que VEC_EPSILON dans skeleton.ts). */
const NORMAL_EPSILON = 1e-8;

export type CardCluster = {
  readonly center: Vec3;
  readonly normal: Vec3;
  /** Distance max au centre parmi les membres — dimensionne la carte. */
  readonly radius: number;
  readonly memberCount: number;
  /** Index de tuile d'atlas (0..ATLAS_GRID²-1), tiré déterministe par cluster. */
  readonly tile: number;
};

// --- Clustering pur (testable sans WebGL) ---

function cellKey(p: Vec3): string {
  const cx = Math.round(p.x / CARD_CLUSTER_CELL);
  const cy = Math.round(p.y / CARD_CLUSTER_CELL);
  const cz = Math.round(p.z / CARD_CLUSTER_CELL);
  return `${cx}:${cy}:${cz}`;
}

function averageVec3(vs: readonly Vec3[]): Vec3 {
  const sum = vs.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / vs.length, y: sum.y / vs.length, z: sum.z / vs.length };
}

function normalizeOrFallback(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len < NORMAL_EPSILON ? { x: 0, y: 1, z: 0 } : { x: v.x / len, y: v.y / len, z: v.z / len };
}

function maxDistanceTo(center: Vec3, members: readonly LeafAnchor[]): number {
  let max = 0;
  for (const m of members) {
    const d = Math.hypot(m.position.x - center.x, m.position.y - center.y, m.position.z - center.z);
    if (d > max) max = d;
  }
  return max;
}

function clusterFromMembers(members: readonly LeafAnchor[], seed: number, clusterIndex: number): CardCluster {
  const center = averageVec3(members.map((m) => m.position));
  const normal = normalizeOrFallback(averageVec3(members.map((m) => m.normal)));
  const rand = seededRandom(hashSeed(`cards:${seed}:${clusterIndex}`));
  return {
    center,
    normal,
    radius: maxDistanceTo(center, members),
    memberCount: members.length,
    tile: Math.floor(rand() * CARD_TILE_COUNT),
  };
}

/**
 * Regroupe les ancres de feuille en clusters spatiaux (grille régulière de
 * pas `CARD_CLUSTER_CELL`) puis dérive une carte par cluster. Déterministe :
 * même `(anchors, seed)` → mêmes clusters (nombre, position, tuile), toujours
 * (ordre des cellules = ordre d'insertion des ancres, pas de Math.random()).
 */
export function clusterFoliageAnchors(anchors: readonly LeafAnchor[], seed: number): CardCluster[] {
  const cells = new Map<string, LeafAnchor[]>();
  for (const anchor of anchors) {
    const key = cellKey(anchor.position);
    const bucket = cells.get(key);
    if (bucket) bucket.push(anchor); else cells.set(key, [anchor]);
  }
  let clusterIndex = 0;
  const clusters: CardCluster[] = [];
  for (const members of cells.values()) {
    clusters.push(clusterFromMembers(members, seed, clusterIndex));
    clusterIndex++;
  }
  return clusters;
}

function cardSizeForCluster(cluster: CardCluster): number {
  const raw = 2 * (cluster.radius + LEAF_FOOTPRINT_PAD);
  return Math.min(CARD_MAX_SIZE, Math.max(CARD_MIN_SIZE, raw));
}

// --- Géométrie (2 quads croisés par cluster = 4 tris) ---

export type FoliageCardsResult = {
  readonly geometry: THREE.BufferGeometry;
  readonly triangleCount: number;
  readonly cardCount: number;
};

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

/** Repère (droite, haut) perpendiculaire à `normal`, stable même proche de la
 *  verticale (bascule sur un axe de secours plutôt que de dégénérer). */
function cardBasis(normal: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const reference = Math.abs(normal.dot(WORLD_UP)) > 0.98 ? FALLBACK_AXIS : WORLD_UP;
  const right = new THREE.Vector3().crossVectors(reference, normal).normalize();
  const up = new THREE.Vector3().crossVectors(normal, right).normalize();
  return { right, up };
}

/** Coin UV du quad (u,v) dans [0,1) dans la tuile `tile` de l'atlas 2×2. */
function tileUv(tile: number, u: number, v: number): { u: number; v: number } {
  const col = tile % ATLAS_GRID;
  const row = Math.floor(tile / ATLAS_GRID);
  return { u: (col + u) * CARD_TILE_UV_STEP, v: (row + v) * CARD_TILE_UV_STEP };
}

/** Pousse un quad carré centré sur `center`, dans le plan (right, up), 2 tris. */
function pushQuad(
  positions: number[], normals: number[], uvs: number[],
  center: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, size: number, tile: number,
): void {
  const faceNormal = new THREE.Vector3().crossVectors(right, up).normalize();
  const half = size / 2;
  const local: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const verts = local.map(([lx, ly]) => {
    const { u, v } = tileUv(tile, (lx + 1) / 2, (ly + 1) / 2);
    return {
      p: center.clone().addScaledVector(right, lx * half).addScaledVector(up, ly * half),
      n: faceNormal,
      u, v,
    };
  });
  pushTri(positions, normals, uvs, verts[0], verts[1], verts[2]);
  pushTri(positions, normals, uvs, verts[0], verts[2], verts[3]);
}

/** Pousse la carte croisée d'un cluster : 2 quads à 90° partageant l'axe
 *  `up`, l'un dans le plan (right, up) l'autre dans (normal, up) — donne du
 *  volume vu depuis n'importe quel angle horizontal, sans billboard par frame. */
function pushCard(positions: number[], normals: number[], uvs: number[], cluster: CardCluster): void {
  const normal = toVector3(cluster.normal);
  const { right, up } = cardBasis(normal);
  const center = toVector3(cluster.center);
  const size = cardSizeForCluster(cluster);
  pushQuad(positions, normals, uvs, center, right, up, size, cluster.tile);
  pushQuad(positions, normals, uvs, center, normal, up, size, cluster.tile);
}

/** Géométrie fusionnée (non indexée) de toutes les cartes d'un arbre. */
export function buildFoliageCardsGeometry(clusters: readonly CardCluster[]): FoliageCardsResult {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const cluster of clusters) pushCard(positions, normals, uvs, cluster);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return { geometry, triangleCount: positions.length / 9, cardCount: clusters.length };
}

// --- Matériau (atlas + vent + alpha-test + décodage sqrt) ---

/** Injecté après `#include <map_fragment>` : décode l'albedo sqrt-encodé de
 *  l'atlas (`atlasCapture.ts` sqrtEncodeUnit) — inverse = mettre au carré. */
function injectSqrtDecode(shader: Parameters<THREE.Material["onBeforeCompile"]>[0]): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#include <map_fragment>
    diffuseColor.rgb *= diffuseColor.rgb;`,
  );
}

/**
 * Matériau des cartes de feuillage : texture d'atlas (albedo sqrt-encodé,
 * décodé ici), vent souple partagé (comme le feuillage réel), alpha-test +
 * `alphaToCoverage` (MSAA déjà actif, `antialias: true` côté renderer) plutôt
 * que du blend transparent (bords nets, tri du depth correct).
 */
export function buildFoliageCardsMaterial(atlasTexture: THREE.Texture): THREE.Material {
  const base = new THREE.MeshStandardMaterial({
    map: atlasTexture,
    roughness: CARD_ROUGHNESS,
    side: THREE.DoubleSide,
    alphaTest: CARD_ALPHA_TEST,
    alphaToCoverage: true,
    transparent: false,
  });
  const material = applyWind(base, { pool: SOFT_TREE_WIND_POOL });
  const windCompile = material.onBeforeCompile;
  material.onBeforeCompile = (...args) => {
    windCompile(...args);
    injectSqrtDecode(args[0]);
  };
  return material;
}

// --- Assemblage haut niveau (skeleton + atlas → mesh prêt à ajouter à la scène) ---

export type FoliageCardsBuild = {
  readonly mesh: THREE.Mesh;
  readonly triangleCount: number;
  readonly cardCount: number;
  dispose(): void;
};

/** Construit le mesh de cartes complet pour un arbre : clustering déterministe
 *  des ancres + géométrie + matériau (atlas déjà capturé, cf. atlasCapture.ts).
 *  `dispose()` libère la géométrie ET le matériau — PAS la texture d'atlas,
 *  partagée entre tous les arbres (gérée par `resetFoliageAtlasCache`). */
export function buildFoliageCards(anchors: readonly LeafAnchor[], seed: number, atlasTexture: THREE.Texture): FoliageCardsBuild {
  const clusters = clusterFoliageAnchors(anchors, seed);
  const { geometry, triangleCount, cardCount } = buildFoliageCardsGeometry(clusters);
  addWindWeightAttribute(geometry, SOFT_TREE_WIND_POOL);
  const material = buildFoliageCardsMaterial(atlasTexture);
  const mesh = new THREE.Mesh(geometry, material);

  // Prepass profondeur (mission 12, `?prepass=1`) : jumeau depth-only partageant
  // la MÊME géométrie (mêmes clusters, même vent) et le MÊME mask (map + alphaTest)
  // que le matériau couleur — même décision de discard, cf. vegPrepass.test.ts.
  let depthMaterial: THREE.Material | undefined;
  if (isPrepassEnabled()) {
    depthMaterial = buildDepthTwinMaterial({
      pool: SOFT_TREE_WIND_POOL,
      map: atlasTexture,
      alphaTest: CARD_ALPHA_TEST,
    });
    const depthMesh = new THREE.Mesh(geometry, depthMaterial);
    attachDepthPrepass(mesh, depthMesh);
  }

  return {
    mesh, triangleCount, cardCount,
    dispose() { geometry.dispose(); material.dispose(); depthMaterial?.dispose(); },
  };
}
