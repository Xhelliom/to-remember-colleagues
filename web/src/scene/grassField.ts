// Herbe GPU instanciée depuis les GLTF Poly Haven + vent via onBeforeCompile.
// Une instance par TRANCHE [zStart, zEnd[ du couloir (phase 3) — la densité
// (nombre de brins) est proportionnelle à l'aire de la tranche, pas fixe.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";

export const MAX_BLADES = 20_000; // plafond par tranche (perf InstancedMesh)
const BLADE_DENSITY = 8; // brins par m², calée sur la densité visuelle précédente
const BORDER_MARGIN = 1.2; // dégagement des murs latéraux et des bouts de chemin

// Uniforme de temps partagé : tous les champs utilisent le même programme compilé.
const sharedTime = { value: 0 };

/** Karma et saison autorisant l'herbe (sans herbe en hiver ou karma très négatif). */
export function shouldHaveGrass(karma: number, seasonKey: string): boolean {
  return seasonKey !== "winter" && karma >= -5;
}

function grassPath(karma: number): string {
  // bermuda_01 a un problème de rendu → medium_01 pour les bons karmas
  // Modèles décimés (tools/optimize-models.sh) : ~1,5-2k tris au lieu de ~8-25k.
  if (karma >= 0) return "/models/opt/grass/grass_medium_01_2k.glb";
  return "/models/opt/grass/grass_medium_02_2k.glb";
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
  readonly bladeCount: number;
  private readonly mat: THREE.MeshStandardMaterial;
  /** Palier de LOD courant (scene/distanceLod.ts) ; 0 = plein détail au chargement. */
  lodTier = 0;

  private constructor(
    mesh: THREE.InstancedMesh,
    mat: THREE.MeshStandardMaterial,
    center: { x: number; z: number },
    bladeCount: number,
  ) {
    this.mesh = mesh;
    this.mat = mat;
    this.center = center;
    this.bladeCount = bladeCount;
  }

  static async create(
    companyId: string,
    karma: number,
    frame: Frame,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    terrain?: TerrainChunk,
    opts?: {
      exclude?: (x: number, z: number) => boolean; // vrai = pas d'herbe ici (clairière, allée)
      heightScale?: number;                        // multiplie la hauteur des brins (herbe haute)
    },
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

    const zLo = zStart <= 0 ? BORDER_MARGIN : zStart;
    const zHi = zEnd >= plotDepth ? plotDepth - BORDER_MARGIN : zEnd;
    const halfWidth = plotWidth / 2 - BORDER_MARGIN;
    const bladeCount = Math.max(1, Math.min(MAX_BLADES, Math.round(BLADE_DENSITY * plotWidth * (zHi - zLo))));

    const mesh = new THREE.InstancedMesh(geo, mat, bladeCount);
    mesh.frustumCulled = true;

    const rand = seededRandom(hashSeed(companyId + `:grass:${zStart}`));
    const center = toWorld(frame, 0, (zStart + zEnd) / 2);
    const dummy = new THREE.Object3D();
    const heightScale = opts?.heightScale ?? 1;
    for (let i = 0; i < bladeCount; i++) {
      const lx = (rand() * 2 - 1) * halfWidth;
      const lz = zLo + rand() * (zHi - zLo);
      const { x: wx, z: wz } = toWorld(frame, lx, lz);
      dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
      dummy.rotation.y = rand() * Math.PI * 2;
      const sw = 0.8 + rand() * 1.2;
      // Pas d'herbe dans les zones exclues (disque de terre, allée) : brin masqué (échelle 0).
      const skip = opts?.exclude?.(wx, wz) ?? false;
      dummy.scale.set(sw, skip ? 0 : (1.0 + rand() * 2.5) * heightScale, sw);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    return new GrassField(mesh, mat, center, bladeCount);
  }

  update(time: number) {
    sharedTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
