// Biome visuel d'un cluster : une CLAIRIÈRE cernée d'arbres en fer à cheval
// (ouvert côté allée), centre en terre, tombes en arc face au visiteur, buissons
// et monument central. Effet « cathédrale naturelle » (phase 4).
// Cibles mesurables : plans/CLUSTER_BIOME_CRITERIA.md.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed, CLUSTER_RADIUS, type ClusterInfo } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";

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

// Prop central (monument)
const PROP_TREE_SCALE_MIN = 2.6;
const PROP_TREE_SCALE_RANGE = 0.8;
const PROP_ROCK_STACK = 4;
const PROP_ROCK_BASE_SCALE = 1.4;
const PROP_ROCK_SCALE_DECAY = 0.18;

// Allée + bornes + cailloux
const PATH_WIDTH = 1.2;
const PATH_LEN = 6;                   // du bord du disque vers le visiteur
const GATE_OFFSET = 1.3;              // écart latéral des bornes de pierre
const GATE_SCALE = 0.9;
const PEBBLE_COUNT = 7;
const PEBBLE_SCALE_MIN = 0.12;
const PEBBLE_SCALE_RANGE = 0.18;

const BUSH_PATHS = [
  "/models/Bush/didelta_spinosa_2k/didelta_spinosa_2k.gltf",
  "/models/Bush/othonna_cerarioides_2k/othonna_cerarioides_2k.gltf",
  "/models/Bush/wild_rooibos_bush_1k/wild_rooibos_bush_1k.gltf",
];
const ROCK_PATH = "/models/rock/rock_01_2k/rock_01_2k.gltf";
const TREE_PATH = "/models/tree/jacaranda_tree_1k/jacaranda_tree_1k.gltf";
const ISLAND_TREE_PATH = "/models/tree/island_tree_02_2k/island_tree_02_2k.gltf";
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
  const ex = frame.entrance.x, ez = frame.entrance.z;
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

// --- Layers ---

/** Disque de terre au centre (sous les tombes). Grass supprimée dedans en amont. */
function buildEarthDisk(group: THREE.Group, cl: Clearing, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const tex = loadTex(EARTH_TEX);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x7a6248, roughness: 1 });
  const geo = new THREE.CircleGeometry(EARTH_RADIUS, 24);
  geos.push(geo); mats.push(mat);
  const disk = new THREE.Mesh(geo, mat);
  disk.rotation.x = -Math.PI / 2;
  disk.position.set(cl.cx, cl.baseY + 0.02, cl.cz);
  disk.receiveShadow = true;
  group.add(disk);
}

/** Allée courte en terre du disque vers le visiteur (+ bornes + cailloux). */
async function buildPathAndGate(group: THREE.Group, cl: Clearing, rand: () => number, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const dX = Math.cos(cl.openAng), dZ = Math.sin(cl.openAng); // vers le visiteur
  const start = EARTH_RADIUS - 0.3;
  const midR = start + PATH_LEN / 2;
  const mx = cl.cx + dX * midR, mz = cl.cz + dZ * midR;

  const tex = loadTex(EARTH_TEX);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: 0x8a6f52, roughness: 1 });
  const geo = new THREE.PlaneGeometry(PATH_WIDTH, PATH_LEN);
  geos.push(geo); mats.push(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  const wrap = new THREE.Group();
  wrap.position.set(mx, cl.baseY + 0.025, mz);
  wrap.rotation.y = Math.atan2(dX, dZ);
  wrap.add(mesh);
  group.add(wrap);

  // Bornes de pierre + cailloux (rock GLTF).
  let rock: THREE.Group | null = null;
  try { rock = await loadGltf(ROCK_PATH); } catch { rock = null; }
  if (!rock) return;
  const perpX = -dZ, perpZ = dX;
  const gateR = start + PATH_LEN; // bouche de l'allée
  for (const side of [-1, 1]) {
    const gx = cl.cx + dX * gateR + perpX * side * GATE_OFFSET;
    const gz = cl.cz + dZ * gateR + perpZ * side * GATE_OFFSET;
    const g = rock.clone(true);
    g.position.set(gx, cl.ground(gx, gz), gz);
    g.rotation.y = rand() * Math.PI;
    g.scale.set(GATE_SCALE * 0.7, GATE_SCALE * 1.6, GATE_SCALE * 0.7); // borne dressée
    group.add(g);
  }
  for (let i = 0; i < PEBBLE_COUNT; i++) {
    const r = start + rand() * PATH_LEN;
    const lat = (rand() * 2 - 1) * (PATH_WIDTH * 0.7);
    const px = cl.cx + dX * r + perpX * lat, pz = cl.cz + dZ * r + perpZ * lat;
    const p = rock.clone(true);
    p.position.set(px, cl.ground(px, pz), pz);
    p.rotation.y = rand() * Math.PI * 2;
    p.scale.setScalar(PEBBLE_SCALE_MIN + rand() * PEBBLE_SCALE_RANGE);
    group.add(p);
  }
}

