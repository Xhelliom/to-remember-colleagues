// Lanternes et lampadaires : bornes basses le long de la route commune
// (chantier 2.2), lampadaires plus hauts le long de l'allée des cimetières.
// Un InstancedMesh pour les pôles, un pour les têtes émissives, posés en
// alternance de chaque côté à intervalle régulier. Seules quelques-unes portent
// une VRAIE PointLight (budget) — ailleurs, l'émissif et le bloom sélectif
// (2.5) suffisent à les faire ressortir de nuit.
import * as THREE from "three";
import { ROAD_HALF, type Vec2 } from "../worldLayout.ts";

const POLE_RADIUS_BASE_RATIO = 0.038; // rayon au pied, en fraction de la hauteur
const POLE_RADIUS_TOP_RATIO = 0.6;    // effilement vers le sommet
const POLE_RADIAL_SEGMENTS = 6;
const LAMP_RADIUS_RATIO = 0.108;      // tête, en fraction de la hauteur
const LAMP_DETAIL = 1; // icosphère peu subdivisée — coût marginal, cf. cloudFoliage.ts
const POLE_COLOR = 0x2e2a26;
const LAMP_COLOR = 0xffdca0;
const LAMP_EMISSIVE_INTENSITY = 1.4;
const POINT_LIGHT_DISTANCE_RATIO = 9; // portée de la source, en fraction de la hauteur

/** Réglages d'une ligne de lanternes. */
export type LanternOptions = {
  /** Écart latéral par rapport à l'axe suivi (m). */
  offset: number;
  /** Distance curviligne entre deux lanternes (m). */
  spacing: number;
  /** Hauteur du pôle (m) — la tête se pose à son sommet. */
  poleHeight: number;
  /** Combien portent une vraie source de lumière (les premières de la liste). */
  litCount: number;
  /** Intensité de ces sources ; 0 pour les éteindre en plein jour. */
  lightIntensity: number;
  /** Hauteur du sol au point donné — sans elle, tout est posé à y = 0. */
  groundY: (x: number, z: number) => number;
};

const ROAD_LANTERNS: LanternOptions = {
  offset: ROAD_HALF + 0.6, // juste au bord de la route, hors piste piétonne
  spacing: 16,
  poleHeight: 1.3,
  litCount: 4, // uniquement les plus proches du spawn (début de `points`)
  lightIntensity: 3,
  groundY: () => 0,
};

export type LanternPlacement = { readonly x: number; readonly z: number; readonly side: 1 | -1 };

/**
 * Positions le long de `points` (polyligne déjà lissée, cf. worldLayout.ts:
 * smoothCenterline) espacées de `spacing` en distance CURVILIGNE (pas en
 * nombre de points), alternant de chaque côté de l'axe. Pur, testable :
 * mêmes points → mêmes placements.
 */
export function lanternPlacements(points: readonly Vec2[], spacing = ROAD_LANTERNS.spacing, offset = ROAD_LANTERNS.offset): LanternPlacement[] {
  if (points.length < 2) return [];
  const placements: LanternPlacement[] = [];
  let sinceLast = spacing; // pose une lanterne dès le début du tracé
  let side: 1 | -1 = 1;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sinceLast += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (sinceLast < spacing) continue;
    sinceLast = 0;
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    const p = points[i];
    placements.push({ x: p.x + nx * offset * side, z: p.z + nz * offset * side, side });
    side = side === 1 ? -1 : 1;
  }
  return placements;
}

function buildPoleGeometry(height: number): THREE.BufferGeometry {
  const radius = height * POLE_RADIUS_BASE_RATIO;
  const geo = new THREE.CylinderGeometry(radius * POLE_RADIUS_TOP_RATIO, radius, height, POLE_RADIAL_SEGMENTS);
  geo.translate(0, height / 2, 0); // base au sol plutôt que centrée à l'origine
  return geo;
}

function buildLampGeometry(height: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(height * LAMP_RADIUS_RATIO, LAMP_DETAIL);
  geo.translate(0, height, 0); // posée au sommet du pôle
  return geo;
}

/**
 * Construit une ligne de lanternes le long de `points` (2 InstancedMesh : pôle
 * et tête) + quelques PointLight réelles. Géométries et matériaux sont libérés
 * génériquement avec le groupe parent (disposeObject).
 */
export function buildLanterns(points: readonly Vec2[], opts: Partial<LanternOptions> = {}): THREE.Group {
  const o = { ...ROAD_LANTERNS, ...opts };
  const placements = lanternPlacements(points, o.spacing, o.offset);
  const group = new THREE.Group();
  if (placements.length === 0) return group;

  const poles = new THREE.InstancedMesh(
    buildPoleGeometry(o.poleHeight),
    new THREE.MeshStandardMaterial({ color: POLE_COLOR, roughness: 0.8 }),
    placements.length,
  );
  poles.castShadow = true;

  const lamps = new THREE.InstancedMesh(
    buildLampGeometry(o.poleHeight),
    new THREE.MeshStandardMaterial({
      color: LAMP_COLOR, emissive: LAMP_COLOR, emissiveIntensity: LAMP_EMISSIVE_INTENSITY, roughness: 0.4,
    }),
    placements.length,
  );

  const dummy = new THREE.Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, o.groundY(p.x, p.z), p.z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    lamps.setMatrixAt(i, dummy.matrix);
    // Budget : seules les premières lanternes portent une source temps réel.
    if (i < o.litCount && o.lightIntensity > 0) {
      const light = new THREE.PointLight(LAMP_COLOR, o.lightIntensity, o.poleHeight * POINT_LIGHT_DISTANCE_RATIO);
      light.position.set(p.x, dummy.position.y + o.poleHeight, p.z);
      group.add(light);
    }
  });
  poles.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  lamps.computeBoundingSphere();
  group.add(poles, lamps);
  return group;
}

/** Bornes basses bordant la route commune. */
export function buildRoadLanterns(points: readonly Vec2[]): THREE.Group {
  return buildLanterns(points);
}
