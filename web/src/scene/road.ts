// Ruban de la route commune (chantier 2.2) : suit une polyligne déjà lissée
// par Catmull-Rom (worldLayout.ts:smoothCenterline), texturée avec rocky_trail
// (réutilisée du sol des cimetières, grass.ts) le long de l'abscisse
// curviligne, accotement en dégradé (route → couleur d'ambiance) au lieu du
// bord net d'origine, micro-relief doux (terrainHeightAt) qui s'annule aux
// abords des arches — sinon la route décollerait du sol plat du cimetière.
import * as THREE from "three";
import { hashSeed } from "../procedural.ts";
import { ROAD_HALF, type Vec2, type WorldSlot } from "../worldLayout.ts";
import { loadDiffuseTex, loadTex } from "./grass.ts";
import { terrainHeightAt } from "./terrain.ts";

const ROAD_Y = 0.02; // léger décollement du sol pour éviter le z-fighting
const SHOULDER_WIDTH = 2; // m d'accotement en dégradé de chaque côté du ruban
const TEXTURE_TILE_M = 2; // m par répétition de texture le long de l'abscisse curviligne
const RELIEF_SEED = hashSeed("world:road");
// Amplitude brute de terrainHeightAt = 2 m (terrain.ts) : bien trop pour une route
// (« un terrain doux », pas des creux/bosses de 2 m) → réduite à une fraction.
const RELIEF_FACTOR = 0.15;
const ENTRANCE_FADE_DIST = 5; // m — le relief s'annule à l'approche d'une arche

/** Facteur [0,1] qui annule le micro-relief près d'une entrée de cimetière —
 *  la route doit y rester exactement plate pour raccorder le sol du chunk
 *  (déjà à 0 sur son propre bord, cf. terrain.ts:borderFade). */
function reliefFadeNear(x: number, z: number, slots: readonly WorldSlot[]): number {
  if (slots.length === 0) return 1;
  let minDist = Infinity;
  for (const s of slots) minDist = Math.min(minDist, Math.hypot(x - s.entrance.x, z - s.entrance.z));
  return Math.max(0, Math.min(1, minDist / ENTRANCE_FADE_DIST));
}

/** Matériau rocky_trail + dégradé d'accotement vers `shoulderColorHex` (piloté
 *  par l'attribut `aShoulder`, 1 = centre route, 0 = bord externe). */
function buildRoadMaterial(shoulderColorHex: number): THREE.MeshStandardMaterial {
  const rt = "/textures/ground/rocky_trail_2k/textures/rocky_trail";
  const map = loadDiffuseTex(`${rt}_diff_2k.jpg`).clone();
  const normalMap = loadTex(`${rt}_nor_gl_2k.jpg`).clone();
  // RepeatWrapping : le V (longueur) dépasse [0,1] par construction (UV = distance
  // curviligne / TEXTURE_TILE_M) ; le U (largeur) y reste toujours, sans effet.
  for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.95 });
  const uniforms = { uShoulderColor: { value: new THREE.Color(shoulderColorHex) } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float aShoulder;\nvarying float vShoulder;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      "vShoulder = aShoulder;\n#include <begin_vertex>",
    );
    shader.fragmentShader = `varying float vShoulder;\nuniform vec3 uShoulderColor;\n${shader.fragmentShader}`.replace(
      "#include <map_fragment>",
      "#include <map_fragment>\ndiffuseColor.rgb = mix(uShoulderColor, diffuseColor.rgb, vShoulder);",
    );
  };
  mat.customProgramCacheKey = () => "road";
  return mat;
}

/**
 * Ruban de route : 4 colonnes par section (bord externe gauche, bord route
 * gauche, bord route droit, bord externe droit) — 3 bandes de quads (accotement
 * gauche, chaussée, accotement droit) au lieu d'une seule, pour porter le
 * dégradé de bord ET le micro-relief. `points` doit être déjà lissé
 * (worldLayout.ts:smoothCenterline) — ce module ne fait que l'extrusion.
 */
export function buildRoad(points: readonly Vec2[], slots: readonly WorldSlot[], shoulderColorHex: number): THREE.Mesh {
  const m = points.length;
  const fullHalf = ROAD_HALF + SHOULDER_WIDTH;
  const offsets = [-fullHalf, -ROAD_HALF, ROAD_HALF, fullHalf];
  const shoulderValues = [0, 1, 1, 0];

  const positions = new Float32Array(m * 4 * 3);
  const uvs = new Float32Array(m * 4 * 2);
  const shoulderAttr = new Float32Array(m * 4);

  let curviLength = 0;
  for (let i = 0; i < m; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(m - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    const p = points[i];

    if (i > 0) curviLength += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const v = curviLength / TEXTURE_TILE_M;
    const fade = reliefFadeNear(p.x, p.z, slots);

    for (let k = 0; k < 4; k++) {
      const off = offsets[k];
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      const y = ROAD_Y + terrainHeightAt(RELIEF_SEED, x, z) * RELIEF_FACTOR * fade;
      const vi = i * 4 + k;
      positions.set([x, y, z], vi * 3);
      uvs.set([(off + fullHalf) / (fullHalf * 2), v], vi * 2);
      shoulderAttr[vi] = shoulderValues[k];
    }
  }

  const idx: number[] = [];
  for (let i = 0; i < m - 1; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      const b = i * 4 + k + 1;
      const c = (i + 1) * 4 + k;
      const d = (i + 1) * 4 + k + 1;
      idx.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("aShoulder", new THREE.BufferAttribute(shoulderAttr, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const road = new THREE.Mesh(geo, buildRoadMaterial(shoulderColorHex));
  road.receiveShadow = true;
  return road;
}