/** Fer à cheval d'arbres jacaranda, inclinés vers le centre (voûte). */
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

/** Fer à cheval de buissons, juste derrière les tombes. */
async function buildBushes(group: THREE.Group, cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined) {
  const sources = await Promise.all(BUSH_PATHS.map((p) => loadGltf(p)));
  const count = BUSH_COUNT_MIN + Math.floor(rand() * (BUSH_COUNT_MAX - BUSH_COUNT_MIN + 1));
  const span = 2 * Math.PI - 2 * BUSH_OPEN_HALF;
  const startA = cl.openAng + BUSH_OPEN_HALF;
  for (let i = 0; i < count; i++) {
    const a = startA + (i / (count - 1)) * span;
    const r = BUSH_RING + (rand() * 2 - 1) * BUSH_RING_JITTER;
    const { x, z } = ringPoint(cl, a, r);
    const y = terrain ? terrain.getHeightAt(x, z) : 0;
    const clone = sources[i % sources.length].clone(true);
    clone.position.set(x, y, z);
    clone.rotation.y = rand() * Math.PI * 2;
    clone.scale.setScalar(BUSH_SCALE_MIN + rand() * BUSH_SCALE_RANGE);
    group.add(clone);
  }
}

/** Monument central selon propKind. */
async function buildProp(group: THREE.Group, cluster: ClusterInfo, cl: Clearing, rand: () => number, terrain: TerrainChunk | undefined) {
  if (cluster.propKind === "tree") {
    const gltf = await loadGltf(ISLAND_TREE_PATH);
    const clone = gltf.clone(true);
    clone.position.set(cl.cx, cl.baseY, cl.cz);
    clone.scale.setScalar(PROP_TREE_SCALE_MIN + rand() * PROP_TREE_SCALE_RANGE);
    group.add(clone);
  } else if (cluster.propKind === "rocks") {
    const gltf = await loadGltf(ROCK_PATH);
    let y = cl.baseY;
    for (let i = 0; i < PROP_ROCK_STACK; i++) {
      const scale = PROP_ROCK_BASE_SCALE * (1 - i * PROP_ROCK_SCALE_DECAY);
      const clone = gltf.clone(true);
      clone.position.set(cl.cx, y, cl.cz);
      clone.rotation.y = i * 1.3;
      clone.scale.setScalar(scale);
      group.add(clone);
      y += scale * 0.9;
    }
  }
  // "flat" → rien
}

// --- API publique ---

/**
 * Conteneur des biomes d'une tranche de cimetière. `dispose()` libère les
 * ressources créées en propre (disque de terre, allée) ; les GLTF en cache non.
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
    for (const cluster of clustersInChunk) {
      await addCluster(group, cluster, frame, terrain, companyId, geos, mats);
    }
    return new ClusterBiomes(group, geos, mats);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

async function addCluster(group: THREE.Group, cluster: ClusterInfo, frame: Frame, terrain: TerrainChunk | undefined, companyId: string, geos: THREE.BufferGeometry[], mats: THREE.Material[]) {
  const rand = seededRandom(hashSeed(`${companyId}:biome:${cluster.x}:${cluster.z}`));
  const cl = makeClearing(frame, cluster, terrain);
  buildEarthDisk(group, cl, geos, mats);
  await buildPathAndGate(group, cl, rand, geos, mats);
  await buildVaultTrees(group, cl, rand, terrain);
  await buildBushes(group, cl, rand, terrain);
  await buildProp(group, cluster, cl, rand, terrain);
}

/** Biome d'un seul cluster — scène de test (?testCluster). */
export async function buildClusterBiome(cluster: ClusterInfo, frame: Frame, terrain: TerrainChunk | undefined, companyId: string): Promise<THREE.Group> {
  const biomes = await ClusterBiomes.create(companyId, frame, terrain, [cluster]);
  return biomes?.group ?? new THREE.Group();
}
