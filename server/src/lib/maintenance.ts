const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Nombre de jours pour que la maintenance passe de 1.0 à 0.0 sans soin.
 * Soit environ 9 mois avant qu'une tombe soit complètement négligée.
 */
const FULL_DECAY_DAYS = 270;

/** Gain d'entretien par action de soin. */
export const MAINTAIN_BOOST = 0.3;

/**
 * Calcule l'état d'entretien effectif en tenant compte de la décroissance
 * temporelle depuis la dernière action de soin (ou la création de la tombe).
 *
 * @param base    Valeur d'entretien au moment de `reference`.
 * @param reference  Date de la dernière action de soin (ou de création).
 * @param now    Date actuelle.
 */
export function effectiveMaintenance(base: number, reference: Date, now: Date): number {
  const days = (now.getTime() - reference.getTime()) / MS_PER_DAY;
  return Math.max(0, base - days / FULL_DECAY_DAYS);
}
