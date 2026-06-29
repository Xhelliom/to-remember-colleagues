// Plan procédural et DÉTERMINISTE du MONDE continu (évolution de l'issue #5) :
// une allée qui serpente, bordée des cimetières accrochés perpendiculairement.
// Plus de mode « hub » séparé : on marche sur la route et on entre « à vue ».
// Logique PURE (pas de Three.js) → testable seule ; world.ts en fait des maillages.
import { cemeteryLayout } from "./procedural.ts";

const STATION_STEP = 26; // pas en Z entre deux cimetières le long de l'allée
const MEANDER_AMP = 14; // amplitude du serpentement en X (zone de transition « forêt »)
const MEANDER_FREQ = 0.7; // radians de virage par station
export const ROAD_HALF = 3; // demi-largeur de la route
const PLOT_GAP = 4; // espace entre le bord de route et la parcelle
const ENTRANCE_GAP = 1; // recul de l'arche par rapport au bord de route
const START_Z = 8; // station de spawn, devant la première entrée
const WORLD_MARGIN = 12; // marge des bornes du monde autour des parcelles

export type Vec2 = { x: number; z: number };
export type WorldSlot = {
  id: string;
  /** Point de l'arche d'entrée, au bord de la route. */
  entrance: Vec2;
  /** Centre de la parcelle du cimetière (hors de la route). */
  plotCenter: Vec2;
  plotHalf: number;
  /** Orientation faisant face à la route (arche + rangées de tombes). */
  rotY: number;
};
export type WorldLayout = {
  /** Polyligne de l'axe de la route (station 0..count+1). */
  centerline: Vec2[];
  slots: WorldSlot[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Position de spawn par défaut (station 0). */
  start: Vec2;
};

/** Point de l'axe de la route à la station `i` (serpentement déterministe). */
function station(i: number): Vec2 {
  return { x: MEANDER_AMP * Math.sin(i * MEANDER_FREQ), z: START_Z - i * STATION_STEP };
}

/** Construit le plan du monde à partir des cimetières (id + nombre de tombes). */
export function worldLayout(companies: { id: string; graveCount: number }[]): WorldLayout {
  const n = companies.length;
  // Station 0 = spawn ; cimetière k à la station k+1 ; +1 station tampon en fin de route.
  const centerline: Vec2[] = [];
  for (let i = 0; i <= n + 1; i++) centerline.push(station(i));

  const slots: WorldSlot[] = [];
  let minX = -ROAD_HALF;
  let maxX = ROAD_HALF;

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
    const plotHalf = cemeteryLayout(c.id, c.graveCount).plotHalf;

    const off = (d: number): Vec2 => ({ x: p.x + nx * side * d, z: p.z + nz * side * d });
    const entrance = off(ROAD_HALF + ENTRANCE_GAP);
    const plotCenter = off(ROAD_HALF + PLOT_GAP + plotHalf);
    // L'arche et les rangées font face à la route (direction -normale*côté).
    const rotY = Math.atan2(-nx * side, -nz * side);

    slots.push({ id: c.id, entrance, plotCenter, plotHalf, rotY });
    minX = Math.min(minX, plotCenter.x - plotHalf);
    maxX = Math.max(maxX, plotCenter.x + plotHalf);
  });

  const last = station(n + 1);
  return {
    centerline,
    slots,
    bounds: {
      minX: minX - WORLD_MARGIN,
      maxX: maxX + WORLD_MARGIN,
      minZ: last.z - WORLD_MARGIN,
      maxZ: START_Z + WORLD_MARGIN,
    },
    start: station(0),
  };
}
