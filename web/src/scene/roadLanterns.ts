// Lanternes/bornes le long de la route commune (chantier 2.2, « habiller le
// chemin commun ») : InstancedMesh (pôle + tête émissive), posées en
// alternance de chaque côté à intervalle régulier. Seules quelques-unes, les
// plus proches du spawn, portent une VRAIE PointLight (budget) — ailleurs,
// l'émissif + le bloom sélectif (2.5) suffisent à les faire ressortir de nuit.
import * as THREE from "three";
import { ROAD_HALF, type Vec2 } from "../worldLayout.ts";

const LANTERN_SPACING_M = 16; // m entre deux lanternes le long de la spline
const LANTERN_OFFSET = ROAD_HALF + 0.6; // juste au bord de la route, hors piste piétonne
const POLE_HEIGHT = 1.3;
const POLE_RADIUS_BASE = 0.05;
const POLE_RADIUS_TOP_RATIO = 0.6;
const POLE_RADIAL_SEGMENTS = 6;
const LAMP_RADIUS = 0.14;
const LAMP_DETAIL = 1; // icosphère peu subdivisée — coût marginal, cf. cloudFoliage.ts
const POLE_COLOR = 0x2e2a26;
const LAMP_COLOR = 0xffdca0;
const LAMP_EMISSIVE_INTENSITY = 1.4;
const LIT_LANTERN_COUNT = 4; // PointLight réelles, uniquement les plus proches du spawn (début de `points`)
const POINT_LIGHT_INTENSITY = 3;
const POINT_LIGHT_DISTANCE = 12;
const POINT_LIGHT_HEIGHT = POLE_HEIGHT + 0.1;

export type LanternPlacement = { readonly x: number; readonly z: number; readonly side: 1 | -1 };

/**
 * Positions le long de `points` (polyligne déjà lissée, cf. worldLayout.ts:
 * smoothCenterline) espacées de `LANTERN_SPACING_M` en distance CURVILIGNE
 * (pas en nombre de points), alternant de chaque côté de la route. Pur,
 * testable : mêmes points → mêmes placements.
 */
export function lanternPlacements(points: readonly Vec2[]): LanternPlacement[] {
  if (points.length < 2) return [];
  const placements: LanternPlacement[] = [];
  let sinceLast = LANTERN_SPACING_M; // pose une lanterne dès le début du tracé
  let side: 1 | -1 = 1;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sinceLast += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    if (sinceLast < LANTERN_SPACING_M) continue;
    sinceLast = 0;
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    const nx = tz / tl;
    const nz = -tx / tl;
    const p = points[i];
    placements.push({ x: p.x + nx * LANTERN_OFFSET * side, z: p.z + nz * LANTERN_OFFSET * side, side });
    side = side === 1 ? -1 : 1;
  }
  return placements;
}

function buildPoleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    POLE_RADIUS_BASE * POLE_RADIUS_TOP_RATIO, POLE_RADIUS_BASE, POLE_HEIGHT, POLE_RADIAL_SEGMENTS,
  );
  geo.translate(0, POLE_HEIGHT / 2, 0); // base au sol plutôt que centrée à l'origine
  return geo;
}

function buildLampGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(LAMP_RADIUS, LAMP_DETAIL);
  geo.translate(0, POLE_HEIGHT, 0); // posée au sommet du pôle
  return geo;
}

/** Construit les lanternes de la route (2 InstancedMesh : pôle + tête, mêmes
 *  transformées) + quelques PointLight réelles près du spawn. Géométries/
 *  matériaux libérés génériquement avec le reste de `World.group`
 *  (disposeObject, cf. cemetery.ts:clearWorld) — pas de dispose() dédié. */
export function buildRoadLanterns(points: readonly Vec2[]): THREE.Group {
  const placements = lanternPlacements(points);
  const group = new THREE.Group();
  const count = placements.length;
  if (count === 0) return group;

  const poleGeo = buildPoleGeometry();
  const poleMat = new THREE.MeshStandardMaterial({ color: POLE_COLOR, roughness: 0.8 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
  poles.castShadow = true;

  const lampGeo = buildLampGeometry();
  const lampMat = new THREE.MeshStandardMaterial({
    color: LAMP_COLOR, emissive: LAMP_COLOR, emissiveIntensity: LAMP_EMISSIVE_INTENSITY, roughness: 0.4,
  });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);

  const dummy = new THREE.Object3D();
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    lamps.setMatrixAt(i, dummy.matrix);
    // Budget : seules les lanternes les plus proches du spawn (début de `points`,
    // donc de `placements`) portent une vraie source de lumière temps réel.
    if (i < LIT_LANTERN_COUNT) {
      const light = new THREE.PointLight(LAMP_COLOR, POINT_LIGHT_INTENSITY, POINT_LIGHT_DISTANCE);
      light.position.set(p.x, POINT_LIGHT_HEIGHT, p.z);
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
