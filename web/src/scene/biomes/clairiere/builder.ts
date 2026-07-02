// Biome visuel d'un cluster : une CLAIRIÈRE cernée d'arbres en fer à cheval
// (ouvert côté allée), centre en terre, tombes en arc face au visiteur, buissons
// et monument central. Effet « cathédrale naturelle » (phase 4).
// Cibles mesurables : plans/CLUSTER_BIOME_CRITERIA.md.
import * as THREE from "three";
import { seededRandom } from "../../../graves.ts";
import { hashSeed, CLUSTER_RADIUS, type ClusterInfo } from "../../../procedural.ts";
import { toWorld, type Frame } from "../../../worldLayout.ts";
import { loadGltf } from "../../grass.ts";
import { extractSubMeshes, type SubMesh } from "../../vegetation.ts";
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

// Layer arbres (jacaranda) — voûte
const TREE_COUNT_MIN = 9;
const TREE_COUNT_MAX = 13;
const TREE_SCALE_MIN = 2.0;
const TREE_SCALE_RANGE = 1.2;
const TREE_TILT = 0.16;               // inclinaison vers le centre (voûte)
const TREE_RING_JITTER = 1.2;

// Layer buissons
const BUSH_COUNT_MIN = 10;
const BUSH_COUNT_MAX = 16;
const BUSH_SCALE_MIN = 0.9;
const BUSH_SCALE_RANGE = 0.6;
const BUSH_RING_JITTER = 0.8;
const BUSH_DESAT = 0.4;                // 0..1 : mélange vers le gris (désature)
const BUSH_DARKEN = 0.55;              // facteur multiplicatif de couleur (assombrit)
const BUSH_SPECIES = 3;                // BUSH_PATHS.length

// Prop central (monument)
const PROP_TREE_SCALE_MIN = 2.6;
const PROP_TREE_SCALE_RANGE = 0.8;
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

// Modèles décimés (tools/optimize-models.sh, cf. REVUE_3D_PERF_RENDU.md) :
// silhouette visuelle préservée, ~98 % de triangles en moins.
const BUSH_PATHS = [
  "/models/opt/bush/didelta_spinosa_2k.glb",
  "/models/opt/bush/othonna_cerarioides_2k.glb",
  "/models/opt/bush/wild_rooibos_bush_1k.glb",
];
const ROCK_PATH = "/models/opt/rock/rock_01_2k.glb";
const TREE_PATH = "/models/opt/tree/jacaranda_tree_1k.glb";
const ISLAND_TREE_PATH = "/models/opt/tree/island_tree_02_2k.glb";
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

/** Matrices de placement d'un cluster, accumulées par espèce/asset pour tout le chunk. */
type MatrixBuckets = {
  islandTree: THREE.Matrix4[]; // monument "tree" (ISLAND_TREE_PATH)
  rock: THREE.Matrix4[];       // bornes + cailloux + monument "rocks" (ROCK_PATH)
  bushes: THREE.Matrix4[][];   // un tableau par espèce (BUSH_PATHS)
};

function emptyBuckets(): MatrixBuckets {
  return { islandTree: [], rock: [], bushes: Array.from({ length: BUSH_SPECIES }, () => []) };
}

/** Bornes de pierre encadrant l'allée + cailloux épars (matrices "rock"). */
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

/**
 * Fer à cheval d'arbres jacaranda, inclinés vers le centre (voûte).
 * ponytail: clones individuels, PAS d'InstancedMesh — ce modèle précis (seul,
 * parmi tous les assets du biome, à porter des vertex colors + normales
 * quantifiées) s'affiche noir une fois instancié et rendu via l'EffectComposer
 * du harnais ?testCluster (shader de gradation), un rendu direct fonctionne
 * bien. Sans impact en production (cemetery.ts rend sans compositor). Root
 * cause non identifiée avec certitude ; à revisiter si three.js est mis à jour.
 */
async function buildVaultTrees(group: THREE.Group, cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined) {
  const gltf = await loadGltf(TREE_PATH);
  const count = TREE_COUNT_MIN + Math.floor(rand() * (TREE_COUNT_MAX - TREE_COUNT_MIN + 1));
  const span = 2 * Math.PI - 2 * TREE_OPEN_HALF; // arc couvert
  const startA = cl.openAng + TREE_OPEN_HALF;
  for (let i = 0; i < count; i++) {
    const a = startA + (i / (count - 1)) * span;
    const r = TREE_RING + (rand() * 2 - 1) * TREE_RING_JITTER;
    const { x, z } = ringPoint(cl, a, r);
    const y = terrain ? terrain.getHeightAt(x, z) : 0;
    const wrapper = new THREE.Group();
    wrapper.position.set(x, y, z);
    wrapper.lookAt(cl.cx, y, cl.cz); // -Z local vers le centre
    const clone = gltf.clone(true);
    clone.rotation.x = TREE_TILT;
    clone.scale.setScalar(TREE_SCALE_MIN + rand() * TREE_SCALE_RANGE);
    wrapper.add(clone);
    group.add(wrapper);
  }
}

/** Fer à cheval de buissons, juste derrière les tombes (matrices par espèce). */
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

