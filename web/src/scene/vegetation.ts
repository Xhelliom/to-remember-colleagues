// Arbres et rochers instanciés (InstancedMesh) par parcelle de cimetière.
// Un InstancedMesh par sous-mesh GLTF → tronc + feuillage rendus correctement.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";

const TREE_COUNT = 10;
const ROCK_COUNT = 7;
const BORDER_MARGIN = 1.5; // arbres en retrait du mur d'enceinte (m)

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

/** Construit les matrices de placement pour `count` instances. */
function buildPlacementMatrices(
  companyId: string, suffix: string, count: number, r: number,
  plotCenter: { x: number; z: number }, rotY: number,
  terrain: TerrainChunk | undefined,
  placeFn: (rand: () => number, i: number, r: number) => { lx: number; lz: number; ry: number; sc: number },
): THREE.Matrix4[] {
  const rand = seededRandom(hashSeed(companyId + suffix));
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const dummy = new THREE.Object3D();
  return Array.from({ length: count }, (_, i) => {
    const { lx, lz, ry, sc } = placeFn(rand, i, r);
    const wx = plotCenter.x + lx * cos + lz * sin;
    const wz = plotCenter.z - lx * sin + lz * cos;
    dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
    dummy.rotation.y = ry;
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
}

function treePlace(rand: () => number, i: number, r: number) {
  const angle = (i / TREE_COUNT) * Math.PI * 2 + rand() * 0.4;
  const dist = r - rand() * 2;
  return { lx: Math.cos(angle) * dist, lz: Math.sin(angle) * dist, ry: rand() * Math.PI * 2, sc: 0.8 + rand() * 0.6 };
}

function rockPlace(rand: () => number, _i: number, r: number) {
  return { lx: (rand() * 2 - 1) * r, lz: (rand() * 2 - 1) * r, ry: rand() * Math.PI * 2, sc: 0.2 + rand() * 0.6 };
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

/** Arbres et rochers instanciés d'une parcelle. */
export class VegetationInstances {
  readonly meshes: THREE.InstancedMesh[];
  readonly center: { x: number; z: number };

  private constructor(meshes: THREE.InstancedMesh[], center: { x: number; z: number }) {
    this.meshes = meshes;
    this.center = center;
  }

  static async create(
    companyId: string,
    plotHalf: number,
    plotCenter: { x: number; z: number },
    rotY: number,
    terrain?: TerrainChunk,
  ): Promise<VegetationInstances | null> {
    const [treeRes, rockRes] = await Promise.allSettled([
      loadGltf(treePath(companyId)),
      loadGltf("/models/rock/rock_01_2k/rock_01_2k.gltf"),
    ]);

    const meshes: THREE.InstancedMesh[] = [];

    if (treeRes.status === "fulfilled") {
      const srcs = extractSubMeshes(treeRes.value);
      if (srcs.length) {
        const mats = buildPlacementMatrices(companyId, ":trees", TREE_COUNT, plotHalf - BORDER_MARGIN, plotCenter, rotY, terrain, treePlace);
        meshes.push(...buildInstancedMeshes(srcs, mats, TREE_COUNT));
      }
    }

    if (rockRes.status === "fulfilled") {
      const srcs = extractSubMeshes(rockRes.value);
      if (srcs.length) {
        const mats = buildPlacementMatrices(companyId, ":rocks", ROCK_COUNT, Math.max(1, plotHalf - 3), plotCenter, rotY, terrain, rockPlace);
        meshes.push(...buildInstancedMeshes(srcs, mats, ROCK_COUNT));
      }
    }

    if (!meshes.length) return null;
    return new VegetationInstances(meshes, plotCenter);
  }

  dispose() {
    // Géométries clonées → on libère ; matériaux GLTF en cache → non
    for (const m of this.meshes) m.geometry.dispose();
  }
}
