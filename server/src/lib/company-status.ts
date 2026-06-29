export type CompanyStatus = "Naissant" | "Ouvert" | "En sommeil" | "Fermé";

const DORMANT_AFTER_MS = 2 * 365.25 * 24 * 3600 * 1000;

/**
 * Statut d'activité affiché à l'entrée d'un cimetière (issues #5 et #6).
 * Pure function : date et closedAt injectés pour la testabilité.
 */
export function companyStatus(
  graveCount: number,
  lastBurial: string | null,
  now: number,
  closedAt?: string | null,
): CompanyStatus {
  if (closedAt) return "Fermé";
  if (graveCount === 0 || !lastBurial) return "Naissant";
  return now - new Date(lastBurial).getTime() > DORMANT_AFTER_MS ? "En sommeil" : "Ouvert";
}
