// Biome visuel d'un cluster : une CLAIRIÈRE cernée d'arbres en fer à cheval
// (ouvert côté allée), centre en terre, tombes en arc face au visiteur, buissons
// et monument central. Effet « cathédrale naturelle » (phase 4).
// Cibles mesurables : plans/CLUSTER_BIOME_CRITERIA.md.
import * as THREE from "three";
import { seededRandom } from "../../../graves.ts";
import { hashSeed, CLUSTER_RADIUS, type ClusterInfo } from "../../../procedural.ts";
import { toWorld, type Frame } from "../../../worldLayout.ts";
import { bushSource, instanceProps, rockSource, treeSource, type PropSource } from "../../props.ts";
import type { TerrainChunk } from "../../terrain.ts";

// --- Rings concentriques (m), ancrés sur l'anneau de tombes existant ---
export const GRAVE_RING = CLUSTER_RADIUS;   // 3 — rayon des tombes (placeCluster)
export const EARTH_RADIUS = GRAVE_RING + 1.4; // disque de terre sous les tombes
const BUSH_RING = EARTH_RADIUS + 1.2;
const TREE_RING = EARTH_RADIUS + 4.5;

// Ouverture du fer à cheval côté allée/visiteur (rad de demi-cône exclu).
const TREE_OPEN_HALF = 0.7;   // ~40° → arbres sur ~280°
const BUSH_OPEN_HALF = 0.9;   // ~52° → buissons sur ~256°
const GRAVE_ARC_HALF = 1.4;   // ~80° → tombes sur ~160° au fond, face au visiteur

// Layer arbres — voûte. Échelles calées sur l'arbre procédural (~8 m de haut
// à l'échelle 1, cf. BEECH_SPECIES), pas sur l'ancien GLTF jacaranda.
const TREE_COUNT_MIN = 9;
const TREE_COUNT_MAX = 13;
const TREE_SCALE_MIN = 0.9;
const TREE_SCALE_RANGE = 0.7;
/** Variantes d'arbre et d'arbuste tirées par cluster — sans ce pool, toutes les
 *  instances partagent une silhouette et la voûte se lit comme un copier-coller. */
const TREE_SPECIES = 3;
const TREE_TILT = 0.16;               // inclinaison vers le centre (voûte)
const TREE_RING_JITTER = 1.2;

// Layer buissons
const BUSH_COUNT_MIN = 10;
const BUSH_COUNT_MAX = 16;
const BUSH_SCALE_MIN = 0.9;
const BUSH_SCALE_RANGE = 0.6;
const BUSH_RING_JITTER = 0.8;
const BUSH_SPECIES = 3;

// Prop central (monument)
const PROP_TREE_SCALE_MIN = 1.5;
const PROP_TREE_SCALE_RANGE = 0.6;
const PROP_ROCK_STACK = 4;
const PROP_ROCK_BASE_SCALE = 1.4;
const PROP_ROCK_SCALE_DECAY = 0.18;

// Allée + bornes + cailloux
const PATH_WIDTH = 2.4;               // large → terre dominante au premier plan
const PATH_LEN = 7;                   // du bord du disque vers le visiteur
const GATE_OFFSET = 1.3;              // écart latéral des bornes de pierre
const GATE_SCALE = 0.9;
const PEBBLE_COUNT = 7;
const PEBBLE_SCALE_MIN = 0.12;
const PEBBLE_SCALE_RANGE = 0.18;

const EARTH_TEX = "/textures/ground/rocky_trail_2k/textures/rocky_trail_diff_2k.jpg";

// --- Texture ---
const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function loadTex(path: string): THREE.Texture {
  let t = texCache.get(path);
  if (!t) { t = texLoader.load(path); texCache.set(path, t); }
  return t;
}

/** Géométrie de la clairière : centre monde, direction du visiteur, azimut d'ouverture. */
type Clearing = {
  cx: number; cz: number;
  ex: number; ez: number;   // entrée (côté visiteur)
  openAng: number;          // azimut vers le visiteur (XZ)
  baseY: number;
  ground(x: number, z: number): number;
};

