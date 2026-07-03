// Géométrie procédurale d'une touffe de brins d'herbe ("clump") — remplace les
// touffes GLTF de grass.ts : une InstancedMesh place des touffes entières (cf.
// grassField.ts), chaque touffe fusionnant plusieurs brins en une seule
// géométrie, pour une herbe dense ("lush") sans multiplier les draw calls.
//
// Référence de concept (LAAS `vegetation/GroundRing.ts` — portée en Three.js
// WebGLRenderer, aucun code copié) : brins courbés en cantilever + normales en
// "demi-cylindre" (bords inclinés ±38°). Un brin plat a une normale plate
// (0,0,1) partout : sous la lumière, ça scintille en gris au moindre mouvement
// de caméra. Incliner les normales de bord fake une section ronde et lisse
// l'ombrage, sans ajouter de géométrie.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";

/** Segments verticaux par brin — résolution de la courbe de flexion. */
export const BLADE_SEGS = 3;
/** Colonnes par étage (gauche/droite) : le "demi-cylindre" ne porte que sur les 2 bords. */
const VERTS_PER_ROW = 2;

/** Sommets d'un seul brin pour `segs` segments verticaux. */
export function vertsPerBlade(segs: number): number {
  return (segs + 1) * VERTS_PER_ROW;
}

/** Angle (rad) des normales de bord par rapport au centre du brin (trick "demi-cylindre"). */
const HALF_CYLINDER_ANGLE = (38 * Math.PI) / 180;

const BLADE_WIDTH_BASE = 0.028;      // largeur à la base (m)
const BLADE_WIDTH_TIP_RATIO = 0.12;  // largeur pointe / largeur base (brin effilé)
const BLADE_HEIGHT_MIN = 0.16;       // hauteur mini d'un brin (m)
const BLADE_HEIGHT_RANGE = 0.24;     // variation de hauteur
const BLADE_LEAN_MAX = 0.4;          // flexion max (unités locales) — anti "maïs planté"
const CLUMP_RADIUS = 0.1;            // dispersion des brins autour du centre de la touffe (m)
const WIDTH_SCALE_MIN = 0.8;
const WIDTH_SCALE_RANGE = 0.4;

/** Pas (m) par défaut des différences finies pour la normale de terrain (cf. `grassField.ts`). */
export const TERRAIN_NORMAL_EPSILON = 0.05;

/** Un brin tiré depuis le flux aléatoire seedé — position/orientation/forme. */
type BladeParams = {
  offsetX: number; offsetZ: number; yaw: number;
  lean: number; height: number; widthScale: number;
};

/** Tire les paramètres d'un brin (déterministe : dépend uniquement de `rand`). */
function drawBladeParams(rand: () => number): BladeParams {
  const angle = rand() * Math.PI * 2;
  const dist = rand() * CLUMP_RADIUS;
  return {
    offsetX: Math.cos(angle) * dist,
    offsetZ: Math.sin(angle) * dist,
    yaw: rand() * Math.PI * 2,
    lean: (rand() * 2 - 1) * BLADE_LEAN_MAX,
    height: BLADE_HEIGHT_MIN + rand() * BLADE_HEIGHT_RANGE,
    widthScale: WIDTH_SCALE_MIN + rand() * WIDTH_SCALE_RANGE,
  };
}

/** Écrit les sommets d'UN étage (2 colonnes) du brin dans les buffers, à l'index `vi`. */
function writeBladeRow(
  p: BladeParams, t: number, vi: number,
  positions: Float32Array, normals: Float32Array, uvs: Float32Array, bladeT: Float32Array,
): void {
  const cosYaw = Math.cos(p.yaw), sinYaw = Math.sin(p.yaw);
  const y = t * p.height;
  const bend = p.lean * t * t; // flexion cantilever : base quasi fixe, pointe mobile
  const halfWidth = (BLADE_WIDTH_BASE * p.widthScale * (1 - t * (1 - BLADE_WIDTH_TIP_RATIO))) / 2;

  for (let c = 0; c < VERTS_PER_ROW; c++) {
    const side = c === 0 ? -1 : 1;
    const localX = bend + side * halfWidth;
    const edgeAngle = side * HALF_CYLINDER_ANGLE;
    const nLocalX = Math.sin(edgeAngle), nLocalZ = Math.cos(edgeAngle);

    const j = vi + c;
    positions[j * 3] = p.offsetX + localX * cosYaw;
    positions[j * 3 + 1] = y;
    positions[j * 3 + 2] = p.offsetZ + localX * sinYaw;
    normals[j * 3] = nLocalX * cosYaw - nLocalZ * sinYaw;
    normals[j * 3 + 1] = 0;
    normals[j * 3 + 2] = nLocalX * sinYaw + nLocalZ * cosYaw;
    uvs[j * 2] = c;
    uvs[j * 2 + 1] = t;
    bladeT[j] = t;
  }
}

/** Ajoute un brin complet (segs+1 étages × 2 colonnes + indices) à partir de `baseIndex`. */
function appendBlade(
  p: BladeParams, segs: number, baseIndex: number,
  positions: Float32Array, normals: Float32Array, uvs: Float32Array, bladeT: Float32Array,
  indices: number[],
): void {
  for (let r = 0; r <= segs; r++) {
    const vi = baseIndex + r * VERTS_PER_ROW;
    writeBladeRow(p, r / segs, vi, positions, normals, uvs, bladeT);
    if (r === segs) continue;
    const bl = vi, br = vi + 1, tl = vi + VERTS_PER_ROW, tr = tl + 1;
    indices.push(bl, br, tr, bl, tr, tl);
  }
}

/**
 * Géométrie d'une touffe de `blades` brins fusionnés (une InstancedMesh place
 * ensuite des touffes entières, cf. `grassField.ts`). Déterministe : même
 * `seed` → mêmes sommets ; deux graines différentes → touffes différentes.
 */
export function bladeClump(blades: number, segs: number, seed: number): THREE.BufferGeometry {
  const rand = seededRandom(seed);
  const vpb = vertsPerBlade(segs);
  const vertexCount = blades * vpb;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const bladeT = new Float32Array(vertexCount);
  const indices: number[] = [];

  for (let b = 0; b < blades; b++) {
    appendBlade(drawBladeParams(rand), segs, b * vpb, positions, normals, uvs, bladeT, indices);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  // Fraction racine(0)→pointe(1) le long du brin — utilisée par grassField.ts pour
  // le dégradé d'albédo (frais à la base, sec à la pointe), indépendant de tout UV/map.
  geo.setAttribute("aBladeT", new THREE.BufferAttribute(bladeT, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Normale du terrain en (x, z) par différences finies centrées sur `heightAt`
 * (typiquement `TerrainChunk.getHeightAt`). Fonction PURE — testable sans
 * Three.js ni géométrie de terrain réelle (cf. grassBlade.test.ts). Consommée
 * par `grassField.ts` pour poser l'attribut d'instance `instanceTerrainNormal`.
 */
export function terrainNormalFromHeights(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  epsilon: number = TERRAIN_NORMAL_EPSILON,
): THREE.Vector3 {
  const hL = heightAt(x - epsilon, z);
  const hR = heightAt(x + epsilon, z);
  const hD = heightAt(x, z - epsilon);
  const hU = heightAt(x, z + epsilon);
  const dHdx = (hR - hL) / (2 * epsilon);
  const dHdz = (hU - hD) / (2 * epsilon);
  return new THREE.Vector3(-dHdx, 1, -dHdz).normalize();
}
