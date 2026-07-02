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