function makeClearing(frame: Frame, cluster: ClusterInfo, terrain: TerrainChunk | undefined): Clearing {
  const { x: cx, z: cz } = toWorld(frame, cluster.x, cluster.z);
  // Entrée du biome = accroche du cluster sur l'épine (là où arrive le visiteur),
  // PAS l'entrée routière lointaine → ouverture/allée/tombes orientées correctement.
  const { x: ex, z: ez } = toWorld(frame, cluster.approach.x, cluster.approach.z);
  const ground = (x: number, z: number) => (terrain ? terrain.getHeightAt(x, z) : 0);
  return { cx, cz, ex, ez, openAng: Math.atan2(ez - cz, ex - cx), baseY: ground(cx, cz), ground };
}

/** Ancre monde d'un point de l'anneau à l'angle `a`, rayon `r`. */
function ringPoint(cl: Clearing, a: number, r: number): { x: number; z: number } {
  return { x: cl.cx + Math.cos(a) * r, z: cl.cz + Math.sin(a) * r };
}

// --- Emplacements de tombes possédés par le biome (arc au fond, face au visiteur) ---

export type GraveAnchor = { x: number; z: number; rotY: number };

/** Positions + orientation des tombes en arc, face au visiteur (issue du retour). */
export function graveAnchors(frame: Frame, cluster: ClusterInfo, count: number, terrain?: TerrainChunk): GraveAnchor[] {
  const cl = makeClearing(frame, cluster, terrain);
  const farAng = cl.openAng + Math.PI; // direction opposée au visiteur (fond)
  const anchors: GraveAnchor[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = farAng - GRAVE_ARC_HALF + t * (2 * GRAVE_ARC_HALF);
    const { x, z } = ringPoint(cl, a, GRAVE_RING);
    // Face au visiteur : rotY orienté du point vers l'entrée (convention graves.ts).
    anchors.push({ x, z, rotY: Math.atan2(cl.ex - x, cl.ez - z) });
  }
  return anchors;
}

// --- Layers non instanciés (géométrie procédurale, une fois par cluster) ---

/** Disque de terre au centre (sous les tombes). Grass supprimée dedans en amont. */
function buildEarthDisk(group: THREE.Group, cl: Clearing, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const tex = loadTex(EARTH_TEX);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xb6a172, roughness: 1 });
  const geo = new THREE.CircleGeometry(EARTH_RADIUS, 24);
  geos.push(geo); mats.push(mat);
  const disk = new THREE.Mesh(geo, mat);
  disk.rotation.x = -Math.PI / 2;
  disk.position.set(cl.cx, cl.baseY + 0.02, cl.cz);
  disk.receiveShadow = true;
  group.add(disk);
}

/** Allée courte en terre du disque vers le visiteur (mesh seul ; bornes/cailloux
 *  sont des instances "rock", voir collectGateAndPebbles). */
function buildPath(group: THREE.Group, cl: Clearing, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const dX = Math.cos(cl.openAng), dZ = Math.sin(cl.openAng); // vers le visiteur
  const start = EARTH_RADIUS - 0.3;
  const midR = start + PATH_LEN / 2;
  const mx = cl.cx + dX * midR, mz = cl.cz + dZ * midR;

  const tex = loadTex(EARTH_TEX);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0xc4b080, roughness: 1 });
  const geo = new THREE.PlaneGeometry(PATH_WIDTH, PATH_LEN);
  geos.push(geo); mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  const wrap = new THREE.Group();
  wrap.position.set(mx, cl.baseY + 0.025, mz);
  wrap.rotation.y = Math.atan2(dX, dZ);
  wrap.add(mesh);
  group.add(wrap);
}

// --- Paliers de matrices (instanciation groupée à l'échelle du chunk) ---

/** Matrices de placement d'un cluster, accumulées par espèce pour tout le chunk. */
type MatrixBuckets = {
  /** Un tableau par variante d'arbre (voûte + monument « tree »). */
  trees: THREE.Matrix4[][];
  /** Bornes + cailloux + monument « rocks ». */
  rock: THREE.Matrix4[];
  /** Un tableau par variante d'arbuste. */
  bushes: THREE.Matrix4[][];
};

