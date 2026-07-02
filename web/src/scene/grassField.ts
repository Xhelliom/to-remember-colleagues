// Herbe procédurale GPU instanciée : touffes de brins générées (grassBlade.ts),
// posées sur le relief (TerrainChunk) et animées par le champ de vent partagé
// (scene/wind.ts). Remplace les anciennes touffes GLTF Poly Haven — la
// géométrie épouse le relief via un blend normale-brin → normale-terrain qui
// tue le scintillement gris sur les pentes (cf. NORMAL_BLEND_NEAR/FAR).
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { toWorld, type Frame } from "../worldLayout.ts";
import type { TerrainChunk } from "./terrain.ts";
import { addWindWeightAttribute, applyWind, GRASS_WIND_POOL, setWindTime } from "./wind.ts";
import { BLADE_SEGS, bladeClump, terrainNormalFromHeights } from "./grassBlade.ts";

export const MAX_CLUMPS = 4_000; // plafond d'instances (touffes) par tranche — perf InstancedMesh
const CLUMP_DENSITY = 1.6;       // touffes par m² (chaque touffe fusionne plusieurs brins, cf. BLADES_PER_CLUMP)
const BLADES_PER_CLUMP = 5;      // brins fusionnés par touffe — densité "lush" sans multiplier les draw calls
const BORDER_MARGIN = 1.2;       // dégagement des murs latéraux et des bouts de chemin
const FD_EPSILON = 0.08;         // pas (m) des différences finies pour instanceTerrainNormal

// Distance (m) caméra↔brin : sous NORMAL_BLEND_NEAR le blend reste à son minimum
// (0.5 — moitié normale de brin, moitié normale de terrain, détail conservé de
// près) ; au-delà de NORMAL_BLEND_FAR il monte à 1.0 (terrain plein, plus de
// haute fréquence par-brin) — c'est ce qui tue le scintillement gris au loin.
const NORMAL_BLEND_NEAR = 6;
const NORMAL_BLEND_FAR = 24;

// Dégradé d'albédo racine→pointe (frais/humide → sec) ; deux palettes selon la
// santé du cimetière (karma), à l'image des 2 variantes GLTF précédentes.
const ROOT_COLOR_HEALTHY = new THREE.Color(0x274c1d);
const TIP_COLOR_HEALTHY = new THREE.Color(0x8fae4a);
const ROOT_COLOR_POOR = new THREE.Color(0x4a4326);
const TIP_COLOR_POOR = new THREE.Color(0x9a8f52);
const TINT_VARIANCE = 0.18; // amplitude de variation de teinte/luminosité par instance
const GRASS_ROUGHNESS = 0.85;

// --- Shader : blend normale-brin→terrain (vertex) + dégradé d'albédo (fragment) ---

const GRASS_VERTEX_DEFINES = `
  #define NORMAL_BLEND_NEAR ${NORMAL_BLEND_NEAR.toFixed(4)}
  #define NORMAL_BLEND_FAR ${NORMAL_BLEND_FAR.toFixed(4)}
  attribute float aBladeT;
  attribute vec3 instanceTerrainNormal;
  attribute float instanceTint;
  varying float vBladeT;
  varying float vGrassTint;
`;

/** Remplace `#include <normal_vertex>` : fond `vNormal` vers la normale de terrain
 *  selon la distance caméra↔brin (0.5 près → 1.0 loin, cf. NORMAL_BLEND_NEAR/FAR). */
const GRASS_NORMAL_BLEND_GLSL = `
  #include <normal_vertex>
  vBladeT = aBladeT;
  vGrassTint = instanceTint;
  #ifdef USE_INSTANCING
    vec4 _grassWorldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    vec4 _grassWorldPos = modelMatrix * vec4(position, 1.0);
  #endif
  float _grassDist = distance(cameraPosition, _grassWorldPos.xyz);
  float _grassRamp = clamp((_grassDist - NORMAL_BLEND_NEAR) / max(NORMAL_BLEND_FAR - NORMAL_BLEND_NEAR, 0.0001), 0.0, 1.0);
  float _grassBlend = mix(0.5, 1.0, _grassRamp);
  vNormal = normalize(mix(vNormal, instanceTerrainNormal, _grassBlend));
`;

const GRASS_FRAGMENT_DEFINES = `
  varying float vBladeT;
  varying float vGrassTint;
  uniform vec3 uGrassRootColor;
  uniform vec3 uGrassTipColor;
`;

/** Remplace `#include <color_fragment>` : dégradé racine→pointe + variance par instance. */
const GRASS_ALBEDO_GLSL = `
  #include <color_fragment>
  vec3 _grassAlbedo = mix(uGrassRootColor, uGrassTipColor, vBladeT);
  _grassAlbedo *= (1.0 + vGrassTint);
  diffuseColor.rgb *= _grassAlbedo;
`;

/** Matériau de l'herbe : vent partagé (wind.ts) + blend de normale + dégradé d'albédo,
 *  empilés via un seul `onBeforeCompile` chaîné. Un seul programme WebGL compilé pour
 *  tous les champs d'herbe (customProgramCacheKey hérité de GRASS_WIND_POOL) : les
 *  couleurs racine/pointe ne sont que des uniforms, pas des #define. */
