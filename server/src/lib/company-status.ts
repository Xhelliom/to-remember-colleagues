export type CompanyStatus = "Naissant" | "Ouvert" | "En sommeil";

const DORMANT_AFTER_MS = 2 * 365.25 * 24 * 3600 * 1000;

/**
 * Statut d'activité affiché à l'entrée d'un cimetière (issue #5). Heuristique
 * pure (date injectée pour la testabilité) ; le cycle de vie complet (fermeture,
 * barrière cassée) relève de l'issue #6.
 */
export function companyStatus(graveCount: number, lastBurial: string | null, now: number): CompanyStatus {
  if (graveCount === 0 || !lastBurial) return "Naissant";
  return now - new Date(lastBurial).getTime() > DORMANT_AFTER_MS ? "En sommeil" : "Ouvert";
}
