// Les 3 axes visuels INDÉPENDANTS d'une tombe (issue #25).
//
//   Axe 1 — vieillissement : dérivé UNIQUEMENT de la date d'enterrement,
//            irréversible, ni les votes ni l'entretien ne le changent.
//   Axe 2 — votes : hanté (négatif) ↔ paradisiaque (positif).
//   Axe 3 — entretien : négligé (0) ↔ impeccablement fleuri (1).
//
// Ce module ne contient QUE le modèle : il transforme les données brutes en
// trois scalaires normalisés que le pipeline de rendu (graves.ts) combine
// ensuite indépendamment. Aucune dépendance à Three.js → testable seul.

export type GraveAxes = {
  /** 0 = neuve, 1 = très ancienne. Dérivé de la date. */
  age: number;
  /** -1 = hanté, 0 = neutre, +1 = paradisiaque. Dérivé du solde de votes. */
  vote: number;
  /** 0 = négligé, 1 = impeccable. État d'entretien. */
  maintenance: number;
  /** Vrai si le départ est annoncé mais pas encore survenu (issue #21). */
  construction: boolean;
};

export type GraveData = {
  departedOn: string | null;
  createdAt: string;
  voteScore: number;
  maintenance: number;
  construction: boolean;
};

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;
/** Âge (en années) auquel le vieillissement atteint son maximum visuel. */
const FULL_AGE_YEARS = 40;
/** Échelle de saturation douce du solde de votes (tanh). */
const VOTE_SCALE = 12;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Axe 1 — vieillissement, dérivé de la date (departedOn, sinon createdAt). */
export function ageFromDate(departedOn: string | null, createdAt: string, now: number): number {
  const ref = departedOn ?? createdAt;
  const t = Date.parse(ref);
  if (Number.isNaN(t)) return 0;
  const years = (now - t) / MS_PER_YEAR;
  return clamp(years / FULL_AGE_YEARS, 0, 1);
}

/** Axe 2 — solde de votes ramené dans [-1, 1] (saturation douce). */
export function voteAxis(voteScore: number): number {
  return Math.tanh(voteScore / VOTE_SCALE);
}

/** Axe 3 — état d'entretien borné dans [0, 1]. */
export function maintenanceAxis(maintenance: number): number {
  return clamp(maintenance, 0, 1);
}

/** Combine les données brutes d'une tombe en ses axes normalisés. */
export function graveAxes(c: GraveData, now: number): GraveAxes {
  return {
    age: ageFromDate(c.departedOn, c.createdAt, now),
    vote: voteAxis(c.voteScore),
    maintenance: maintenanceAxis(c.maintenance),
    construction: c.construction,
  };
}
