// Herbe GPU instanciée depuis les GLTF Poly Haven + vent via onBeforeCompile.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";

export const MAX_BLADES = 20_000;
const BORDER_MARGIN = 1.2;

// Uniforme de temps partagé : tous les champs utilisent le même programme compilé.
const sharedTime = { value: 0 };

/** Karma et saison autorisant l'herbe (sans herbe en hiver ou karma très négatif). */
export function shouldHaveGrass(karma: number, seasonKey: string): boolean {
  return seasonKey !== "winter" && karma >= -5;
}

function grassPath(karma: number): string {
  // bermuda_01 a un problème de rendu → medium_01 pour les bons karmas
  if (karma >= 0) return "/models/grass/grass_medium_01_2k/grass_medium_01_2k.gltf";
  return "/models/grass/grass_medium_02_2k/grass_medium_02_2k.gltf";
}

function addWindAttr(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const yMin = geo.boundingBox!.min.y;
  const yRange = geo.boundingBox!.max.y - yMin || 1;
  const wind = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) wind[i] = (pos.getY(i) - yMin) / yRange;
  geo.setAttribute("aWind", new THREE.BufferAttribute(wind, 1));
}

function windMat(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const mat = src.clone();
  // ponytail: cache key commun → un seul programme compilé pour tous les champs
  mat.customProgramCacheKey = () => "grassWind";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedTime;
    shader.vertexShader =
      "attribute float aWind;\nuniform float uTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float _sw = aWind * (sin(uTime * 1.3) * 0.08 + sin(uTime * 2.5 + position.z) * 0.04);
       transformed.x += _sw;`,
    );
  };
  return mat;
}

/** Champ d'herbe instancié à partir de touffes GLTF Poly Haven. */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  readonly center: { x: number; z: number };
  private readonly mat: THREE.MeshStandardMaterial;

  private constructor(mesh: THREE.InstancedMesh, mat: THREE.MeshStandardMaterial, center: { x: number; z: number }) {
    this.mesh = mesh;
    this.mat = mat;
    this.center = center;
  }

  static async create(
    companyId: string,
    karma: number,
    plotHalf: number,
    plotCenter: { x: number; z: number },
    rotY: number,
    terrain?: TerrainChunk,
  ): Promise<GrassField | null> {
    let source: THREE.Group;
    try {
      source = await loadGltf(grassPath(karma));
    } catch {
      return null;
    }

    const meshes: THREE.Mesh[] = [];
    source.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    if (!meshes.length) return null;

    const baseMat = Array.isArray(meshes[0].material)
      ? meshes[0].material[0]
      : meshes[0].material;
    if (!(baseMat instanceof THREE.MeshStandardMaterial)) return null;

    const geo = meshes[0].geometry.clone();
    addWindAttr(geo);
    const mat = windMat(baseMat);

    const mesh = new THREE.InstancedMesh(geo, mat, MAX_BLADES);
    mesh.frustumCulled = true;

    const rand = seededRandom(hashSeed(companyId + ":grass"));
    const range = plotHalf - BORDER_MARGIN;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < MAX_BLADES; i++) {
      const lx = (rand() * 2 - 1) * range;
      const lz = (rand() * 2 - 1) * range;
      const wx = plotCenter.x + lx * cos + lz * sin;
      const wz = plotCenter.z - lx * sin + lz * cos;
      dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
      dummy.rotation.y = rand() * Math.PI * 2;
      const sw = 0.8 + rand() * 1.2;
      dummy.scale.set(sw, 1.0 + rand() * 2.5, sw);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    return new GrassField(mesh, mat, plotCenter);
  }

  update(time: number) {
    sharedTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
