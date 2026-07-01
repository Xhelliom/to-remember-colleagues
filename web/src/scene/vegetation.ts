// Arbres et rochers instanciés (InstancedMesh) par TRANCHE [zStart, zEnd[ du
// couloir d'un cimetière (phase 3) — un InstancedMesh par sous-mesh GLTF (tronc
// + feuillage rendus correctement), densité proportionnelle à l'aire de la tranche.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed, type ClusterInfo } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";

const TREE_DENSITY = 0.004; // arbres par m², calée sur la densité visuelle précédente
const ROCK_DENSITY = 0.0028;
const BORDER_MARGIN = 1.5; // retrait des murs latéraux et des bouts de chemin
const CLUSTER_TREE_SCALE = 3.5; // méga-arbre, échelle disproportionnée (mini-biome, phase 4)
const CLUSTER_ROCK_STACK = 4; // empilement de rochers = fausse falaise
const CLUSTER_ROCK_BASE_SCALE = 1.4;
const CLUSTER_ROCK_SCALE_DECAY = 0.18; // rétrécit à chaque rocher empilé
const CLUSTER_ROCK_ROTATION_STEP = 1.3; // rotation (rad) entre rochers empilés
const CLUSTER_ROCK_STACK_FACTOR = 0.9;  // fraction de l'échelle empilée en hauteur
const TREE_SCALE_MIN = 0.8;             // échelle mini et amplitude des arbres d'ambiance
const TREE_SCALE_RANGE = 0.6;
const ROCK_SCALE_MIN = 0.2;             // échelle mini et amplitude des rochers d'ambiance
const ROCK_SCALE_RANGE = 0.6;
const TREE_EDGE_BAND = 2;               // arbres collés aux murs latéraux (allée centrale dégagée)

function treePath(companyId: string): string {
  return hashSeed(companyId + ":trees") % 2 === 0
    ? "/models/tree/island_tree_02_2k/island_tree_02_2k.gltf"
    : "/models/tree/tree_small_02_4k/tree_small_02_4k.gltf";
}

type SubMesh = { geo: THREE.BufferGeometry; mat: THREE.Material };

/** Extrait tous les sous-meshes d'un GLTF (toutes les primitives). */
function extractSubMeshes(root: THREE.Group): SubMesh[] {
  const result: SubMesh[] = [];
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    result.push({ geo: m.geometry.clone(), mat });
  });
  return result;
}

/** Bornes [zLo, zHi] : dégagées uniquement aux vrais bouts du chemin (jamais aux jointures internes). */
function clampedZRange(zStart: number, zEnd: number, plotDepth: number): [number, number] {
  const zLo = zStart <= 0 ? BORDER_MARGIN : zStart;
  const zHi = zEnd >= plotDepth ? plotDepth - BORDER_MARGIN : zEnd;
  return [zLo, zHi];
}

