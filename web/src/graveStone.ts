// Stèle procédurale usée/fissurée/moussue (issue #25 — cœur thématique). Réutilise le
// même système d'altération que les rochers de décor (`scene/stone.ts`, mission 06) :
// une stèle n'est qu'une "pierre" plate soumise au même champ de bruit baké, mais avec
// un profil (silhouette) de tombe et une palette pilotées par les 3 axes de `graveAxes.ts`.
//
// `maintenance` bas → plus de fractures (seuil de fissure abaissé) et plus de mousse
// (les creux exposés accueillent davantage de lichen) ; `vote` (hanté ↔ paradisiaque)
// décale la teinte et l'intensité des fissures. `age` accentue le grain/l'affaissement,
// indépendamment des deux autres axes (voir graveAxes.ts).
import * as THREE from "three";
import type { GraveAxes } from "./graveAxes.ts";
import { crackThreshold, sampleWeathering, type WeatheringParams } from "./scene/stone.ts";
import { dressingFor, type Dressing } from "./scene/dressing.ts";

// Ré-export pratique : `e2e/gravestone.spec.ts` rend une stèle dans un canvas isolé
// (sans passer par main.ts/l'auth/la DB) et a besoin de la MÊME instance de `three`
// que celle utilisée ici (Vite résout "three" vers un chemin de dépendances
// pré-bundlées versionné — le ré-exporter évite d'en importer une seconde copie).
export * as THREE from "three";

// --- Silhouette de stèle (arrondie ou droite) — même profil que graves.ts (hw=0.5,
// hauteur=1), dupliqué à dessein plutôt qu'importé : `graves.ts` câble ce module en
// retour (voir "CABLER" du plan), importer dans l'autre sens créerait un cycle. ---
const STELE_HALF_WIDTH = 0.5;
const STELE_UNIT_HEIGHT = 1;
const STELE_SHOULDER = 0.7; // hauteur (fraction) où débute l'arrondi du sommet
const STELE_DEPTH = 0.18;
const EXTRUDE_CURVE_SEGMENTS = 6; // limite le tri-count par stèle (budget perf)

function steleShape(rounded: boolean): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-STELE_HALF_WIDTH, 0);
  shape.lineTo(-STELE_HALF_WIDTH, STELE_SHOULDER);
  if (rounded) {
    shape.quadraticCurveTo(-STELE_HALF_WIDTH, STELE_UNIT_HEIGHT, 0, STELE_UNIT_HEIGHT);
    shape.quadraticCurveTo(STELE_HALF_WIDTH, STELE_UNIT_HEIGHT, STELE_HALF_WIDTH, STELE_SHOULDER);
  } else {
    shape.lineTo(-STELE_HALF_WIDTH, STELE_UNIT_HEIGHT);
    shape.lineTo(STELE_HALF_WIDTH, STELE_UNIT_HEIGHT);
  }
  shape.lineTo(STELE_HALF_WIDTH, 0);
  shape.lineTo(-STELE_HALF_WIDTH, 0);
  return shape;
}

function makeSteleGeometry(rounded: boolean): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(steleShape(rounded), {
    depth: STELE_DEPTH,
    bevelEnabled: false,
    curveSegments: EXTRUDE_CURVE_SEGMENTS,
  });
  geo.translate(0, 0, -STELE_DEPTH / 2);
  geo.computeVertexNormals();
  return geo;
}

// --- Dérivation des paramètres d'altération depuis les 3 axes ---
const CRACK_INTENSITY_MIN = 0.08; // impeccable : presque aucune fissure
const CRACK_INTENSITY_MAX = 0.85; // à l'abandon : très fissurée
const HAUNT_CRACK_BONUS = 0.12; // hanté : légèrement plus lézardée
const BLESS_CRACK_RELIEF = 0.06; // paradisiaque : légèrement plus lisse
const WARP_BASE = 0.01;
const WARP_AGE_RANGE = 0.05; // affaissement : la pierre gondole avec l'âge
const STRATA_COUNT = 5;
const STRATA_TILT = 0.6;
const STRATA_AMPLITUDE_BASE = 0.004;
const CRACK_DEPTH = 0.05;
const GRAIN_BASE = 0.006;
const GRAIN_AGE_RANGE = 0.014; // grain plus marqué en vieillissant (érosion)
const HUE_HAUNT_SHIFT = -0.12; // décalage teinte froid/violacé
const HUE_BLESS_SHIFT = 0.08; // décalage teinte chaud/doré

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Dérive les paramètres du champ d'altération (forme) + le décalage de teinte à partir
 *  des 3 axes — pure, testable seule (déterminisme, monotonie, votes extrêmes). */
export function weatheringParamsFromAxes(axes: GraveAxes): { params: WeatheringParams; hueBias: number } {
  const neglect = 1 - axes.maintenance; // 0 = impeccable, 1 = à l'abandon
  const haunt = Math.max(0, -axes.vote);
  const bless = Math.max(0, axes.vote);
  const crackIntensity = clamp01(
    CRACK_INTENSITY_MIN + (CRACK_INTENSITY_MAX - CRACK_INTENSITY_MIN) * neglect
      + HAUNT_CRACK_BONUS * haunt - BLESS_CRACK_RELIEF * bless,
  );
  const params: WeatheringParams = {
    warpAmplitude: WARP_BASE + WARP_AGE_RANGE * axes.age,
    strataCount: STRATA_COUNT,
    strataTilt: STRATA_TILT,
    strataAmplitude: STRATA_AMPLITUDE_BASE * (1 + axes.age),
    crackIntensity,
    crackDepth: CRACK_DEPTH,
    grainAmplitude: GRAIN_BASE + GRAIN_AGE_RANGE * axes.age,
  };
  return { params, hueBias: HUE_HAUNT_SHIFT * haunt + HUE_BLESS_SHIFT * bless };
}

