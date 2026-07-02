// Manifeste du mini-biome « clairière » (cimetière en sous-bois). Point d'entrée
// déclaratif d'un biome : identité + où trouver son image concept + comment le tester.
// Chaque nouveau thème (enfer, paradis…) aura son propre dossier avec un manifeste.

export const clairiereManifest = {
  /** Identifiant court (nom du dossier). */
  name: "clairiere",
  /** Libellé lisible. */
  title: "Clairière cocoon — cimetière en sous-bois",
  /** Image de référence, chemin relatif à la racine du dépôt (lue en fs par la spec E2E). */
  conceptImage: "web/src/scene/biomes/clairiere/concept.png",
  /** URL du harnais de test isolé (voir runClusterTest dans main.ts). */
  testUrl: "/?testCluster=42",
  /** Référentiel d'objectifs mesurables + vecteur de référence. */
  criteria: "plans/CLUSTER_BIOME_CRITERIA.md",
} as const;