function buildGrassMaterial(karma: number, seedOffset: number): THREE.Material {
  const healthy = karma >= 0;
  const rootColor = healthy ? ROOT_COLOR_HEALTHY : ROOT_COLOR_POOR;
  const tipColor = healthy ? TIP_COLOR_HEALTHY : TIP_COLOR_POOR;

  const base = new THREE.MeshStandardMaterial({ roughness: GRASS_ROUGHNESS, side: THREE.DoubleSide });
  const mat = applyWind(base, { pool: GRASS_WIND_POOL, seedOffset });
  const windOnBeforeCompile = mat.onBeforeCompile;

  mat.onBeforeCompile = (shader, renderer) => {
    windOnBeforeCompile.call(mat, shader, renderer);
    Object.assign(shader.uniforms, {
      uGrassRootColor: { value: rootColor },
      uGrassTipColor: { value: tipColor },
    });
    shader.vertexShader = GRASS_VERTEX_DEFINES + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <normal_vertex>", GRASS_NORMAL_BLEND_GLSL);
    shader.fragmentShader = GRASS_FRAGMENT_DEFINES + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", GRASS_ALBEDO_GLSL);
  };
  return mat;
}

/** Karma et saison autorisant l'herbe (sans herbe en hiver ou karma très négatif). */
export function shouldHaveGrass(karma: number, seasonKey: string): boolean {
  return seasonKey !== "winter" && karma >= -5;
}

/** Place les `count` touffes (matrice d'instance + normale de terrain + teinte),
 *  dispersion uniforme dans le rectangle [zLo, zHi] du repère local du cimetière. */
function placeGrassInstances(
  mesh: THREE.InstancedMesh,
  count: number,
  rand: () => number,
  frame: Frame,
  halfWidth: number,
  zLo: number,
  zHi: number,
  heightAt: (x: number, z: number) => number,
  heightScale: number,
  exclude?: (x: number, z: number) => boolean,
): void {
  const dummy = new THREE.Object3D();
  const terrainNormals = new Float32Array(count * 3);
  const tints = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const lx = (rand() * 2 - 1) * halfWidth;
    const lz = zLo + rand() * (zHi - zLo);
    const { x: wx, z: wz } = toWorld(frame, lx, lz);
    dummy.position.set(wx, heightAt(wx, wz), wz);
    dummy.rotation.y = rand() * Math.PI * 2;
    const sw = 0.8 + rand() * 1.2;
    // Pas d'herbe dans les zones exclues (disque de terre, allée) : touffe masquée (échelle 0).
    const skip = exclude?.(wx, wz) ?? false;
    dummy.scale.set(sw, skip ? 0 : (1.0 + rand() * 2.5) * heightScale, sw);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const n = terrainNormalFromHeights(heightAt, wx, wz, FD_EPSILON);
    terrainNormals.set([n.x, n.y, n.z], i * 3);
    tints[i] = (rand() * 2 - 1) * TINT_VARIANCE;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.geometry.setAttribute("instanceTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormals, 3));
  mesh.geometry.setAttribute("instanceTint", new THREE.InstancedBufferAttribute(tints, 1));
}

/** Champ d'herbe procédural instancié (touffes de brins, cf. grassBlade.ts). */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  readonly center: { x: number; z: number };
  /** Nombre d'instances (touffes) — nom conservé pour l'API consommée par cemetery.ts. */
  readonly bladeCount: number;
  private readonly mat: THREE.Material;
  /** Palier de LOD courant (scene/distanceLod.ts) ; 0 = plein détail au chargement. */
  lodTier = 0;

  private constructor(
    mesh: THREE.InstancedMesh,
    mat: THREE.Material,
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
      heightScale?: number;                        // multiplie la hauteur des touffes (herbe haute)
    },
  ): Promise<GrassField | null> {
    const zLo = zStart <= 0 ? BORDER_MARGIN : zStart;
    const zHi = zEnd >= plotDepth ? plotDepth - BORDER_MARGIN : zEnd;
    const halfWidth = plotWidth / 2 - BORDER_MARGIN;

    const clumpCount = Math.max(
      1,
      Math.min(MAX_CLUMPS, Math.round(CLUMP_DENSITY * plotWidth * (zHi - zLo))),
    );
    const seed = hashSeed(companyId + `:grass:${zStart}`);

    const geo = bladeClump(BLADES_PER_CLUMP, BLADE_SEGS, seed);
    addWindWeightAttribute(geo, GRASS_WIND_POOL);
    const mat = buildGrassMaterial(karma, seed % 1000);

    const mesh = new THREE.InstancedMesh(geo, mat, clumpCount);
    mesh.frustumCulled = true;

    const rand = seededRandom(seed);
    const center = toWorld(frame, 0, (zStart + zEnd) / 2);
    const heightScale = opts?.heightScale ?? 1;
    const heightAt: (x: number, z: number) => number = terrain
      ? (x, z) => terrain.getHeightAt(x, z)
      : () => 0;

    placeGrassInstances(mesh, clumpCount, rand, frame, halfWidth, zLo, zHi, heightAt, heightScale, opts?.exclude);
    mesh.computeBoundingSphere();

    return new GrassField(mesh, mat, center, clumpCount);
  }

  /** Avance le champ de vent partagé (cf. wind.ts — une seule horloge pour herbe et arbres). */
  update(time: number) {
    setWindTime(time);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
