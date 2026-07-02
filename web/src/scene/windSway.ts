// Balancement au vent (vertex shader), partagé par l'herbe (grassField.ts) et
// les arbres instanciés (vegetation.ts) : décale `transformed.x` proportionnellement
// à la hauteur du vertex, amplitude/fréquence propres à chaque appelant.
import * as THREE from "three";

/** Ajoute l'attribut `aWind` : 0 à la base du mesh, 1 au sommet (bounding box Y). */
export function addWindAttr(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const yMin = geo.boundingBox!.min.y;
  const yRange = geo.boundingBox!.max.y - yMin || 1;
  const wind = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) wind[i] = (pos.getY(i) - yMin) / yRange;
  geo.setAttribute("aWind", new THREE.BufferAttribute(wind, 1));
}

export type SwayParams = { amp1: number; freq1: number; amp2: number; freq2: number; cacheKey: string };

/** Clone le matériau et ajoute le balancement vertex (uTime partagé : un seul
 *  programme compilé par `cacheKey`, cf. customProgramCacheKey). */
export function applySway(
  src: THREE.Material,
  sharedTime: { value: number },
  p: SwayParams,
): THREE.Material {
  const mat = src.clone();
  mat.customProgramCacheKey = () => p.cacheKey;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedTime;
    shader.vertexShader = "attribute float aWind;\nuniform float uTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float _sw = aWind * (sin(uTime * ${p.freq1.toFixed(4)}) * ${p.amp1.toFixed(4)} + sin(uTime * ${p.freq2.toFixed(4)} + position.z) * ${p.amp2.toFixed(4)});
       transformed.x += _sw;`,
    );
  };
  return mat;
}