function emptyBuckets(): MatrixBuckets {
  return {
    trees: Array.from({ length: TREE_SPECIES }, () => []),
    rock: [],
    bushes: Array.from({ length: BUSH_SPECIES }, () => []),
  };
}

/** Bornes de pierre encadrant l'allée + cailloux épars (matrices « rock »). */
function collectGateAndPebbles(cl: Clearing, rand: () => number, rockOut: THREE.Matrix4[]) {
  const dX = Math.cos(cl.openAng), dZ = Math.sin(cl.openAng);
  const start = EARTH_RADIUS - 0.3;
  const perpX = -dZ, perpZ = dX;
  const gateR = start + PATH_LEN; // bouche de l'allée
  const dummy = new THREE.Object3D();
  for (const side of [-1, 1]) {
    const gx = cl.cx + dX * gateR + perpX * side * GATE_OFFSET;
    const gz = cl.cz + dZ * gateR + perpZ * side * GATE_OFFSET;
    dummy.position.set(gx, cl.ground(gx, gz), gz);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.set(GATE_SCALE * 0.7, GATE_SCALE * 1.6, GATE_SCALE * 0.7); // borne dressée
    dummy.updateMatrix();
    rockOut.push(dummy.matrix.clone());
  }
  for (let i = 0; i < PEBBLE_COUNT; i++) {
    const r = start + rand() * PATH_LEN;
    const lat = (rand() * 2 - 1) * (PATH_WIDTH * 0.7);
    const px = cl.cx + dX * r + perpX * lat, pz = cl.cz + dZ * r + perpZ * lat;
    dummy.position.set(px, cl.ground(px, pz), pz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(PEBBLE_SCALE_MIN + rand() * PEBBLE_SCALE_RANGE);
    dummy.updateMatrix();
    rockOut.push(dummy.matrix.clone());
  }
}

/** Fer à cheval d'arbres inclinés vers le centre (voûte), réparti sur les
 *  variantes du pool pour éviter une couronne de silhouettes identiques. */
function collectVaultTrees(cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined, out: THREE.Matrix4[][]) {
  const count = TREE_COUNT_MIN + Math.floor(rand() * (TREE_COUNT_MAX - TREE_COUNT_MIN + 1));
  const span = 2 * Math.PI - 2 * TREE_OPEN_HALF; // arc couvert
  const startA = cl.openAng + TREE_OPEN_HALF;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = startA + (i / (count - 1)) * span;
    const r = TREE_RING + (rand() * 2 - 1) * TREE_RING_JITTER;
    const { x, z } = ringPoint(cl, a, r);
    const y = terrain ? terrain.getHeightAt(x, z) : 0;
    dummy.position.set(x, y, z);
    // Penché vers le centre : lookAt oriente -Z local vers la clairière, la
    // rotation X qui suit couche l'arbre dans cette direction (voûte).
    dummy.lookAt(cl.cx, y, cl.cz);
    dummy.rotateX(TREE_TILT);
    dummy.scale.setScalar(TREE_SCALE_MIN + rand() * TREE_SCALE_RANGE);
    dummy.updateMatrix();
    out[i % out.length].push(dummy.matrix.clone());
  }
}

/** Fer à cheval de buissons, juste derrière les tombes (matrices par variante). */
function collectBushes(cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined, out: THREE.Matrix4[][]) {
  const count = BUSH_COUNT_MIN + Math.floor(rand() * (BUSH_COUNT_MAX - BUSH_COUNT_MIN + 1));
  const span = 2 * Math.PI - 2 * BUSH_OPEN_HALF;
  const startA = cl.openAng + BUSH_OPEN_HALF;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const a = startA + (i / (count - 1)) * span;
    const r = BUSH_RING + (rand() * 2 - 1) * BUSH_RING_JITTER;
    const { x, z } = ringPoint(cl, a, r);
    const y = terrain ? terrain.getHeightAt(x, z) : 0;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(BUSH_SCALE_MIN + rand() * BUSH_SCALE_RANGE);
    dummy.updateMatrix();
    out[i % out.length].push(dummy.matrix.clone());
  }
}