const STELE_HUE_BASE = 0.1;
const STELE_HUE_RANGE = 0.03;
const STELE_SATURATION = 0.14;
const STELE_LIGHTNESS_MIN = 0.32;
const STELE_LIGHTNESS_RANGE = 0.24;

// --- Habillage (mousse/lichen/coulures, mission 07) — pilote la couleur, pas
// de géométrie supplémentaire. `upness` = hauteur normalisée sur la stèle
// (`v`, ci-dessous : base ombragée → sommet exposé), `cavity` = `cavityAO`
// déjà produit par `sampleWeathering`. Rend l'entretien ET le karma (votes)
// lisibles d'un coup d'œil, sans jamais masquer totalement la pierre dessous. ---
const DRESSING_MOSS_COLOR = 0x4f6b34; // vert mousse, creux ombragés
const DRESSING_LICHEN_COLOR = 0xb7c48a; // lichen pâle, faces exposées
const DRESSING_STREAK_COLOR = 0x241f19; // coulures sombres (eau stagnante)
const DRESSING_MAX_BLEND = 0.75; // jamais à 100% : la pierre reste visible dessous
const STREAK_MAX_BLEND = 0.4; // coulures plus discrètes que mousse/lichen

/** Blende l'habillage (mousse/lichen/coulures) dans `color`, in place — la
 *  teinte de chaque couche est décalée par `dressing.hueBias` (karma). */
function applyDressing(color: THREE.Color, dressing: Dressing): void {
  if (dressing.mossIntensity > 0) {
    const moss = new THREE.Color(DRESSING_MOSS_COLOR).offsetHSL(dressing.hueBias, 0, 0);
    color.lerp(moss, dressing.mossIntensity * DRESSING_MAX_BLEND);
  }
  if (dressing.lichenIntensity > 0) {
    const lichen = new THREE.Color(DRESSING_LICHEN_COLOR).offsetHSL(dressing.hueBias, 0, 0);
    color.lerp(lichen, dressing.lichenIntensity * DRESSING_MAX_BLEND);
  }
  if (dressing.streakIntensity > 0) {
    const streak = new THREE.Color(DRESSING_STREAK_COLOR).offsetHSL(dressing.hueBias, 0, 0);
    color.lerp(streak, dressing.streakIntensity * STREAK_MAX_BLEND);
  }
}

export type Gravestone = {
  /** Géométrie unitaire (hw=0.5, hauteur=1) — à mettre à l'échelle par mesh, comme
   *  les géométries partagées de graves.ts (`mesh.scale.set(width, height, 1)`). */
  geometry: THREE.BufferGeometry;
  /** Nombre de sommets dont la crête de fissure dépasse le seuil — mesure sur le champ. */
  fractureCount: number;
  /** Moyenne du potentiel de mousse pondérée par le négligé (0 si impeccable). */
  mossOpennessAvg: number;
  /** Décalage de teinte appliqué (hanté ↔ paradisiaque), pour compo matériau côté appelant. */
  hueBias: number;
};

/**
 * Construit la stèle d'une tombe : silhouette classique (arrondie ou droite) déplacée
 * par le même champ d'altération que `buildRock` (mission 06), piloté par les 3 axes
 * (`GraveAxes`). Déterministe : mêmes (axes, seed) → géométrie et métriques identiques.
 */
export function buildGravestone(axes: GraveAxes, seed: number, rounded = true): Gravestone {
  const { params, hueBias } = weatheringParamsFromAxes(axes);
  const geometry = makeSteleGeometry(rounded);
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const threshold = crackThreshold(params.crackIntensity);
  const color = new THREE.Color();
  let mossSum = 0;
  let fractureCount = 0;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = x / (STELE_HALF_WIDTH * 2) + 0.5;
    const v = y / STELE_UNIT_HEIGHT;
    const s = sampleWeathering(u, v, seed, params);

    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    pos.setXYZ(i, x + nx * s.displacement, y + ny * s.displacement, z + nz * s.displacement);

    const lightness = STELE_LIGHTNESS_MIN + (1 - s.cavityAO) * STELE_LIGHTNESS_RANGE;
    color.setHSL(STELE_HUE_BASE + hueBias + s.hue * STELE_HUE_RANGE, STELE_SATURATION, lightness);
    applyDressing(color, dressingFor({ upness: v, cavity: s.cavityAO, maintenance: axes.maintenance, votes: axes.vote }));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    mossSum += s.mossOpenness;
    if (s.crackStrength > threshold) fractureCount++;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return {
    geometry,
    fractureCount,
    // Champ de mousse intrinsèque (indépendant des axes) × négligé : garantit la
    // monotonie (maintenance ↓ ⇒ mossOpennessAvg ↑) quelle que soit la graine.
    mossOpennessAvg: (mossSum / count) * (1 - axes.maintenance),
    hueBias,
  };
}
