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
};

export type CompanyDetail = {
  // La route détail renvoie la ligne brute du cimetière (sans karma/statut agrégés).
  company: { id: string; name: string; slug: string; description: string | null; createdAt: string };
  colleagues: Colleague[];
  /** Karma = somme des voteScores des tombes (issue #3). */
  karma: number;
};

/** Message laissé dans le livre d'or d'une tombe (issue #9). */
export type GraveMessage = {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
};