/** Monument central selon propKind : méga-arbre ou pile de rochers. */
function collectProp(
  cluster: ClusterInfo, cl: Clearing, rand: () => number,
  rockOut: THREE.Matrix4[], treeOut: THREE.Matrix4[][],
) {
  const dummy = new THREE.Object3D();
  if (cluster.propKind === "tree") {
    dummy.position.set(cl.cx, cl.baseY, cl.cz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(PROP_TREE_SCALE_MIN + rand() * PROP_TREE_SCALE_RANGE);
    dummy.updateMatrix();
    treeOut[0].push(dummy.matrix.clone());
  } else if (cluster.propKind === "rocks") {
    let y = cl.baseY;
    for (let i = 0; i < PROP_ROCK_STACK; i++) {
      const scale = PROP_ROCK_BASE_SCALE * (1 - i * PROP_ROCK_SCALE_DECAY);
      dummy.position.set(cl.cx, y, cl.cz);
      dummy.rotation.set(0, i * 1.3, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      rockOut.push(dummy.matrix.clone());
      y += scale * 0.9;
    }
  }
  // "flat" → rien
}

// --- API publique ---

/** Ajoute une couche instanciée au groupe si elle a des matrices, et retient sa
 *  source pour le dispose. Une source sans instance est libérée aussitôt. */
function addLayer(group: THREE.Group, owned: PropSource[], source: PropSource, matrices: THREE.Matrix4[]) {
  if (!matrices.length) {
    source.dispose();
    return;
  }
  group.add(...instanceProps(source, matrices));
  owned.push(source);
}

/**
 * Conteneur des biomes d'une tranche de cimetière. `dispose()` libère tout ce
 * qu'il a créé : disque de terre, allée, et les sources de props procéduraux
 * (géométries + matériaux, plus aucun cache GLTF partagé).
 */
export class ClusterBiomes {
  readonly group: THREE.Group;
  private readonly geos: THREE.BufferGeometry[];
  private readonly mats: THREE.Material[];
  private readonly sources: PropSource[];

  private constructor(group: THREE.Group, geos: THREE.BufferGeometry[], mats: THREE.Material[], sources: PropSource[]) {
    this.group = group;
    this.geos = geos;
    this.mats = mats;
    this.sources = sources;
  }

  static create(companyId: string, frame: Frame, terrain: TerrainChunk | undefined, clustersInChunk: ClusterInfo[]): ClusterBiomes | null {
    if (!clustersInChunk.length) return null;
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const buckets = emptyBuckets();

    for (const cluster of clustersInChunk) {
      const rand = seededRandom(hashSeed(`${companyId}:biome:${cluster.x}:${cluster.z}`));
      const cl = makeClearing(frame, cluster, terrain);
      buildEarthDisk(group, cl, geos, mats);
      buildPath(group, cl, geos, mats);
      collectGateAndPebbles(cl, rand, buckets.rock);
      collectVaultTrees(cl, rand, terrain, buckets.trees);
      collectBushes(cl, rand, terrain, buckets.bushes);
      collectProp(cluster, cl, rand, buckets.rock, buckets.trees);
    }

    // Un seul InstancedMesh par variante pour TOUT le chunk : les 20 à 30 props
    // d'une clairière tiennent en une poignée de passes de dessin.
    const owned: PropSource[] = [];
    const speciesSeed = (kind: string, i: number) => hashSeed(`${companyId}:${kind}:${i}`);
    addLayer(group, owned, rockSource(speciesSeed("rock", 0)), buckets.rock);
    buckets.trees.forEach((m, i) => addLayer(group, owned, treeSource(speciesSeed("vaulttree", i)), m));
    buckets.bushes.forEach((m, i) => addLayer(group, owned, bushSource(speciesSeed("bush", i)), m));

    return new ClusterBiomes(group, geos, mats, owned);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const s of this.sources) s.dispose();
  }
}

/** Biome d'un seul cluster — scène de test (?testCluster). */
export function buildClusterBiome(cluster: ClusterInfo, frame: Frame, terrain: TerrainChunk | undefined, companyId: string): THREE.Group {
  return ClusterBiomes.create(companyId, frame, terrain, [cluster])?.group ?? new THREE.Group();
}
