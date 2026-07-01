// Arbres et rochers instanciés (InstancedMesh) par parcelle de cimetière.
// Géométrie extraite du premier mesh GLTF Poly Haven ; graine déterministe.
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

function extractFirstMesh(root: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  const hits: THREE.Mesh[] = [];
  root.traverse((obj) => { if ((obj as THREE.Mesh).isMesh) hits.push(obj as THREE.Mesh); });
  const first = hits[0];
  if (!first) return null;
  const mat = Array.isArray(first.material) ? first.material[0] : first.material;
  return { geo: first.geometry.clone(), mat };
}

function stamp(
  dummy: THREE.Object3D, mesh: THREE.InstancedMesh, i: number,
  wx: number, wz: number, ry: number, sc: number,
  terrain: TerrainChunk | undefined,
) {
  dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
  dummy.rotation.y = ry;
  dummy.scale.setScalar(sc);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
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
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const dummy = new THREE.Object3D();

    if (treeRes.status === "fulfilled") {
      const src = extractFirstMesh(treeRes.value);
      if (src) {
        const m = new THREE.InstancedMesh(src.geo, src.mat, TREE_COUNT);
        m.castShadow = true;
        m.userData.maxCount = TREE_COUNT;
        const rand = seededRandom(hashSeed(companyId + ":trees"));
        const r = plotHalf - BORDER_MARGIN;
        for (let i = 0; i < TREE_COUNT; i++) {
          const angle = (i / TREE_COUNT) * Math.PI * 2 + rand() * 0.4;
          const dist = r - rand() * 2;
          const lx = Math.cos(angle) * dist;
          const lz = Math.sin(angle) * dist;
          stamp(dummy, m, i,
            plotCenter.x + lx * cos + lz * sin,
            plotCenter.z - lx * sin + lz * cos,
            rand() * Math.PI * 2, 0.8 + rand() * 0.6, terrain,
          );
        }
        m.instanceMatrix.needsUpdate = true;
        meshes.push(m);
      }
    }

    if (rockRes.status === "fulfilled") {
      const src = extractFirstMesh(rockRes.value);
      if (src) {
        const m = new THREE.InstancedMesh(src.geo, src.mat, ROCK_COUNT);
        m.castShadow = true;
        m.userData.maxCount = ROCK_COUNT;
        const rand = seededRandom(hashSeed(companyId + ":rocks"));
        const r = Math.max(1, plotHalf - 3);
        for (let i = 0; i < ROCK_COUNT; i++) {
          const lx = (rand() * 2 - 1) * r;
          const lz = (rand() * 2 - 1) * r;
          stamp(dummy, m, i,
            plotCenter.x + lx * cos + lz * sin,
            plotCenter.z - lx * sin + lz * cos,
            rand() * Math.PI * 2, 0.2 + rand() * 0.6, terrain,
          );
        }
        m.instanceMatrix.needsUpdate = true;
        meshes.push(m);
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
