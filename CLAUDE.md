# CLAUDE.md — Conventions du projet

Guide pour Claude (et l'équipe) lors de toute modification de
**Le Cimetière des Collègues**. Ces règles sont **contraignantes** : tout code
ajouté ou modifié doit s'y conformer.

## Architecture

Mono-dépôt pnpm avec deux packages :

- `server/` — API Fastify + Drizzle ORM + PostgreSQL, auth via Better Auth.
- `web/` — client Vite + Three.js (TypeScript).

Tout est en **TypeScript** (TS 7). Imports relatifs avec extension `.ts` explicite.

## Règles de clean code (obligatoires)

### Taille et découpage
- **Fichier : 500 lignes maximum.** Au-delà, découper en modules cohérents
  (voir `web/src/scene/` issu du découpage de `cemetery.ts`).
- **Fonction / méthode : 50 lignes maximum.** Extraire des fonctions auxiliaires
  nommées plutôt que d'allonger un corps.
- **Une responsabilité par module / fonction** (principe de responsabilité unique).
- Limiter l'imbrication (≈ 3 niveaux). Préférer les retours anticipés (early return)
  aux `else` profonds.

### Pas de « magic numbers » / « magic strings »
- Aucune valeur numérique non triviale en dur dans la logique : la nommer en
  `const` en haut du module (ex. `const FOCUS_RADIUS = 3.2;`,
  `const WALK_SPEED = 4.2;`).
- Les valeurs partagées vont dans un module de constantes dédié.
- Exceptions tolérées : `0`, `1`, `-1`, et `2` quand le sens est évident.

### Nommage et lisibilité
- Noms explicites et intentionnels ; pas d'abréviations obscures.
- Code et commentaires en **français** (cohérence avec l'existant).
- Commenter le *pourquoi*, pas le *quoi*. Pas de code commenté laissé en place.

### Types
- `strict` activé ; **pas de `any`** (préférer `unknown` + rétrécissement).
- Typer les frontières (API, fonctions exportées). Réutiliser les types Drizzle
  (`$inferSelect`) et les types partagés (`web/src/types.ts`).

### Fonctions pures et testabilité
- Isoler la logique pure (calculs, transformations) des effets de bord (DOM,
  réseau, base) pour la rendre testable sans mocks lourds — ex. `lib/slug.ts`,
  `ambiance.ts`, `graves.ts#seededRandom`.

## Tests (obligatoires)

Toute nouvelle fonctionnalité ou correction de bug s'accompagne de tests.

- **Tests unitaires (Vitest)** pour toute fonction pure / utilitaire.
  Fichiers `*.test.ts` à côté du code testé.
- **Tests d'intégration (Vitest + `app.inject`)** pour les routes de l'API ;
  ignorés proprement si la base est injoignable (`describe.skipIf`).
- **Tests e2e (Playwright)** dans `e2e/` pour les parcours utilisateur critiques
  (auth → menu → cimetière → rendu WebGL → ajout d'un collègue).
- Une **régression corrigée** doit être couverte par un test qui échouait avant
  le correctif.

### Objectifs mesurables (definition of done)

Avant de considérer une tâche terminée, **tout** doit passer :

```bash
pnpm typecheck     # 0 erreur de type (tsgo / tsc)
pnpm test          # tous les tests unitaires + intégration verts
pnpm build         # build de production sans erreur
pnpm e2e           # parcours e2e verts (nécessite la base + serveurs)
```

Ne jamais marquer une tâche comme terminée si un test échoue, si l'implémentation
est partielle, ou si le typecheck/build casse.

## Conventions Git

- Branche de développement : `claude/3d-cemetery-web-app-71uxwr`.
- Messages de commit clairs et descriptifs (en français).
- Ne pas committer : `node_modules/`, `dist/`, `.env`, artefacts de test
  (`test-results/`, `playwright-report/`), `pgdata/`.
- Committer les migrations Drizzle (`server/drizzle/`).

## Démarrage rapide (rappel)

```bash
pnpm install
pnpm db:up                                   # PostgreSQL 18 (Docker)
cp server/.env.example server/.env           # + BETTER_AUTH_SECRET (>= 32 car.)
pnpm db:generate && pnpm db:migrate && pnpm seed
pnpm dev                                      # client :5173 · API :3000
```
