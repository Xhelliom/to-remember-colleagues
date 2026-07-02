// Arbres et rochers instanciés (InstancedMesh) par TRANCHE [zStart, zEnd[ du
// couloir d'un cimetière (phase 3) — un InstancedMesh par sous-mesh GLTF (tronc
// + feuillage rendus correctement), densité proportionnelle à l'aire de la tranche.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import { loadGltf } from "./grass.ts";
import type { TerrainChunk } from "./terrain.ts";
import { addWindWeightAttribute, applyWind, setWindTime, SOFT_TREE_WIND_POOL } from "./wind.ts";

const TREE_DENSITY = 0.004; // arbres par m², calée sur la densité visuelle précédente
const ROCK_DENSITY = 0.0028;
const BORDER_MARGIN = 1.5; // retrait des murs latéraux et des bouts de chemin

// Modèles décimés (tools/optimize-models.sh) : ~20k tris au lieu de 1-2M.
function treePath(companyId: string): string {
  return hashSeed(companyId + ":trees") % 2 === 0
    ? "/models/opt/tree/island_tree_02_2k.glb"
    : "/models/opt/tree/tree_small_02_4k.glb";
}

export type SubMesh = { geo: THREE.BufferGeometry; mat: THREE.Material };

/** Extrait tous les sous-meshes d'un GLTF (toutes les primitives). Réutilisé
 *  par scene/biomes/clairiere/builder.ts (mêmes GLTF, matrices différentes). */
export function extractSubMeshes(root: THREE.Group): SubMesh[] {
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
): THREE.Matrix4[] {
  const rand = seededRandom(hashSeed(companyId + suffix + `:${zLo}`));
  const dummy = new THREE.Object3D();
  return Array.from({ length: count }, () => {
    const lx = (rand() * 2 - 1) * halfWidth;
    const lz = zLo + rand() * (zHi - zLo);
    const { x: wx, z: wz } = toWorld(frame, lx, lz);
    dummy.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
    dummy.rotation.y = rand() * Math.PI * 2;
    dummy.scale.setScalar(scaleMin + rand() * scaleRange);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
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

/** Comme buildInstancedMeshes, avec un balancement au vent (arbres uniquement,
 *  pas les rochers). Le matériau balancé est cloné (propre, à disposer) — pas
 *  le matériau GLTF en cache. */
function buildSwayingInstancedMeshes(
  srcs: SubMesh[],
  matrices: THREE.Matrix4[],
  ownedMats: THREE.Material[],
  seedOffset: number,
): THREE.InstancedMesh[] {
  return srcs.map(({ geo, mat }) => {
    addWindWeightAttribute(geo, SOFT_TREE_WIND_POOL);
    const swayMat = applyWind(mat, { pool: SOFT_TREE_WIND_POOL, seedOffset });
    ownedMats.push(swayMat);
    const m = new THREE.InstancedMesh(geo, swayMat, matrices.length);
    m.castShadow = true;
    m.userData.maxCount = matrices.length;
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  });
}

/** Arbres et rochers instanciés d'une tranche de cimetière. */
export class VegetationInstances {
  readonly meshes: THREE.InstancedMesh[];
  readonly center: { x: number; z: number };
  /** Palier de LOD courant (scene/distanceLod.ts) ; 0 = visible au chargement. */
  lodTier = 0;
  private readonly swayMats: THREE.Material[];

  private constructor(meshes: THREE.InstancedMesh[], center: { x: number; z: number }, swayMats: THREE.Material[]) {
    this.meshes = meshes;
    this.center = center;
    this.swayMats = swayMats;
  }

  /**
   * Forêt/rochers d'AMBIANCE d'une tranche (dispersion uniforme). Le monument
   * central d'un cluster (méga-arbre ou pile de rochers) est du ressort de
   * scene/biomes/clairiere/builder.ts, qui possède déjà toute la mise en scène
   * du biome — pas de doublon ici (ancienne redondance corrigée).
   */
  static async create(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    terrain?: TerrainChunk,
  ): Promise<VegetationInstances | null> {
    const [treeRes, rockRes] = await Promise.allSettled([
      loadGltf(treePath(companyId)),
      loadGltf("/models/opt/rock/rock_01_2k.glb"),
    ]);

    const halfWidth = plotWidth / 2 - BORDER_MARGIN;
    const [zLo, zHi] = clampedZRange(zStart, zEnd, plotDepth);
    const area = plotWidth * (zHi - zLo);
    const treeCount = Math.max(1, Math.round(TREE_DENSITY * area));
    const rockCount = Math.max(1, Math.round(ROCK_DENSITY * area));

    const meshes: THREE.InstancedMesh[] = [];
    const swayMats: THREE.Material[] = [];

    if (treeRes.status === "fulfilled") {
      const srcs = extractSubMeshes(treeRes.value);
      if (srcs.length) {
        const matrices = buildPlacementMatrices(companyId, ":trees", treeCount, frame, halfWidth, zLo, zHi, terrain, 0.8, 0.6);
        // Même graine que le placement (déterministe) : décorrèle la phase de balancement
        // (gl_InstanceID, cf. wind.ts) d'une tranche à l'autre, sans nombre magique.
        const seedOffset = hashSeed(companyId + `:trees:${zLo}`) % 1000;
        meshes.push(...buildSwayingInstancedMeshes(srcs, matrices, swayMats, seedOffset));
      }
    }

    if (rockRes.status === "fulfilled") {
      const srcs = extractSubMeshes(rockRes.value);
      if (srcs.length) {
        const matrices = buildPlacementMatrices(companyId, ":rocks", rockCount, frame, halfWidth, zLo, zHi, terrain, 0.2, 0.6);
        meshes.push(...buildInstancedMeshes(srcs, matrices, matrices.length));
      }
    }

    if (!meshes.length) return null;
    return new VegetationInstances(meshes, toWorld(frame, 0, (zStart + zEnd) / 2), swayMats);
  }

  /** Avance le champ de vent partagé (cf. wind.ts — une seule horloge pour herbe et arbres). */
  update(time: number) {
    setWindTime(time);
  }

  dispose() {
    // Géométries clonées → on libère ; matériaux GLTF en cache (rochers) → non ;
    // matériaux balancés (arbres) clonés en propre → à disposer.
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.swayMats) m.dispose();
  }
}
