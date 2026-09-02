// Props low-poly procéduraux partagés — rochers, arbres et buissons de décor.
// Remplace les GLTF photoréalistes Poly Haven (jacaranda, island_tree, rock,
// 3 buissons) : leur photogrammétrie jurait à côté de l'herbe, des stèles et du
// sous-bois, tous générés à la main. Un seul langage visuel, tout dérivé d'une
// graine — donc déterministe, sans requête réseau, et libéré explicitement.
//
// Chaque constructeur renvoie des `SubMesh` prêts pour `THREE.InstancedMesh`
// (une passe de dessin par sous-maillage et par tranche), pas des objets à
// cloner : c'est le contrat qu'attendaient déjà les consommateurs GLTF.
import * as THREE from "three";
import { buildRock, defaultRockParams } from "./stone.ts";
import { buildTree } from "./trees/treeBuilder.ts";
import { buildBush } from "./trees/understory.ts";

/** Géométrie + matériau d'un sous-maillage instanciable. */
export type SubMesh = { geo: THREE.BufferGeometry; mat: THREE.Material };
/** Source de props : sous-maillages à instancier + libération de ce qu'elle possède. */
export type PropSource = { readonly subMeshes: SubMesh[]; dispose(): void };

const ROCK_ROUGHNESS = 1;
// Detail 2 = 320 triangles : la silhouette strates/fissures de stone.ts est
// lisible, on reste très en dessous des ~40 k du rocher scanné qu'il remplace.
const ROCK_DETAIL = 2;
/** Aplatissement par défaut d'un caillou posé au sol (cf. defaultRockParams). */
const ROCK_SQUASH_FLAT = { x: 1, y: 0.82, z: 1 };
/** Bloc dressé : haut et resserré — sert la verticalité du paysage. */
export const ROCK_SQUASH_STANDING = { x: 0.8, y: 1.9, z: 0.75 };

/** Feuillage « cloud » (gros blobs facettés) : le seul mode sans capture
 *  d'atlas, donc sans renderer — et le plus proche du parti pris low-poly. */
const DECOR_FOLIAGE_MODE = "cloud" as const;

/**
 * Rocher de décor de rayon 1 (l'échelle réelle vient de la matrice d'instance),
 * coloré par `vertexColors` — un seul matériau pour toutes les tailles.
 */
export function rockSource(seed: number, squash = ROCK_SQUASH_FLAT): PropSource {
  const params = { ...defaultRockParams(1, ROCK_DETAIL), squash };
  const { geometry } = buildRock(params, seed);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROCK_ROUGHNESS });
  return {
    subMeshes: [{ geo: geometry, mat }],
    dispose() {
      geometry.dispose();
      mat.dispose();
    },
  };
}

/** Extrait les sous-maillages d'un groupe construit ici (géométries et
 *  matériaux nous appartiennent : ni clone ni cache, contrairement aux GLTF). */
function ownedSubMeshes(root: THREE.Group): SubMesh[] {
  const out: SubMesh[] = [];
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) out.push({ geo: m.geometry, mat: Array.isArray(m.material) ? m.material[0] : m.material });
  });
  return out;
}

function disposeSubMeshes(subMeshes: SubMesh[]): void {
  for (const { geo, mat } of subMeshes) {
    geo.dispose();
    mat.dispose();
  }
}

/** Arbre de décor (écorce + canopée facettée), instanciable. */
export function treeSource(seed: number, lod = 0): PropSource {
  const subMeshes = ownedSubMeshes(buildTree(seed, { lod, foliageMode: DECOR_FOLIAGE_MODE }).group);
  return { subMeshes, dispose: () => disposeSubMeshes(subMeshes) };
}

/** Arbuste de décor (tiges + feuillage), instanciable. */
export function bushSource(seed: number, lod = 0): PropSource {
  const subMeshes = ownedSubMeshes(buildBush(seed, { lod }).group);
  return { subMeshes, dispose: () => disposeSubMeshes(subMeshes) };
}

/** Un `InstancedMesh` par sous-maillage, aux matrices données. */
export function instanceProps(source: PropSource, matrices: readonly THREE.Matrix4[], castShadow = true): THREE.InstancedMesh[] {
  return source.subMeshes.map(({ geo, mat }) => {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    mesh.castShadow = castShadow;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // frustum culling correct, comme GrassField
    return mesh;
  });
}
