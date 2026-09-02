// Étangs d'un cimetière : une cuvette creusée dans le terrain et un disque
// d'eau. Ils donnent au relief un point bas vers lequel le regard descend —
// sans eux, les terrasses de terrain.ts ne montent que vers le haut.
//
// Le placement est PUR et déterministe (graine du cimetière) : on tire des
// candidats dans le couloir et on retient le premier qui laisse une berge
// suffisante avec le chemin. Aucun étang ne peut donc couper une allée.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { distanceToPath, hashSeed, type CemeteryLayout } from "../procedural.ts";

/** Étang, en coordonnées LOCALES du cimetière. */
export type Pond = { x: number; z: number; radius: number };

const POND_RADIUS_MIN = 4;
const POND_RADIUS_RANGE = 3;
/** Profondeur au centre (m) — au-delà, la berge devient une falaise. */
const POND_DEPTH = 1.8;
/** Fraction remplie : l'eau affleure presque la berge, sans la noyer. */
const WATER_FILL = 0.82;
/** Berge entre l'eau et le chemin le plus proche (m). */
const POND_BANK = 4;
/** Terrain aplani autour de l'eau, au-delà du rayon (m) : la cuvette doit
 *  reposer à plat, sinon l'eau déborde du côté où le relief descend. */
const POND_FLAT_MARGIN = 3;
/** Tirages avant d'abandonner un étang : le couloir peut être saturé de chemins. */
const POND_CANDIDATES = 16;
/** Une tranche sur N porte un étang — au-delà, le cimetière tourne au marais. */
const CHUNKS_PER_POND = 3;
/** Profondeur (m) à partir de laquelle un cimetière mérite au moins un étang —
 *  sans ce plancher, tout cimetière tenant en une seule tranche en était privé. */
const MIN_DEPTH_FOR_POND = 60;
const MARGIN_FROM_WALL = 3;

const WATER_COLOR = 0x2c4a52;
const WATER_ROUGHNESS = 0.12;
const WATER_METALNESS = 0.35;
const WATER_OPACITY = 0.88;
const WATER_SEGMENTS = 28;

/** Niveau de l'eau, en repère local (le terrain vaut 0 autour de l'étang). */
export const WATER_LEVEL = -POND_DEPTH * (1 - WATER_FILL);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Étangs d'un cimetière — un par groupe de `CHUNKS_PER_POND` tranches, chacun
 * cherché dans sa propre bande de profondeur pour qu'ils ne s'agglutinent pas.
 */
export function cemeteryPonds(companyId: string, layout: CemeteryLayout): Pond[] {
  const count = Math.max(
    layout.plotDepth >= MIN_DEPTH_FOR_POND ? 1 : 0,
    Math.floor(layout.chunkCount / CHUNKS_PER_POND),
  );
  if (count === 0) return [];
  const rand = seededRandom(hashSeed(`${companyId}:ponds`));
  const halfWidth = layout.plotWidth / 2 - MARGIN_FROM_WALL;
  const ponds: Pond[] = [];

  for (let i = 0; i < count; i++) {
    const zLo = (i / count) * layout.plotDepth;
    const zHi = ((i + 1) / count) * layout.plotDepth;
    for (let attempt = 0; attempt < POND_CANDIDATES; attempt++) {
      const radius = POND_RADIUS_MIN + rand() * POND_RADIUS_RANGE;
      const x = (rand() * 2 - 1) * (halfWidth - radius);
      const z = zLo + rand() * (zHi - zLo);
      if (distanceToPath(layout.pathSegments, x, z) < radius + POND_BANK) continue;
      if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < p.radius + radius + POND_BANK)) continue;
      ponds.push({ x, z, radius });
      break;
    }
  }
  return ponds;
}

/** [0,1] — 0 dans et autour d'un étang (terrain aplani), 1 hors d'influence. */
export function pondRelief(localX: number, localZ: number, ponds: readonly Pond[]): number {
  let factor = 1;
  for (const p of ponds) {
    const d = Math.hypot(localX - p.x, localZ - p.z);
    factor = Math.min(factor, smoothstep(p.radius, p.radius + POND_FLAT_MARGIN, d));
  }
  return factor;
}

/** Profondeur creusée au point (m, ≥ 0) : cuvette arrondie, nulle au bord. */
export function pondDepth(localX: number, localZ: number, ponds: readonly Pond[]): number {
  let depth = 0;
  for (const p of ponds) {
    const d = Math.hypot(localX - p.x, localZ - p.z);
    if (d >= p.radius) continue;
    // Profil en cosinus surélevé : fond large, berge qui se redresse en douceur.
    depth = Math.max(depth, POND_DEPTH * (0.5 + 0.5 * Math.cos((d / p.radius) * Math.PI)));
  }
  return depth;
}

/** Étangs d'une tranche [zStart, zEnd[ — bord compris, pour que la nappe d'un
 *  étang à cheval sur deux tranches soit posée par les deux (jamais oubliée). */
export function pondsInRange(ponds: readonly Pond[], zStart: number, zEnd: number): Pond[] {
  return ponds.filter((p) => p.z + p.radius >= zStart && p.z - p.radius <= zEnd);
}

/**
 * Nappes d'eau posées à `WATER_LEVEL`. `toWorldPoint` convertit du repère local
 * du cimetière vers le monde (cf. worldLayout.ts:toWorld).
 */
export function buildPondWater(
  ponds: readonly Pond[], toWorldPoint: (x: number, z: number) => { x: number; z: number },
): THREE.Group {
  const group = new THREE.Group();
  if (!ponds.length) return group;
  const mat = new THREE.MeshStandardMaterial({
    color: WATER_COLOR,
    roughness: WATER_ROUGHNESS,
    metalness: WATER_METALNESS,
    transparent: true,
    opacity: WATER_OPACITY,
  });
  for (const p of ponds) {
    const geo = new THREE.CircleGeometry(p.radius, WATER_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    const { x, z } = toWorldPoint(p.x, p.z);
    mesh.position.set(x, WATER_LEVEL, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
