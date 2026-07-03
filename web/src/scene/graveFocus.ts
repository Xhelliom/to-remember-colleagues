// Sélection de la tombe « focalisée » : la plus proche de la caméra dans un
// rayon. Logique pure extraite de cemetery.ts (testable + garde cemetery.ts
// sous la limite de 500 lignes).
import type * as THREE from "three";
import type { Colleague } from "../types.ts";

export const FOCUS_RADIUS = 3.2; // rayon d'accroche (m) du focus sur une tombe

/** Collègue de la tombe la plus proche de `cam` (distance au sol) dans `radius`, ou null. */
export function pickNearestColleague(
  graves: readonly THREE.Object3D[],
  cam: THREE.Vector3,
  radius: number,
): Colleague | null {
  let nearest: Colleague | null = null;
  let best = radius;
  for (const grave of graves) {
    const d = Math.hypot(grave.position.x - cam.x, grave.position.z - cam.z);
    if (d < best) {
      best = d;
      nearest = (grave.userData.colleague as Colleague) ?? null;
    }
  }
  return nearest;
}
