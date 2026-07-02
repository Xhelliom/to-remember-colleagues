// Sélection de palier de détail par distance, factorisée pour l'herbe et la
// végétation instanciée (cemetery.ts) — même principe d'hystérésis que
// chunkStreaming.ts, pour ne jamais clignoter à la frontière d'un palier.

/**
 * Palier actif selon la distance à la caméra, avec hystérésis anti-clignotement.
 * `thresholds` croissants ; renvoie un indice de 0 (le plus détaillé) à
 * `thresholds.length` (le plus loin). Ne change de palier que si la distance
 * franchit clairement la frontière (± `hysteresis`) — sinon `current` est conservé.
 */
export function selectLodTier(
  distance: number,
  thresholds: readonly number[],
  current: number,
  hysteresis: number,
): number {
  let tier = current;
  while (tier < thresholds.length && distance > thresholds[tier] + hysteresis) tier++;
  while (tier > 0 && distance < thresholds[tier - 1] - hysteresis) tier--;
  return tier;
}

// --- Crossfade dither complémentaire (mission 10, trees/treeLod.ts) --------
// Même principe que grassRing.ts (mission 05) : une instance qui approche
// d'une frontière de palier bascule progressivement vers le palier voisin
// selon sa valeur de dither propre, jamais toutes en même temps → pas de pop
// visible. Généralisé ici (au lieu de rester privé à grassRing.ts) car les
// arbres (mission 10) ont besoin du même mécanisme sans dépendre d'un module
// thématique "herbe".

/** Constantes de hash déterministe du dither — même famille que wind.ts (sin-hash). */
const DITHER_HASH_FREQ = 91.345;
const DITHER_HASH_SCALE = 47453.156;
const DITHER_INDEX_SALT = 7.111;

/** Progression (0→1) dans la fenêtre de transition [seuil-hystérésis, seuil+hystérésis]
 *  autour d'un seuil de palier — fonction pure et continue, sans état. */
export function transitionProgress(distance: number, threshold: number, hysteresis: number): number {
  const t = (distance - (threshold - hysteresis)) / (2 * hysteresis);
  return Math.min(1, Math.max(0, t));
}

/** Valeur de dither déterministe dans [0, 1[ pour la `index`-ième instance d'un
 *  groupe de graine `seed` (même famille de hash que wind.ts/grassRing.ts). */
export function ditherValue(seed: number, index: number): number {
  const v = Math.sin((seed + index * DITHER_INDEX_SALT) * DITHER_HASH_FREQ) * DITHER_HASH_SCALE;
  return v - Math.floor(v);
}

/** Vrai si l'instance (valeur de dither `dither`) reste dans son palier d'origine
 *  à la progression `progress` — complémentaire par construction : la fraction
 *  gardée décroît linéairement de 1 à 0 pendant que le palier voisin grandit
 *  symétriquement de 0 à 1, sans jamais qu'une instance compte dans les deux. */
export function keepInHomeTier(dither: number, progress: number): boolean {
  return dither >= progress;
}
