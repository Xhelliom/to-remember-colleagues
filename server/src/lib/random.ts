const GRAVE_SEED_RANGE = 1_000_000_000;

/** Graine aléatoire utilisée pour la forme et la position déterministes d'une tombe. */
export function newGraveSeed(): number {
  return Math.floor(Math.random() * GRAVE_SEED_RANGE);
}
