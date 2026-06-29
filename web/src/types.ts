export type User = {
  id: string;
  email: string;
  name: string;
};

export type CompanyStatus = "Naissant" | "Ouvert" | "En sommeil" | "Fermé";

export type Company = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  graveCount: number;
  /** Karma = somme des votes des tombes (axe 2). Affiché sur l'enseigne d'entrée. */
  karma: number;
  /** Statut d'activité affiché à l'entrée (issue #5). */
  status: CompanyStatus;
};

export type OfferingType = "flower" | "candle" | "stone";

export type OfferingCounts = { flower: number; candle: number; stone: number };

export type Colleague = {
  id: string;
  name: string;
  quote: string;
  departedOn: string | null;
  graveSeed: number;
  /** Axe 2 (issue #25) : solde des votes, hanté (négatif) ↔ paradisiaque (positif). */
  voteScore: number;
  /** Axe 3 (issue #25) : entretien, 0 = négligé, 1 = impeccablement fleuri. */
  maintenance: number;
  createdAt: string;
  /** Offrandes actives déposées sur la tombe (issue #7). */
  offeringCounts: OfferingCounts;
  /** Vrai si le départ est annoncé mais pas encore arrivé (issue #21). */
  construction: boolean;
};

export type CompanyDetail = {
  // La route détail renvoie la ligne brute du cimetière (sans karma/statut agrégés).
  company: { id: string; name: string; slug: string; description: string | null; createdAt: string };
  colleagues: Colleague[];
  /** Karma = somme des voteScores des tombes (issue #3). */
  karma: number;
  /** Vrai si les noms sont anonymisés — l'utilisateur n'est pas membre (issue #22). */
  anonymized: boolean;
};

/** Détail d'un collègue avec son cimetière (lien de partage, issue #18). */
export type ColleagueDetail = Colleague & {
  company: { id: string; name: string; slug: string; closed: boolean };
  karma: number;
  anonymized: boolean;
};

/** Message laissé dans le livre d'or d'une tombe (issue #9). */
export type GraveMessage = {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
};
