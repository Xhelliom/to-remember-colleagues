const MAX_SLUG_LENGTH = 160;
const DEFAULT_SLUG = "cimetiere";

/** Transforme un nom en slug URL : minuscules, sans accents, mots séparés par des tirets. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug || DEFAULT_SLUG;
}

/**
 * Garantit l'unicité d'un slug parmi une liste existante en suffixant un numéro.
 * Renvoie le slug d'origine s'il est libre.
 */
export function uniqueSlug(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