/** Construit les matrices de placement (dispersion uniforme dans le rectangle de la tranche). */
function buildPlacementMatrices(
  companyId: string, suffix: string, count: number,
  frame: Frame, halfWidth: number, zLo: number, zHi: number,
  terrain: TerrainChunk | undefined,
  scaleMin: number, scaleRange: number,
  edgeBias = false,
): THREE.Matrix4[] {
  const rand = seededRandom(hashSeed(companyId + suffix + `:${zLo}`));
  const dummy = new THREE.Object3D();
  return Array.from({ length: count }, () => {
    // `edgeBias` : arbres d'ambiance près des murs latéraux (comme l'ancien
    // anneau de bordure) pour ne pas tomber sur les rangées de tombes du centre.
    const lx = edgeBias
      ? (rand() < 0.5 ? -1 : 1) * (halfWidth - rand() * TREE_EDGE_BAND)
      : (rand() * 2 - 1) * halfWidth;
    const lz = zLo + rand() * (zHi - zLo);
    const { x: wx, z: wz } = toWorld(frame, lx, lz);
    dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.setScalar(scaleMin + rand() * scaleRange);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
}

/** Méga-arbre au centre d'un cluster « tree » (mini-biome, phase 4). */
function clusterTreeMatrix(frame: Frame, cluster: ClusterInfo, terrain?: TerrainChunk): THREE.Matrix4 {
  const { x: wx, z: wz } = toWorld(frame, cluster.x, cluster.z);
  const dummy = new THREE.Object3D();
  dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
  dummy.scale.setScalar(CLUSTER_TREE_SCALE);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

/** Empilement de rochers au centre d'un cluster « rocks » (fausse falaise, phase 4). */
function clusterRockMatrices(frame: Frame, cluster: ClusterInfo, terrain?: TerrainChunk): THREE.Matrix4[] {
  const { x: wx, z: wz } = toWorld(frame, cluster.x, cluster.z);
  const baseY = terrain ? terrain.getHeightAt(wx, wz) : 0;
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  let y = baseY;
  for (let i = 0; i < CLUSTER_ROCK_STACK; i++) {
    const scale = CLUSTER_ROCK_BASE_SCALE * (1 - i * CLUSTER_ROCK_SCALE_DECAY);
    dummy.position.set(wx, y, wz);
    dummy.rotation.y = i * CLUSTER_ROCK_ROTATION_STEP;
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    y += scale * CLUSTER_ROCK_STACK_FACTOR; // empile approximativement chaque rocher sur le précédent
  }
  return matrices;
}

function buildInstancedMeshes(srcs: SubMesh[], matrices: THREE.Matrix4[], count: number): THREE.InstancedMesh[] {
  return srcs.map(({ geo, mat }) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = true;
    m.userData.maxCount = count;
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere(); // comme GrassField — frustum culling correct
    return m;
  });
}

/** Arbres et rochers instanciés d'une tranche de cimetière. */
export class VegetationInstances {
  readonly meshes: THREE.InstancedMesh[];
  readonly center: { x: number; z: number };
  /** Demi-longueur de la tranche (Z), pour le LOD par distance au chunk (pas au centre). */
  readonly halfLength: number;

  private constructor(meshes: THREE.InstancedMesh[], center: { x: number; z: number }, halfLength: number) {
    this.meshes = meshes;
    this.center = center;
    this.halfLength = halfLength;
  }

  static async create(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    clustersInChunk: ClusterInfo[],
    terrain?: TerrainChunk,
  ): Promise<VegetationInstances | null> {
    const [treeRes, rockRes] = await Promise.allSettled([
      loadGltf(treePath(companyId)),
      loadGltf("/models/rock/rock_01_2k/rock_01_2k.gltf"),
    ]);

    const halfWidth = plotWidth / 2 - BORDER_MARGIN;
    const [zLo, zHi] = clampedZRange(zStart, zEnd, plotDepth);
    const area = plotWidth * (zHi - zLo);
    const treeCount = Math.max(1, Math.round(TREE_DENSITY * area));
    const rockCount = Math.max(1, Math.round(ROCK_DENSITY * area));
    const treeProps = clustersInChunk.filter((c) => c.propKind === "tree");
    const rockProps = clustersInChunk.filter((c) => c.propKind === "rocks");

    const meshes: THREE.InstancedMesh[] = [];

    if (treeRes.status === "fulfilled") {
      const srcs = extractSubMeshes(treeRes.value);
      if (srcs.length) {
        const ambient = buildPlacementMatrices(companyId, ":trees", treeCount, frame, halfWidth, zLo, zHi, terrain, TREE_SCALE_MIN, TREE_SCALE_RANGE, true);
        const props = treeProps.map((c) => clusterTreeMatrix(frame, c, terrain));
        const mats = [...ambient, ...props];
        meshes.push(...buildInstancedMeshes(srcs, mats, mats.length));
      }
    }

    if (rockRes.status === "fulfilled") {
      const srcs = extractSubMeshes(rockRes.value);
      if (srcs.length) {
        const ambient = buildPlacementMatrices(companyId, ":rocks", rockCount, frame, halfWidth, zLo, zHi, terrain, ROCK_SCALE_MIN, ROCK_SCALE_RANGE);
        const props = rockProps.flatMap((c) => clusterRockMatrices(frame, c, terrain));
        const mats = [...ambient, ...props];
        meshes.push(...buildInstancedMeshes(srcs, mats, mats.length));
      }
    }

    if (!meshes.length) return null;
    return new VegetationInstances(meshes, toWorld(frame, 0, (zStart + zEnd) / 2), (zEnd - zStart) / 2);
  }

  dispose() {
    // Géométries clonées → on libère ; matériaux GLTF en cache → non
    for (const m of this.meshes) m.geometry.dispose();
  }
}
