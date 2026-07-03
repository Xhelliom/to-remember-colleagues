// Strate intermédiaire herbe ↔ arbres : fougères, arbustes, fleurs — depuis la
// MÊME grammaire de croissance que les arbres (growSkeleton, skeleton.ts).
// Thématique cimetière : fougères sous les couronnes, fleurs sauvages dans les
// trouées, lierre plus dense sur les tombes négligées (`maintenance`).
// Référence de concept LAAS `vegetation/Understory.ts` — portée Three.js
// WebGLRenderer, aucun code copié. Partition stricte (plan/11-understory.md) :
// seule dépendance vers la grammaire d'arbres = `growSkeleton`/`BEECH_SPECIES`
// (skeleton.ts) + `buildTree` (treeBuilder.ts, harnais e2e) — jamais
// tubeMesh.ts/leafMesh.ts (édités en parallèle par la mission 09) : le
// maillage bas niveau (tiges/feuilles) est donc réimplémenté ici, plus léger.
import * as THREE from "three";
import { BEECH_SPECIES, growSkeleton, type LeafAnchor, type SkeletonNode, type TreeSkeleton, type TreeSpecies, type Vec3 } from "./skeleton.ts";
import { buildTree } from "./treeBuilder.ts";
import { addWindWeightAttribute, applyWind, GRASS_WIND_POOL, RIGID_TREE_WIND_POOL, setWindTime, SOFT_TREE_WIND_POOL } from "../wind.ts";
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";

const TWO_PI = Math.PI * 2;

// --- Petits utilitaires géométriques partagés par les 3 builders -----------

type Vert = { readonly p: THREE.Vector3; readonly n: THREE.Vector3 };