/** Monument central selon propKind : méga-arbre (île) ou pile de rochers. */
function collectProp(
  cluster: ClusterInfo, cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined,
  rockOut: THREE.Matrix4[], islandTreeOut: THREE.Matrix4[],
) {
  const dummy = new THREE.Object3D();
  if (cluster.propKind === "tree") {
    dummy.position.set(cl.cx, cl.baseY, cl.cz);
    dummy.scale.setScalar(PROP_TREE_SCALE_MIN + rand() * PROP_TREE_SCALE_RANGE);
    dummy.updateMatrix();
    islandTreeOut.push(dummy.matrix.clone());
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

/** Sous-meshes d'un buisson, matériaux clonés puis assombris/désaturés (mur vert
 *  sombre, cf. concept) — une variante par espèce, partagée par toutes ses instances. */
function extractDarkenedSubMeshes(src: THREE.Group, mats: THREE.Material[]): SubMesh[] {
  const subs = extractSubMeshes(src);
  for (const s of subs) {
    const base = s.mat as THREE.MeshStandardMaterial;
    const mat = base.clone();
    if (mat.color) {
      const g = mat.color.r * 0.299 + mat.color.g * 0.587 + mat.color.b * 0.114;
      mat.color.lerp(new THREE.Color(g, g, g), BUSH_DESAT).multiplyScalar(BUSH_DARKEN);
    }
    s.mat = mat;
    mats.push(mat);
  }
  return subs;
}

/** Instancie des sous-meshes (pas d'ombre portée : comportement identique aux
 *  clones d'origine, qui ne projetaient jamais d'ombre). */
function instanceSubMeshes(srcs: SubMesh[], matrices: THREE.Matrix4[]): THREE.InstancedMesh[] {
  return srcs.map(({ geo, mat }) => {
    const m = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere(); // comme GrassField/VegetationInstances — frustum culling correct
    return m;
  });
}

/** Ajoute la couche instanciée d'un asset (GLTF chargé + matrices accumulées) au groupe. */
function addInstancedLayer(
  group: THREE.Group, geos: THREE.BufferGeometry[],
  res: PromiseSettledResult<THREE.Group>, matrices: THREE.Matrix4[],
) {
  if (res.status !== "fulfilled" || !matrices.length) return;
  const srcs = extractSubMeshes(res.value);
  group.add(...instanceSubMeshes(srcs, matrices));
  geos.push(...srcs.map((s) => s.geo));
}

// --- API publique ---

/**
 * Conteneur des biomes d'une tranche de cimetière. `dispose()` libère les
 * ressources créées en propre (disque de terre, allée, géométries instanciées
 * clonées, matériaux de buisson assombris) ; les GLTF/matériaux en cache non.
 */
export class ClusterBiomes {
  readonly group: THREE.Group;
  private readonly geos: THREE.BufferGeometry[];
  private readonly mats: THREE.Material[];

  private constructor(group: THREE.Group, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
    this.group = group;
    this.geos = geos;
    this.mats = mats;
  }

  static async create(companyId: string, frame: Frame, terrain: TerrainChunk | undefined, clustersInChunk: ClusterInfo[]): Promise<ClusterBiomes | null> {
    if (!clustersInChunk.length) return null;
    const group = new THREE.Group();
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const buckets = emptyBuckets();

    // Géométrie procédurale (terre/allée) + collecte des matrices : synchrone,
    // indépendant du chargement des GLTF (placement pur). Seule la voûte de
    // jacarandas reste en clones individuels (voir buildVaultTrees), donc
    // awaited ici, par cluster.
    for (const cluster of clustersInChunk) {
      const rand = seededRandom(hashSeed(`${companyId}:biome:${cluster.x}:${cluster.z}`));
      const cl = makeClearing(frame, cluster, terrain);
      buildEarthDisk(group, cl, geos, mats);
      buildPath(group, cl, geos, mats);
      collectGateAndPebbles(cl, rand, buckets.rock);
      await buildVaultTrees(group, cl, rand, terrain);
      collectBushes(cl, rand, terrain, buckets.bushes);
      collectProp(cluster, cl, rand, terrain, buckets.rock, buckets.islandTree);
    }

    // Un seul InstancedMesh par espèce/asset pour TOUT le chunk (au lieu d'un
    // clone GLTF complet par instance) : draw calls divisés par ~10 par clairière.
    const [islandRes, rockRes, bushRes] = await Promise.allSettled([
      loadGltf(ISLAND_TREE_PATH),
      loadGltf(ROCK_PATH),
      Promise.all(BUSH_PATHS.map((p) => loadGltf(p))),
    ]);

    addInstancedLayer(group, geos, islandRes, buckets.islandTree);
    addInstancedLayer(group, geos, rockRes, buckets.rock);

    if (bushRes.status === "fulfilled") {
      bushRes.value.forEach((src, i) => {
        const matrices = buckets.bushes[i];
        if (!matrices.length) return;
        const srcs = extractDarkenedSubMeshes(src, mats);
        group.add(...instanceSubMeshes(srcs, matrices));
        geos.push(...srcs.map((s) => s.geo));
      });
    }

    return new ClusterBiomes(group, geos, mats);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

/** Biome d'un seul cluster — scène de test (?testCluster). */
export async function buildClusterBiome(cluster: ClusterInfo, frame: Frame, terrain: TerrainChunk | undefined, companyId: string): Promise<THREE.Group> {
  const biomes = await ClusterBiomes.create(companyId, frame, terrain, [cluster]);
  return biomes?.group ?? new THREE.Group();
}
