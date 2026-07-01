// Plan procédural et DÉTERMINISTE du MONDE continu (évolution de l'issue #5) :
// une allée qui serpente, bordée des cimetières accrochés perpendiculairement.
// Plus de mode « hub » séparé : on marche sur la route et on entre « à vue ».
// Logique PURE (pas de Three.js) → testable seule ; world.ts en fait des maillages.
import { cemeteryLayout } from "./procedural.ts";

const MEANDER_AMP = 14; // amplitude du serpentement en X (zone de transition « forêt »)
const MEANDER_FREQ = 0.7; // radians de virage par station
export const ROAD_HALF = 3; // demi-largeur de la route
const ENTRANCE_GAP = 1; // recul de l'arche par rapport au bord de route
const START_Z = 8; // station de spawn, devant la première entrée
const WORLD_MARGIN = 12; // marge des bornes du monde autour des parcelles
const STATION_MARGIN = 6; // dégagement mini entre deux cimetières le long de la route

export type Vec2 = { x: number; z: number };
/**
 * Repère local minimal (origine + orientation) — un `WorldSlot` en est un.
 * `entrance` : point de l'arche, au bord de la route, origine du repère local
 * (z = 0 sur le chemin). `rotY` : orientation faisant face à la route.
 */
export type Frame = { entrance: Vec2; rotY: number };
export type WorldSlot = Frame & {
  id: string;
  /** Centre du rectangle de la parcelle (milieu du chemin). */
  plotCenter: Vec2;
  /** Largeur fixe du couloir (chemin + ramifications). */
  plotWidth: number;
  /** Longueur du chemin depuis l'entrée. */
  plotDepth: number;
};
export type WorldLayout = {
  /** Polyligne de l'axe de la route (station 0..count+1). */
  centerline: Vec2[];
  slots: WorldSlot[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Position de spawn par défaut (station 0). */
  start: Vec2;
};

/** Projette un point MONDE dans un repère local (origine = `frame.entrance`). */
export function toLocal(frame: Frame, p: Vec2): Vec2 {
  const dx = p.x - frame.entrance.x;
  const dz = p.z - frame.entrance.z;
  const cos = Math.cos(frame.rotY);
  const sin = Math.sin(frame.rotY);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

/** Point local → monde (transformée inverse de `toLocal`). */
export function toWorld(frame: Frame, lx: number, lz: number): Vec2 {
  const cos = Math.cos(frame.rotY);
  const sin = Math.sin(frame.rotY);
  return { x: frame.entrance.x + lx * cos + lz * sin, z: frame.entrance.z - lx * sin + lz * cos };
}

/** Les 4 coins du rectangle (largeur × longueur) d'un slot, en coordonnées monde. */
export function slotCorners(slot: WorldSlot): Vec2[] {
  const half = slot.plotWidth / 2;
  return [
    toWorld(slot, -half, 0),
    toWorld(slot, half, 0),
    toWorld(slot, -half, slot.plotDepth),
    toWorld(slot, half, slot.plotDepth),
  ];
}

/**
 * Distance d'un point MONDE au rectangle du slot (0 si à l'intérieur).
 * Contrairement à la distance au `plotCenter` (le milieu du chemin, qui peut
 * être à des centaines de mètres de l'entrée pour un chemin long), celle-ci
 * reste nulle n'importe où DANS l'emprise réelle — condition du chargement/
 * déchargement à l'approche pour un cimetière allongé.
 */
export function distanceToSlot(slot: WorldSlot, p: Vec2): number {
  const local = toLocal(slot, p);
  const half = slot.plotWidth / 2;
  const dx = Math.max(Math.abs(local.x) - half, 0);
  const dz = Math.max(-local.z, local.z - slot.plotDepth, 0);
  return Math.hypot(dx, dz);
}

/** Rayon englobant (temporaire, jusqu'au chunking réel de la phase 3). */
export function plotReach(slot: WorldSlot): number {
  return Math.max(slot.plotWidth, slot.plotDepth) / 2;
}

/** Construit le plan du monde à partir des cimetières (id + nombre de tombes). */
export function worldLayout(companies: { id: string; graveCount: number }[]): WorldLayout {
  const n = companies.length;
  const layouts = companies.map((c) => cemeteryLayout(c.id, c.graveCount));

  // Demi-largeur occupée le long de la route à chaque station (0 pour le
  // spawn et la station tampon, qui ne portent pas de cimetière).
  const halfWidthAt = (s: number): number => (s >= 1 && s <= n ? layouts[s - 1].plotWidth / 2 : 0);

  // Accumulation adaptative (2.2) : l'écart entre deux stations dépend des
  // demi-largeurs réelles de chaque côté, plus une marge fixe.
  const stationZ = [START_Z];
  for (let s = 1; s <= n + 1; s++) {
    stationZ.push(stationZ[s - 1] - (halfWidthAt(s - 1) + halfWidthAt(s) + STATION_MARGIN));
  }
  const station = (i: number): Vec2 => ({ x: MEANDER_AMP * Math.sin(i * MEANDER_FREQ), z: stationZ[i] });

  const centerline: Vec2[] = [];
  for (let i = 0; i <= n + 1; i++) centerline.push(station(i));

  const slots: WorldSlot[] = [];
  let minX = -ROAD_HALF;
  let maxX = ROAD_HALF;
  let minZ = stationZ[n + 1];
  let maxZ = START_Z;

  companies.forEach((c, k) => {
    const s = k + 1;
    const p = station(s);
    // Normale à la tangente (différence centrale) dans le plan XZ.
    const a = station(s - 1);
    const b = station(s + 1);
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tlen = Math.hypot(tx, tz) || 1;
    const nx = tz / tlen;
    const nz = -tx / tlen;
    const side = k % 2 === 0 ? -1 : 1; // alterne les côtés de la route
    const { plotWidth, plotDepth } = layouts[k];

    const off = (d: number): Vec2 => ({ x: p.x + nx * side * d, z: p.z + nz * side * d });
    const entrance = off(ROAD_HALF + ENTRANCE_GAP);
    // L'arche et le chemin font face à la route (direction -normale*côté).
    const rotY = Math.atan2(-nx * side, -nz * side);
    // Milieu du chemin — MÊME convention que `toWorld` (utilisée pour les
    // tombes, le terrain, la clôture), pas la direction de l'offset ci-dessus
    // qui est opposée (bug corrigé : plotCenter pointait vers la route).
    const plotCenter = toWorld({ entrance, rotY }, 0, plotDepth / 2);

    const slot: WorldSlot = { id: c.id, entrance, plotCenter, plotWidth, plotDepth, rotY };
    slots.push(slot);
    for (const corner of slotCorners(slot)) {
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minZ = Math.min(minZ, corner.z);
      maxZ = Math.max(maxZ, corner.z);
    }
  });

  return {
    centerline,
    slots,
    bounds: {
      minX: minX - WORLD_MARGIN,
      maxX: maxX + WORLD_MARGIN,
      minZ: minZ - WORLD_MARGIN,
      maxZ: maxZ + WORLD_MARGIN,
    },
    start: station(0),
  };
}
