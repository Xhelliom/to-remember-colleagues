// Bookmarks caméra nommés (`?shot=1..9`) + tour flythrough Catmull-Rom (`?shot=fly`) —
// double usage : QA déterministe (poses fixes reproductibles pour les e2e) ET visite
// guidée mémorielle (tour automatique du cimetière). Réutilise `THREE.CatmullRomCurve3`
// (dépendance déjà présente) plutôt que ré-écrire une spline maison.
//
// Module PUR (aucun effet de bord, pas de rendu) — testable sans WebGL, voir
// bookmarks.test.ts. `main.ts` consomme `parseShotParam`/`getBookmark`/`Flythrough`
// pour piloter la caméra du harnais.

import * as THREE from "three";

/** Pose caméra : position + orientation (radians) — même convention que
 *  `?cam=x,y,z,yaw,pitch` du harnais (voir `main.ts` `applyCamPose`). */
export type BookmarkPose = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
};

export type Bookmark = {
  /** Valeur attendue dans `?shot=` (1..BOOKMARKS.length). */
  readonly id: number;
  /** Nom affiché en visite guidée. */
  readonly name: string;
  readonly pose: BookmarkPose;
};

// --- Constantes (aucun nombre magique ailleurs dans ce fichier) ------------

const EYE_HEIGHT = 1.7; // hauteur des yeux du visiteur (m) — cohérent avec le harnais
const GRAVE_EYE_HEIGHT = 1.2; // légèrement baissé : vue penchée sur une tombe
const OVERFLIGHT_HEIGHT = 12; // hauteur de la pose « survol » (m)
const CLEARING_CENTER_Z = 9; // centre de la clairière du harnais (builder.ts, cluster.z)
const QUARTER_TURN = Math.PI / 2;
const HALF_TURN = Math.PI;
const OVERFLIGHT_PITCH = -1.2; // quasi zénithal (radians, vers le bas)

/** 9 poses nommées couvrant le cimetière-harnais (entrée → clairière → survol →
 *  contre-jour → sortie) — servent à la fois de bookmarks QA (`?shot=N`) et
 *  d'étapes ordonnées du flythrough. */
export const BOOKMARKS: readonly Bookmark[] = [
  { id: 1, name: "Entrée", pose: { x: 0, y: EYE_HEIGHT, z: 0.5, yaw: 0, pitch: 0 } },
  { id: 2, name: "Allée", pose: { x: 0, y: EYE_HEIGHT, z: 3, yaw: 0, pitch: -0.05 } },
  { id: 3, name: "Clairière", pose: { x: 0, y: EYE_HEIGHT, z: 6.5, yaw: 0, pitch: -0.08 } },
  { id: 4, name: "Tombe centrale", pose: { x: 0, y: GRAVE_EYE_HEIGHT, z: CLEARING_CENTER_Z - 2, yaw: 0, pitch: -0.15 } },
  { id: 5, name: "Flanc gauche", pose: { x: -4, y: EYE_HEIGHT, z: CLEARING_CENTER_Z, yaw: QUARTER_TURN, pitch: -0.05 } },
  { id: 6, name: "Flanc droit", pose: { x: 4, y: EYE_HEIGHT, z: CLEARING_CENTER_Z, yaw: -QUARTER_TURN, pitch: -0.05 } },
  { id: 7, name: "Survol", pose: { x: 0, y: OVERFLIGHT_HEIGHT, z: CLEARING_CENTER_Z, yaw: 0, pitch: OVERFLIGHT_PITCH } },
  { id: 8, name: "Contre-jour", pose: { x: 0, y: EYE_HEIGHT, z: CLEARING_CENTER_Z + 4, yaw: HALF_TURN, pitch: -0.05 } },
  { id: 9, name: "Sortie", pose: { x: 0, y: EYE_HEIGHT, z: 1.5, yaw: HALF_TURN, pitch: 0.02 } },
] as const;

const FLYTHROUGH_SHOT_VALUE = "fly";
/** Durée d'un tour complet, en secondes (référence LAAS : tour ≈ 90 s). */
export const FLYTHROUGH_DURATION_S = 90;
/** Tension de la spline Catmull-Rom (0.5 = réglage par défaut de three.js). */
const FLYTHROUGH_TENSION = 0.5;

// --- Parsing/round-trip de `?shot=` -----------------------------------------

/** `?shot=` → id de bookmark (1..N), `"fly"` (tour), ou `null` si absent/invalide.
 *  Round-trip avec `getBookmark` : `getBookmark(parseShotParam(String(b.id)))`. */
export function parseShotParam(raw: string | null): number | "fly" | null {
  if (raw === null) return null;
  if (raw === FLYTHROUGH_SHOT_VALUE) return FLYTHROUGH_SHOT_VALUE;
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  return BOOKMARKS.some((b) => b.id === id) ? id : null;
}

/** Retrouve un bookmark par id, `undefined` si inconnu. */
export function getBookmark(id: number): Bookmark | undefined {
  return BOOKMARKS.find((b) => b.id === id);
}

// --- Flythrough : tour Catmull-Rom passant par tous les bookmarks ----------

/** Courbe fermée passant par les positions des bookmarks, dans leur ordre. */
function buildPositionCurve(): THREE.CatmullRomCurve3 {
  const points = BOOKMARKS.map((b) => new THREE.Vector3(b.pose.x, b.pose.y, b.pose.z));
  return new THREE.CatmullRomCurve3(points, true, "catmullrom", FLYTHROUGH_TENSION);
}

/** Courbe d'orientation : yaw/pitch encodés en (x, y) d'un point 3D, échantillonnée
 *  avec le MÊME paramètre `u` que la courbe de position (simplification assumée :
 *  l'orientation n'est pas re-paramétrée par longueur d'arc propre — acceptable pour
 *  un panoramique, pas de discontinuité visible). */
function buildOrientationCurve(): THREE.CatmullRomCurve3 {
  const points = BOOKMARKS.map((b) => new THREE.Vector3(b.pose.yaw, b.pose.pitch, 0));
  return new THREE.CatmullRomCurve3(points, true, "catmullrom", FLYTHROUGH_TENSION);
}

/**
 * Tour automatique du cimetière : échantillonne une pose caméra continue à tout
 * instant, en bouclant après `durationS`. Paramétrage par longueur d'arc
 * (`getPointAt`) : vitesse de déplacement constante, jamais de saut entre deux
 * échantillons proches dans le temps (protégé par bookmarks.test.ts).
 */
export class Flythrough {
  private readonly positionCurve = buildPositionCurve();
  private readonly orientationCurve = buildOrientationCurve();

  samplePose(elapsedSeconds: number, durationS: number = FLYTHROUGH_DURATION_S): BookmarkPose {
    const u = ((elapsedSeconds % durationS) + durationS) % durationS / durationS;
    const p = this.positionCurve.getPointAt(u);
    const o = this.orientationCurve.getPointAt(u);
    return { x: p.x, y: p.y, z: p.z, yaw: o.x, pitch: o.y };
  }
}
