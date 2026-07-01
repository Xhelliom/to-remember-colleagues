import type * as THREE from "three";

/** Libère géométries ET matériaux/textures d'un objet (sans vider le groupe). */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      // splatTex est une DataTexture hors du circuit standard de dispose
      const splatTex = m.userData?.splatTex as THREE.DataTexture | undefined;
      if (splatTex) splatTex.dispose();
      m.dispose();
    }
  });
}
