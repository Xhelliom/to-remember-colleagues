// Habillage biologique de surface (mousse/lichen/coulures) — pilote la
// "salissure" d'une pierre (ou d'un bois mort, cf. deadfall.ts) par sa
// géométrie locale (upness/cavity) et les axes de jeu d'une tombe
// (maintenance/votes, graveAxes.ts).
//
// Référence de CONCEPT : LAAS `vegetation/Dressing.ts` (mousse/lichen/
// coulures pilotées par upness+cavity). Module PUR (comme graveAxes.ts) :
// aucune dépendance Three.js, testable seul. `graveStone.ts` (mission 07)
// blende ces intensités dans la couleur de vertex déjà calculée par
// `sampleWeathering` (scene/stone.ts, mission 06) — pas de nouvelle
// géométrie, pas de shader supplémentaire (matériau seulement).

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Entrées du modèle : `upness`/`cavity` ∈ [0,1] (géométrie locale — hauteur
 *  normalisée ou `dot(normal, up)` selon le maillage consommateur), `maintenance`
 *  ∈ [0,1] et `votes` ∈ [-1,1] (axes de jeu, graveAxes.ts). */
export type DressingInputs = {
  /** [0,1] — 0 = base ombragée/humide, 1 = sommet exposé au soleil/vent. */
  upness: number;
  /** [0,1] — occlusion dans les creux (`cavityAO` de stone.ts), 1 = creux profond. */
  cavity: number;
  /** [0,1] — axe 3 (entretien), 1 = impeccable. */
  maintenance: number;
  /** [-1,1] — axe 2 (hanté ↔ paradisiaque). */
  votes: number;
};

export type Dressing = {
  /** [0,1] — mousse : maximale dans les creux ombragés (cavity↑, upness↓). */
  mossIntensity: number;
  /** [0,1] — lichen : maximal sur les faces exposées (upness↑), hors des creux. */
  lichenIntensity: number;
  /** [0,1] — coulures : traces d'eau stagnant dans les creux. */
  streakIntensity: number;
  /** [0,1] — habillage global (max des trois), monotone décroissant avec `maintenance`. */
  intensity: number;
  /** Décalage de teinte de l'habillage (hanté = plus terne/violacé, paradisiaque = plus doré) —
   *  rend le karma (axe votes) lisible, pas seulement l'entretien. */
  hueBias: number;
};

// --- Constantes nommées (pas de magic number inline) ---
const HAUNT_DRESSING_HUE_SHIFT = -0.05; // hanté : mousse/lichen plus ternes, virant au violet
const BLESS_DRESSING_HUE_SHIFT = 0.06; // paradisiaque : mousse/lichen plus dorés

/**
 * Dérive les intensités de mousse/lichen/coulures + le décalage de teinte à
 * partir de la géométrie locale (`upness`/`cavity`) et des axes de jeu
 * (`maintenance`/`votes`). Pure et déterministe : mêmes entrées → mêmes sorties.
 */
export function dressingFor(inputs: DressingInputs): Dressing {
  const upness = clamp01(inputs.upness);
  const cavity = clamp01(inputs.cavity);
  const maintenance = clamp01(inputs.maintenance);
  const neglect = 1 - maintenance; // 0 = impeccable, 1 = à l'abandon

  const mossPotential = cavity * (1 - upness); // creux ombragés
  const lichenPotential = upness * (1 - cavity); // faces hautes exposées, hors creux
  const streakPotential = cavity; // l'eau stagne/coule dans les creux, où qu'ils soient

  const mossIntensity = clamp01(mossPotential * neglect);
  const lichenIntensity = clamp01(lichenPotential * neglect);
  const streakIntensity = clamp01(streakPotential * neglect);

  const haunt = Math.max(0, -inputs.votes);
  const bless = Math.max(0, inputs.votes);

  return {
    mossIntensity,
    lichenIntensity,
    streakIntensity,
    intensity: Math.max(mossIntensity, lichenIntensity, streakIntensity),
    hueBias: HAUNT_DRESSING_HUE_SHIFT * haunt + BLESS_DRESSING_HUE_SHIFT * bless,
  };
}
