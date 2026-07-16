// Construction des maillages du MONDE continu à partir du plan pur de
// worldLayout.ts : ruban de route sinueuse, arches d'entrée, et forêt comblant
// les intervalles (zone de transition « invisible », occluder pour le futur
// streaming par chunks).
import * as THREE from "three";
import type { Company } from "./types.ts";
import type { Ambiance } from "./ambiance.ts";
import { worldLayout, distanceToSlot, smoothCenterline, ROAD_HALF, type Vec2, type WorldSlot } from "./worldLayout.ts";
import { buildEntranceArch } from "./hub.ts";
import { buildRoad } from "./scene/road.ts";
import { buildRoadLanterns } from "./scene/roadLanterns.ts";
import { worldGroundHeightAt } from "./scene/worldGround.ts";
import { hashSeed } from "./procedural.ts";
import { TreeLodField, type TreePlacement } from "./scene/trees/treeLod.ts";
import { seededRandom } from "./graves.ts";

const ROAD_CURVE_SAMPLES_PER_SEG = 8; // finesse du lissage Catmull-Rom entre deux stations
const FOREST_SEED = 0xf0e571; // graine fixe → forêt déterministe
const TREES_PER_CEMETERY = 14; // densité bornée (∝ contenu, pas à l'aire du monde)
const FOREST_CLEARANCE = 2.5; // distance minimale aux bords de route et de parcelle
// Unifiée sur la chaîne LOD procédurale (2.3, plan REVUE_AMELIORATIONS_RENDU_PARCOURS.md) :
// à cette distance de la route, la quasi-totalité de ces arbres sont en impostor
// (2 triangles) — coût marginal pour un gain de cohérence de style avec les
// arbres procéduraux des cimetières (fini la rupture tronc-cylindre/icosaèdre).
const FOREST_TREE_SCALE_MIN = 0.8;
const FOREST_TREE_SCALE_RANGE = 0.6;

export type WorldSlotWithCompany = WorldSlot & { company: Company };
export type World = {
  group: THREE.Group;
  slots: WorldSlotWithCompany[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  start: Vec2;
  /** Polyligne LISSÉE de l'axe (worldLayout.ts:smoothCenterline) — réutilisée
   *  par cemetery.ts pour le relief du sol extérieur (worldGround.ts). */
  roadPoints: Vec2[];
  /** Chaîne LOD de la forêt de transition — l'appelant doit appeler `.update()`
   *  chaque frame (comme `chunk.veg.treeLod`, cf. worldStreamer.ts) et `.dispose()`
   *  explicitement à la fermeture du monde (pas via un simple disposeObject
   *  générique, cf. treeLod.ts:dispose — gère aussi les pools de cartes). */
  forestTreeLod: TreeLodField | null;
};

/** Distance d'un point au segment [a,b] dans le plan XZ. */
function distToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** `roadPoints` doit être la polyligne LISSÉE (smoothCenterline) — sinon un arbre
 *  peut se retrouver trop près de la route réelle dans un virage (la corde
 *  d'origine coupe au plus court, la courbe s'en écarte). */
function nearRoad(x: number, z: number, roadPoints: readonly Vec2[]): boolean {
  for (let i = 0; i < roadPoints.length - 1; i++) {
    if (distToSegment(x, z, roadPoints[i], roadPoints[i + 1]) < ROAD_HALF + FOREST_CLEARANCE) return true;
  }
  return false;
}

function insidePlot(x: number, z: number, slots: WorldSlot[]): boolean {
  // Emprise RÉELLE (rectangle largeur × longueur) : un cercle englobant de rayon
  // max(w,d)/2 sur-excluait massivement la forêt autour d'un cimetière allongé.
  return slots.some((s) => distanceToSlot(s, { x, z }) < FOREST_CLEARANCE);
}

/** Emplacements de la forêt de transition comblant les intervalles entre route
 *  et parcelles (déterministe, bornée) — même chaîne LOD procédurale que les
 *  arbres des cimetières (2.3). `roadPoints` : polyligne LISSÉE, cf. `nearRoad`.
 *  La hauteur repose sur `worldGroundHeightAt`, la MÊME source que le sol
 *  extérieur (worldGround.ts) : pas de flottement. */
function buildForestPlacements(roadPoints: readonly Vec2[], slots: WorldSlot[], bounds: World["bounds"]): TreePlacement[] {
  const rand = seededRandom(FOREST_SEED);
  const target = Math.max(slots.length, 1) * TREES_PER_CEMETERY;
  const placements: TreePlacement[] = [];
  for (let tries = 0; placements.length < target && tries < target * 8; tries++) {
    const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ);
    if (nearRoad(x, z, roadPoints) || insidePlot(x, z, slots)) continue;
    placements.push({
      x, z, y: worldGroundHeightAt(x, z, roadPoints, slots),
      yaw: rand() * Math.PI * 2,
      scale: FOREST_TREE_SCALE_MIN + rand() * FOREST_TREE_SCALE_RANGE,
      seed: hashSeed(`world:forest:${placements.length}`),
    });
  }
  return placements;
}

/** Assemble le monde complet (route + arches + forêt) prêt à être ajouté à la scène.
 *  `renderer` : requis par la chaîne LOD procédurale de la forêt (capture des
 *  cartes/impostors au premier appel, ensuite mise en cache — cf. treeLod.ts). */
export function buildWorld(companies: Company[], ambiance: Ambiance, renderer: THREE.WebGLRenderer): World {
  const layout = worldLayout(companies.map((c) => ({ id: c.id, graveCount: c.graveCount })));
  const byId = new Map(companies.map((c) => [c.id, c]));
  const group = new THREE.Group();

  const roadPoints = smoothCenterline(layout.centerline, ROAD_CURVE_SAMPLES_PER_SEG);
  group.add(buildRoad(roadPoints, layout.slots, ambiance.grassColor));
  group.add(buildRoadLanterns(roadPoints));

  const forestPlacements = buildForestPlacements(roadPoints, layout.slots, layout.bounds);
  const forestTreeLod = forestPlacements.length > 0 ? TreeLodField.create(FOREST_SEED, forestPlacements, renderer) : null;
  if (forestTreeLod) group.add(forestTreeLod.group);

  const slots: WorldSlotWithCompany[] = [];
  for (const slot of layout.slots) {
    const company = byId.get(slot.id)!;
    // +π : `rotY` donne la direction du chemin (s'éloigne de la route),
    // l'arche doit au contraire faire face à la route pour accueillir le visiteur.
    const arch = buildEntranceArch(company, slot.rotY + Math.PI);
    arch.position.set(slot.entrance.x, 0, slot.entrance.z);
    group.add(arch);
    // Clôture : construite par tranche (chunk), au tracé réel du chemin — voir
    // scene/fence.ts, appelé depuis cemetery.ts au chargement de chaque chunk.

    slots.push({ ...slot, company });
  }

  return { group, slots, bounds: layout.bounds, start: layout.start, roadPoints, forestTreeLod };
}
