// Construction des maillages du MONDE continu à partir du plan pur de
// worldLayout.ts : ruban de route sinueuse, arches d'entrée, et forêt comblant
// les intervalles (zone de transition « invisible », occluder pour le futur
// streaming par chunks).
import * as THREE from "three";
import type { Company } from "./types.ts";
import type { Ambiance } from "./ambiance.ts";
import { worldLayout, plotReach, ROAD_HALF, type Vec2, type WorldSlot } from "./worldLayout.ts";
import { buildEntranceArch } from "./hub.ts";
import { makeTree } from "./scene/decor.ts";
import { seededRandom } from "./graves.ts";

const ROAD_Y = 0.02; // léger décollement du sol pour éviter le z-fighting
const ROAD_SAMPLES_PER_SEG = 6; // finesse du ruban entre deux stations
const ROAD_COLOR = 0x55504a;
const FOREST_SEED = 0xf0e571; // graine fixe → forêt déterministe
const TREES_PER_CEMETERY = 14; // densité bornée (∝ contenu, pas à l'aire du monde)
const FOREST_CLEARANCE = 2.5; // distance minimale aux bords de route et de parcelle
const TRUNK_COLOR = 0x3a2a1e;

export type WorldSlotWithCompany = WorldSlot & { company: Company };
export type World = {
  group: THREE.Group;
  slots: WorldSlotWithCompany[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  start: Vec2;
};

/** Échantillonne la polyligne de l'axe (interpolation linéaire entre stations). */
function sampleCenterline(centerline: Vec2[]): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < centerline.length - 1; i++) {
    const a = centerline[i];
    const b = centerline[i + 1];
    for (let s = 0; s < ROAD_SAMPLES_PER_SEG; s++) {
      const t = s / ROAD_SAMPLES_PER_SEG;
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  pts.push(centerline[centerline.length - 1]);
  return pts;
}

/** Ruban de route : deux bords décalés ±ROAD_HALF le long de l'axe échantillonné. */
function buildRoad(centerline: Vec2[]): THREE.Mesh {
  const pts = sampleCenterline(centerline);
  const m = pts.length;
  const positions = new Float32Array(m * 2 * 3);
  for (let i = 0; i < m; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(m - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    const p = pts[i];
    positions.set([p.x - nx * ROAD_HALF, ROAD_Y, p.z - nz * ROAD_HALF], i * 6);
    positions.set([p.x + nx * ROAD_HALF, ROAD_Y, p.z + nz * ROAD_HALF], i * 6 + 3);
  }
  const idx: number[] = [];
  for (let i = 0; i < m - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 1 }));
  road.receiveShadow = true;
  return road;
}

/** Distance d'un point au segment [a,b] dans le plan XZ. */
function distToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function nearRoad(x: number, z: number, centerline: Vec2[]): boolean {
  for (let i = 0; i < centerline.length - 1; i++) {
    if (distToSegment(x, z, centerline[i], centerline[i + 1]) < ROAD_HALF + FOREST_CLEARANCE) return true;
  }
  return false;
}

function insidePlot(x: number, z: number, slots: WorldSlot[]): boolean {
  // ponytail: cercle englobant le rectangle (largeur × longueur), imprécis
  // aux coins — comme avant le chunking, suffisant pour exclure la forêt.
  return slots.some((s) => Math.hypot(x - s.plotCenter.x, z - s.plotCenter.z) < plotReach(s) + FOREST_CLEARANCE);
}

/** Forêt comblant les intervalles entre route et parcelles (déterministe, bornée). */
function buildForest(
  centerline: Vec2[],
  slots: WorldSlot[],
  bounds: World["bounds"],
  a: Ambiance,
): THREE.Group {
  const g = new THREE.Group();
  const rand = seededRandom(FOREST_SEED);
  const bare = a.scary || a.seasonKey === "winter";
  const trunkMat = new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 1 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: a.foliageColor, roughness: 1 });
  const target = Math.max(slots.length, 1) * TREES_PER_CEMETERY;
  let placed = 0;
  for (let tries = 0; placed < target && tries < target * 8; tries++) {
    const x = bounds.minX + rand() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rand() * (bounds.maxZ - bounds.minZ);
    if (nearRoad(x, z, centerline) || insidePlot(x, z, slots)) continue;
    const tree = makeTree(trunkMat, foliageMat, bare, rand);
    tree.position.set(x, 0, z);
    tree.rotation.y = rand() * Math.PI * 2;
    g.add(tree);
    placed++;
  }
  return g;
}

/** Assemble le monde complet (route + arches + forêt) prêt à être ajouté à la scène. */
export function buildWorld(companies: Company[], ambiance: Ambiance): World {
  const layout = worldLayout(companies.map((c) => ({ id: c.id, graveCount: c.graveCount })));
  const byId = new Map(companies.map((c) => [c.id, c]));
  const group = new THREE.Group();

  group.add(buildRoad(layout.centerline));
  group.add(buildForest(layout.centerline, layout.slots, layout.bounds, ambiance));

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

  return { group, slots, bounds: layout.bounds, start: layout.start };
}