function vecOf(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function pushTri(positions: number[], normals: number[], a: Vert, b: Vert, c: Vert): void {
  for (const v of [a, b, c]) {
    positions.push(v.p.x, v.p.y, v.p.z);
    normals.push(v.n.x, v.n.y, v.n.z);
  }
}

function pushColoredTri(
  positions: number[], normals: number[], colors: number[], color: THREE.Color, a: Vert, b: Vert, c: Vert,
): void {
  pushTri(positions, normals, a, b, c);
  for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
}

/** Palier `levels[lod]`, borné au dernier palier défini (LOD trop grossier → le plus coarse connu). */
function tierFor<T>(levels: readonly T[], lod: number): T {
  return levels[Math.max(0, Math.min(lod, levels.length - 1))];
}

const RING_UP_DOT_THRESHOLD = 0.98;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_AXIS = new THREE.Vector3(1, 0, 0);

/** Base orthonormée perpendiculaire à `dir` (cf. tubeMesh.ts — réimplémenté ici, pas importé, cf. en-tête). */
function ringBasis(dir: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3 } {
  const ref = Math.abs(dir.dot(WORLD_UP)) > RING_UP_DOT_THRESHOLD ? FALLBACK_AXIS : WORLD_UP;
  const right = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  return { right, up };
}
function ringPoint(basis: { right: THREE.Vector3; up: THREE.Vector3 }, angle: number): THREE.Vector3 {
  return new THREE.Vector3().addScaledVector(basis.right, Math.cos(angle)).addScaledVector(basis.up, Math.sin(angle));
}

export type UnderstoryStats = { readonly totalTriangles: number };
export type UnderstoryBuild = { readonly group: THREE.Group; readonly stats: UnderstoryStats; dispose(): void };

// --- Arbuste — multi-tiges, même grammaire de croissance que les arbres (growSkeleton) ---

/** Espèce « bush » : tronc très court, une seule ramification, couronne compacte — même moteur de croissance que BEECH_SPECIES, juste re-paramétré (spec #1 « params bush »). */
const BUSH_SPECIES: TreeSpecies = {
  trunkHeight: 0.55, trunkSegments: 2, trunkBaseRadius: 0.035, trunkTipRadius: 0.018, trunkLeanMax: 0.12,
  crownCenterHeightRatio: 0.75, crownRadiusXZ: 0.42, crownRadiusY: 0.38,
  branchLevels: 1, branchesPerLevel: [4], branchSegments: 2, branchLengthRatio: 0.75,
  branchRadiusTaper: 0.6, branchStartRatio: 0.15, tropismWeight: 0.6, jitterWeight: 0.28,
  leafAnchorsPerTwig: 4, leafSpread: 0.16,
};

const BUSH_STEM_SPREAD = 0.12; // m — dispersion des bases de tige autour du centre du buisson
const BUSH_STEM_COUNT_BY_LOD = [2, 1] as const;
const STEM_RADIAL_SEGMENTS_BY_LOD = [4, 3] as const;
const BUSH_BARK_COLOR = 0x4a3c2c, BUSH_BARK_ROUGHNESS = 0.9;
const BUSH_FOLIAGE_COLOR = 0x3f6b28, BUSH_FOLIAGE_ROUGHNESS = 0.85;
/** Silhouette locale d'une feuille de buisson (plus simple que LEAF_OUTLINE de leafMesh.ts — détail lointain). */
const BUSH_LEAF_OUTLINE: readonly (readonly [number, number])[] = [[0, 0], [0.5, 0.5], [0, 1], [-0.5, 0.5]];
const BUSH_LEAF_LENGTH = 0.055, BUSH_LEAF_WIDTH = 0.04;

function translateVec3(v: Vec3, dx: number, dz: number): Vec3 {
  return { x: v.x + dx, y: v.y, z: v.z + dz };
}

/** Translate un squelette entier (nœuds + ancres) sur XZ — place une tige d'un buisson multi-tiges. */
function translateSkeleton(skeleton: TreeSkeleton, dx: number, dz: number): TreeSkeleton {
  return {
    nodes: skeleton.nodes.map((n) => ({ ...n, position: translateVec3(n.position, dx, dz) })),
    anchors: skeleton.anchors.map((a) => ({ ...a, position: translateVec3(a.position, dx, dz) })),
  };
}

/** Fusionne plusieurs tiges (chacune un squelette à racine propre) en UN squelette — reste une forêt de composantes disjointes (parent=-1 par tige), que buildStemGeometry parcourt sans distinction. */
function mergeStemSkeletons(stems: readonly TreeSkeleton[]): TreeSkeleton {
  const nodes: SkeletonNode[] = [];
  const anchors: LeafAnchor[] = [];
  for (const stem of stems) {
    const base = nodes.length;
    for (const n of stem.nodes) nodes.push({ ...n, parent: n.parent === -1 ? -1 : n.parent + base });
    anchors.push(...stem.anchors);
  }
  return { nodes, anchors };
}

function growBushStems(seed: number, stemCount: number): TreeSkeleton[] {
  const rand = seededRandom(hashSeed(`understory:bush:${seed}`));
  const stems: TreeSkeleton[] = [];
  for (let i = 0; i < stemCount; i++) {
    const angle = rand() * TWO_PI;
    const dist = rand() * BUSH_STEM_SPREAD;
    const stemSeed = hashSeed(`understory:bush:${seed}:${i}`);
    stems.push(translateSkeleton(growSkeleton(BUSH_SPECIES, stemSeed), Math.cos(angle) * dist, Math.sin(angle) * dist));
  }
  return stems;
}

/** Tiges (tronc+branches) d'un squelette en UNE géométrie non indexée — tronçons coniques, sans capuchon de bout (détail invisible à l'échelle buisson, cf. tubeMesh.ts pour la version complète). */
function buildStemGeometry(skeleton: TreeSkeleton, radialSegments: number): { geometry: THREE.BufferGeometry; triangleCount: number } {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const node of skeleton.nodes) {
    if (node.parent === -1) continue;
    const from = skeleton.nodes[node.parent];
    const fromPos = vecOf(from.position), toPos = vecOf(node.position);
    const dir = toPos.clone().sub(fromPos);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0); else dir.normalize();
    const basis = ringBasis(dir);
    for (let i = 0; i < radialSegments; i++) {
      const a0 = (i / radialSegments) * TWO_PI, a1 = ((i + 1) / radialSegments) * TWO_PI;
      const n0 = ringPoint(basis, a0), n1 = ringPoint(basis, a1);
      const p0f = fromPos.clone().addScaledVector(n0, from.radius), p1f = fromPos.clone().addScaledVector(n1, from.radius);
      const p0t = toPos.clone().addScaledVector(n0, node.radius), p1t = toPos.clone().addScaledVector(n1, node.radius);
      pushTri(positions, normals, { p: p0f, n: n0 }, { p: p1f, n: n1 }, { p: p1t, n: n1 });
      pushTri(positions, normals, { p: p0f, n: n0 }, { p: p1t, n: n1 }, { p: p0t, n: n0 });
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return { geometry, triangleCount: positions.length / 9 };
}

/** Feuillage de buisson : une feuille (BUSH_LEAF_OUTLINE) par ancre, pas de spray (cf. leafMesh.ts). */
function buildBushFoliageGeometry(anchors: readonly LeafAnchor[]): { geometry: THREE.BufferGeometry; triangleCount: number } {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const anchor of anchors) {
    const lengthAxis = vecOf(anchor.normal).normalize();
    const faceNormal = vecOf(anchor.up).normalize();
    const right = new THREE.Vector3().crossVectors(faceNormal, lengthAxis).normalize();
    const base = vecOf(anchor.position);
    for (let i = 1; i < BUSH_LEAF_OUTLINE.length - 1; i++) {
      const tri = [BUSH_LEAF_OUTLINE[0], BUSH_LEAF_OUTLINE[i], BUSH_LEAF_OUTLINE[i + 1]].map(([lx, ly]) => ({
        p: base.clone().addScaledVector(right, lx * BUSH_LEAF_WIDTH * anchor.scale).addScaledVector(lengthAxis, ly * BUSH_LEAF_LENGTH * anchor.scale),
        n: faceNormal,
      }));
      pushTri(positions, normals, tri[0], tri[1], tri[2]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return { geometry, triangleCount: positions.length / 9 };
}

/** Arbuste déterministe multi-tiges. `opts.lod` (0 = proche, plus haut = plus grossier) réduit le nombre de tiges et les segments radiaux — même contrat que `buildTree` (mission 08). */
export function buildBush(seed: number, opts: { lod?: number } = {}): UnderstoryBuild {
  const lod = opts.lod ?? 0;
  const stemCount = tierFor(BUSH_STEM_COUNT_BY_LOD, lod);
  const radialSegments = tierFor(STEM_RADIAL_SEGMENTS_BY_LOD, lod);
  const skeleton = mergeStemSkeletons(growBushStems(seed, stemCount));
  const stem = buildStemGeometry(skeleton, radialSegments);
  addWindWeightAttribute(stem.geometry, RIGID_TREE_WIND_POOL);
  const stemMaterial = applyWind(new THREE.MeshStandardMaterial({ color: BUSH_BARK_COLOR, roughness: BUSH_BARK_ROUGHNESS }), { pool: RIGID_TREE_WIND_POOL });
  const stemMesh = new THREE.Mesh(stem.geometry, stemMaterial);

  const foliage = buildBushFoliageGeometry(skeleton.anchors);
  addWindWeightAttribute(foliage.geometry, SOFT_TREE_WIND_POOL);
  const foliageMaterial = applyWind(
    new THREE.MeshStandardMaterial({ color: BUSH_FOLIAGE_COLOR, roughness: BUSH_FOLIAGE_ROUGHNESS, side: THREE.DoubleSide }),
    { pool: SOFT_TREE_WIND_POOL },
  );
  const foliageMesh = new THREE.Mesh(foliage.geometry, foliageMaterial);

  const group = new THREE.Group();
  group.add(stemMesh, foliageMesh);
  return {
    group,
    stats: { totalTriangles: stem.triangleCount + foliage.triangleCount },
    dispose() {
      stem.geometry.dispose();
      stemMaterial.dispose();
      foliage.geometry.dispose();
      foliageMaterial.dispose();
    },
  };
}

// --- Fougère — rosette de frondes arquées autour d'un point de base ---

const FROND_COUNT_BY_LOD = [7, 4] as const;
// FROND_ARCH_ANGLE (rad) : base verticale → pointe retombante ; FROND_LENGTH/WIDTH_BASE en m.
const FROND_SEGMENTS = 5, FROND_LENGTH = 0.32, FROND_ARCH_ANGLE = 1.65, FROND_WIDTH_BASE = 0.045;
const FROND_JITTER_ANGLE = 0.35, FROND_LENGTH_SCALE_MIN = 0.75, FROND_LENGTH_SCALE_RANGE = 0.4;
const FERN_COLOR = 0x2f5c2a, FERN_ROUGHNESS = 0.8;

/** Une fronde : ruban de `FROND_SEGMENTS` quads suivant un arc de cercle — même trick d'enveloppe que `envelopeOutward` de skeleton.ts, appliqué ici à une courbe simple. */
function pushFrond(positions: number[], normals: number[], rand: () => number, baseAngle: number): void {
  const arcRadius = FROND_LENGTH / FROND_ARCH_ANGLE;
  const angle = baseAngle + (rand() * 2 - 1) * FROND_JITTER_ANGLE;
  const lengthScale = FROND_LENGTH_SCALE_MIN + rand() * FROND_LENGTH_SCALE_RANGE;
  const outDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const sideDir = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  let prevLeft: THREE.Vector3 | null = null;
  let prevRight: THREE.Vector3 | null = null;
  for (let i = 0; i <= FROND_SEGMENTS; i++) {
    const t = i / FROND_SEGMENTS;
    const theta = t * FROND_ARCH_ANGLE;
    const out = Math.sin(theta) * arcRadius * lengthScale;
    const up = (1 - Math.cos(theta)) * arcRadius * lengthScale;
    const center = outDir.clone().multiplyScalar(out).setY(up);
    const halfWidth = FROND_WIDTH_BASE * (1 - t) * lengthScale;
    const left = center.clone().addScaledVector(sideDir, -halfWidth);
    const right = center.clone().addScaledVector(sideDir, halfWidth);
    const tangent = outDir.clone().multiplyScalar(Math.cos(theta)).setY(Math.sin(theta)).normalize();
    const normal = new THREE.Vector3().crossVectors(sideDir, tangent).normalize();
    if (prevLeft && prevRight) {
      pushTri(positions, normals, { p: prevLeft, n: normal }, { p: prevRight, n: normal }, { p: right, n: normal });
      pushTri(positions, normals, { p: prevLeft, n: normal }, { p: right, n: normal }, { p: left, n: normal });
    }
    prevLeft = left;
    prevRight = right;
  }
}

/** Fougère déterministe : rosette de frondes. `opts.lod` réduit le nombre de frondes — reste géométrique (les cards/impostors lointains, mission 09/10, ne sont pas encore livrés). */
export function buildFern(seed: number, opts: { lod?: number } = {}): UnderstoryBuild {
  const lod = opts.lod ?? 0;
  const frondCount = tierFor(FROND_COUNT_BY_LOD, lod);
  const rand = seededRandom(hashSeed(`understory:fern:${seed}`));
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < frondCount; i++) pushFrond(positions, normals, rand, (i / frondCount) * TWO_PI);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  addWindWeightAttribute(geometry, GRASS_WIND_POOL);
  const material = applyWind(new THREE.MeshStandardMaterial({ color: FERN_COLOR, roughness: FERN_ROUGHNESS, side: THREE.DoubleSide }), { pool: GRASS_WIND_POOL });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group,
    stats: { totalTriangles: positions.length / 9 },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// --- Fleur — tige + bloom de petites pétales colorées (fleurs sauvages des trouées) ---

const PETAL_COUNT_BY_LOD = [6, 4] as const;
const FLOWER_STEM_HEIGHT = 0.14, FLOWER_STEM_HALF_WIDTH = 0.003;
const FLOWER_BLOOM_RADIUS = 0.028, FLOWER_PETAL_HALF_WIDTH = 0.008;
const FLOWER_STEM_COLOR = new THREE.Color(0x4a6b2c);
// TILT = composante verticale de la direction d'une pétale (bloom légèrement bombé) ; JITTER = écartement irrégulier.
const FLOWER_PETAL_TILT = 0.35, FLOWER_PETAL_JITTER = 0.2, FLOWER_ROUGHNESS = 0.6;
/** Palette de fleurs sauvages de cimetière (blanc, jaune, mauve, rose) — une couleur par graine. */
const FLOWER_PALETTE: readonly THREE.Color[] = [
  new THREE.Color(0xffffff), new THREE.Color(0xf5d33b), new THREE.Color(0xc98bd6), new THREE.Color(0xd6547a),
];

function pushPetal(positions: number[], normals: number[], colors: number[], color: THREE.Color, center: THREE.Vector3, angle: number): void {
  const dir = new THREE.Vector3(Math.cos(angle), FLOWER_PETAL_TILT, Math.sin(angle)).normalize();
  const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  const tip = center.clone().addScaledVector(dir, FLOWER_BLOOM_RADIUS);
  const left = center.clone().addScaledVector(side, -FLOWER_PETAL_HALF_WIDTH);
  const right = center.clone().addScaledVector(side, FLOWER_PETAL_HALF_WIDTH);
  const normal = new THREE.Vector3(0, 1, 0);
  pushColoredTri(positions, normals, colors, color, { p: left, n: normal }, { p: right, n: normal }, { p: tip, n: normal });
}

/** Fleur déterministe : tige + bloom de pétales (compte selon `opts.lod`), couleur tirée de la palette selon la graine. Très bon marché (quelques triangles) — pensée pour l'instanciation. */
export function buildFlower(seed: number, opts: { lod?: number } = {}): UnderstoryBuild {
  const lod = opts.lod ?? 0;
  const petalCount = tierFor(PETAL_COUNT_BY_LOD, lod);
  const rand = seededRandom(hashSeed(`understory:flower:${seed}`));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const w = FLOWER_STEM_HALF_WIDTH, h = FLOWER_STEM_HEIGHT, stemNormal = new THREE.Vector3(0, 0, 1);
  const bl = { p: new THREE.Vector3(-w, 0, 0), n: stemNormal }, br = { p: new THREE.Vector3(w, 0, 0), n: stemNormal };
  const tl = { p: new THREE.Vector3(-w, h, 0), n: stemNormal }, tr = { p: new THREE.Vector3(w, h, 0), n: stemNormal };
  pushColoredTri(positions, normals, colors, FLOWER_STEM_COLOR, bl, br, tr);
  pushColoredTri(positions, normals, colors, FLOWER_STEM_COLOR, bl, tr, tl);
  const bloomColor = FLOWER_PALETTE[Math.floor(rand() * FLOWER_PALETTE.length) % FLOWER_PALETTE.length];
  const center = new THREE.Vector3(0, FLOWER_STEM_HEIGHT, 0);
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * TWO_PI + (rand() * 2 - 1) * FLOWER_PETAL_JITTER;
    pushPetal(positions, normals, colors, bloomColor, center, angle);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  addWindWeightAttribute(geometry, GRASS_WIND_POOL);
  const material = applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: FLOWER_ROUGHNESS, side: THREE.DoubleSide }), { pool: GRASS_WIND_POOL });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group,
    stats: { totalTriangles: positions.length / 9 },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

// --- Placement : carte de canopée (fougère sous couronne / fleur en trouée) + lierre/maintenance ---

export type CanopyDisc = { readonly cx: number; readonly cz: number; readonly radius: number };

/** Rayon effectif (× `radius`) avant extinction totale de la couverture — transition douce au bord de couronne. */
const CANOPY_FALLOFF_MARGIN = 1.4;

/** Couverture de canopée [0,1] au point (x,z) : 1 sous le tronc, dégradé jusqu'à 0 au-delà de `radius * CANOPY_FALLOFF_MARGIN` ; plusieurs couronnes qui se chevauchent → le maximum local. */
export function canopyCoverageAt(x: number, z: number, canopies: readonly CanopyDisc[]): number {
  let coverage = 0;
  for (const c of canopies) {
    const dist = Math.hypot(x - c.cx, z - c.cz);
    const edge = c.radius * CANOPY_FALLOFF_MARGIN;
    if (dist >= edge) continue;
    const t = dist <= c.radius ? 1 : 1 - (dist - c.radius) / (edge - c.radius);
    coverage = Math.max(coverage, t);
  }
  return coverage;
}

/** Seuils du prédicat de placement — la bande [CANOPY_FLOWER_MAX, CANOPY_FERN_MIN] reste vide (mi-ombre : ni assez sombre pour la fougère, ni assez ouverte pour la fleur). */
export const CANOPY_FERN_MIN = 0.5;
export const CANOPY_FLOWER_MAX = 0.3;

/** Fougère sous couronne dense (ombre) / fleur en trouée (peu de canopée) — prédicats symétriques. */
export function isFernSpot(canopyCoverage: number): boolean { return canopyCoverage >= CANOPY_FERN_MIN; }
export function isFlowerSpot(canopyCoverage: number): boolean { return canopyCoverage <= CANOPY_FLOWER_MAX; }

/** Entretien en-deçà duquel le lierre commence à gagner la tombe (cf. graveAxes.ts `maintenance` [0,1]). */
export const IVY_MAINTENANCE_MAX = 0.35;

/** Couverture de lierre/mousse [0,1] pour une tombe d'entretien donné — 0 au-delà du seuil, croît jusqu'à 1 quand `maintenance` → 0. Fonction pure exposée pour la mission 07 (dressing-deadfall) : cette mission-ci ne pose pas elle-même de mesh sur les tombes (hors partition). */
export function ivyCoverage(maintenance: number): number {
  if (maintenance >= IVY_MAINTENANCE_MAX) return 0;
  return 1 - maintenance / IVY_MAINTENANCE_MAX;
}

// --- Dispersion (scatter) déterministe sur une zone --------------------------

export type UnderstoryKind = "fern" | "bush" | "flower";
export type UnderstoryPlacement = {
  readonly kind: UnderstoryKind;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly seed: number;
};

/** Probabilité de combler la bande de mi-ombre (ni fougère ni fleur) par un arbuste générique. */
const BUSH_FILL_PROBABILITY = 0.4;

/** Tire `candidateCount` points dans `[-halfExtent, halfExtent]²` et choisit le type de plante selon la couverture de canopée locale (`isFernSpot`/`isFlowerSpot`) — déterministe. */
export function scatterUnderstory(
  seed: number, halfExtent: number, candidateCount: number, canopies: readonly CanopyDisc[],
): UnderstoryPlacement[] {
  const rand = seededRandom(hashSeed(`understory:scatter:${seed}`));
  const placements: UnderstoryPlacement[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const x = (rand() * 2 - 1) * halfExtent;
    const z = (rand() * 2 - 1) * halfExtent;
    const coverage = canopyCoverageAt(x, z, canopies);
    let kind: UnderstoryKind | null = null;
    if (isFernSpot(coverage)) kind = "fern";
    else if (isFlowerSpot(coverage)) kind = "flower";
    else if (rand() < BUSH_FILL_PROBABILITY) kind = "bush";
    const rotationY = rand() * TWO_PI;
    if (kind) placements.push({ kind, x, z, rotationY, seed: hashSeed(`understory:place:${seed}:${i}`) });
  }
  return placements;
}

// --- Harnais e2e (understory.spec.ts uniquement, même principe que treeBuilder.ts) ---
// Aucun chemin de prod (main.ts/worldStreamer.ts) n'importe ce qui suit.

export type UnderstoryDemoOptions = { readonly seed: number; readonly camPose?: string };

const DEMO_GROUND_SIZE = 20, DEMO_GROUND_COLOR = 0x2c3620, DEMO_SKY_COLOR = 0x9fc4e8;
const DEMO_SUN_COLOR = 0xfff2d8, DEMO_SUN_INTENSITY = 3;
const DEMO_AMBIENT_COLOR = 0x88a0b0, DEMO_AMBIENT_INTENSITY = 0.5;
const DEMO_SUN_POSITION: readonly [number, number, number] = [6, 10, 4];
const DEMO_FOV = 55, DEMO_NEAR = 0.1, DEMO_FAR = 60;
const DEMO_CAM_DEFAULT = { x: 0, y: 2.1, z: 5.2, yaw: Math.PI, pitch: -0.28 };
const DEMO_HALF_EXTENT = 3.2; // m — zone de dispersion sous-bois autour de l'arbre
const DEMO_CANDIDATE_COUNT = 90;
const DEMO_PERF_FRAME_WINDOW = 30, DEMO_READY_FRAME_COUNT = 10;

type DemoPerf = { drawCalls: number; triangles: number; programs: number; fps: number };
type DemoWindow = Window & { __perf?: DemoPerf; __ready?: Promise<void> };

function applyDemoCamPose(camera: THREE.PerspectiveCamera, raw: string | undefined): void {
  camera.rotation.order = "YXZ";
  camera.position.set(DEMO_CAM_DEFAULT.x, DEMO_CAM_DEFAULT.y, DEMO_CAM_DEFAULT.z);
  camera.rotation.set(DEMO_CAM_DEFAULT.pitch, DEMO_CAM_DEFAULT.yaw, 0);
  if (!raw) return;
  const [x, y, z, yaw, pitch, fov] = raw.split(",").map(Number);
  if ([x, y, z, yaw, pitch].some((n) => Number.isNaN(n))) return;
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);
  if (!Number.isNaN(fov)) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function installDemoPerfHooks(renderer: THREE.WebGLRenderer): () => void {
  const w = window as unknown as DemoWindow;
  let resolveReady: () => void = () => {};
  w.__ready = new Promise((r) => { resolveReady = r; });
  let frames = 0;
  let last = performance.now();
  const deltas: number[] = [];
  return () => {
    const now = performance.now();
    deltas.push(now - last);
    last = now;
    if (deltas.length > DEMO_PERF_FRAME_WINDOW) deltas.shift();
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    w.__perf = {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
      fps: avgDelta > 0 ? 1000 / avgDelta : 0,
    };
    frames++;
    if (frames === DEMO_READY_FRAME_COUNT) resolveReady();
  };
}

/** Scène minimale : un arbre hero (treeBuilder.ts) + la strate d'understory dispersée sous sa couronne — réservée à understory.spec.ts, jamais montée par le vrai jeu. */
export function mountUnderstoryDemoScene(canvas: HTMLCanvasElement, opts: UnderstoryDemoOptions): { dispose(): void } {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEMO_SKY_COLOR);
  scene.add(new THREE.AmbientLight(DEMO_AMBIENT_COLOR, DEMO_AMBIENT_INTENSITY));
  const sun = new THREE.DirectionalLight(DEMO_SUN_COLOR, DEMO_SUN_INTENSITY);
  sun.position.set(...DEMO_SUN_POSITION);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DEMO_GROUND_SIZE, DEMO_GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: DEMO_GROUND_COLOR, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const tree = buildTree(opts.seed);
  scene.add(tree.group);
  const canopies: CanopyDisc[] = [{ cx: 0, cz: 0, radius: BEECH_SPECIES.crownRadiusXZ }];
  const placements = scatterUnderstory(opts.seed, DEMO_HALF_EXTENT, DEMO_CANDIDATE_COUNT, canopies);
  const builds = placements.map((p) => {
    const build = p.kind === "fern" ? buildFern(p.seed) : p.kind === "flower" ? buildFlower(p.seed) : buildBush(p.seed);
    build.group.position.set(p.x, 0, p.z);
    build.group.rotation.y = p.rotationY;
    scene.add(build.group);
    return build;
  });

  const camera = new THREE.PerspectiveCamera(DEMO_FOV, window.innerWidth / window.innerHeight, DEMO_NEAR, DEMO_FAR);
  applyDemoCamPose(camera, opts.camPose);

  const tick = import.meta.env.DEV ? installDemoPerfHooks(renderer) : () => {};
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    setWindTime(clock.getElapsedTime());
    renderer.render(scene, camera);
    tick();
  });

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      tree.dispose();
      for (const b of builds) b.dispose();
      renderer.dispose();
    },
  };
}
