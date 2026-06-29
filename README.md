# ⚰️ Le Cimetière des Collègues

Une application web **3D** où l'on se balade à la première personne dans un
**cimetière**. Chaque **entreprise** a son propre cimetière, et chaque **tombe**
honore un·e collègue qui a quitté l'entreprise, accompagné·e de **sa citation**.

L'ambiance change selon **l'heure** et la **saison** — avec un mode spécial
**🎃 Halloween** qui transforme le lieu en cimetière effrayant.

![Aperçu](docs/preview.png)

## Stack technique

| Côté | Technologies |
| --- | --- |
| **Frontend** | Vite 8 · Three.js 0.185 · TypeScript 7 |
| **Backend** | Fastify 5 · Better Auth 1.6 · Drizzle ORM 0.45 |
| **Base de données** | PostgreSQL 18 |
| **Outils** | pnpm 10 (workspace) · Node 22 |

Mono-dépôt pnpm avec deux packages : [`server/`](server) (API) et [`web/`](web)
(client 3D).

## Prérequis

- Node ≥ 22, pnpm ≥ 10
- Docker (pour PostgreSQL 18) **ou** un PostgreSQL accessible

## Démarrage rapide

```bash
# 1. Dépendances
pnpm install

# 2. Base de données PostgreSQL 18
pnpm db:up                      # docker compose up -d db

# 3. Configuration du serveur
cp server/.env.example server/.env
#   puis renseignez BETTER_AUTH_SECRET (>= 32 caractères) :
#   openssl rand -base64 32

# 4. Schéma + données d'exemple
pnpm db:generate                # génère les migrations Drizzle
pnpm db:migrate                 # applique les migrations
pnpm seed                       # entreprises + collègues d'exemple

# 5. Lancement (API + client en parallèle)
pnpm dev
```

- Client : http://localhost:5173
- API : http://localhost:3000 (le client proxifie `/api` vers l'API)

## Utilisation

1. **Inscrivez-vous / connectez-vous** (comptes gérés par Better Auth).
2. **Choisissez un cimetière** (une entreprise) dans le menu, ou créez-en un.
3. **Baladez-vous** :
   - `ZQSD` / `WASD` ou flèches pour marcher
   - **Souris** pour regarder (cliquez pour capturer le curseur)
   - **Maj** pour courir, **Échap** pour revenir au menu
4. **Approchez-vous d'une tombe** pour révéler le nom, la date de départ et la
   citation du collègue.
5. **Ajoutez un collègue** via le bouton dédié (nom, citation, date de départ).
6. **Changez l'ambiance** via le bouton *Ambiance* : moment de la journée,
   saison, ou mode 🎃 Halloween.

## Modèle de données

- `user` / `session` / `account` / `verification` — tables gérées par Better Auth.
- `companies` — un cimetière par entreprise (`name`, `slug`, `description`).
- `colleagues` — une tombe par collègue (`name`, `quote`, `departedOn`,
  `graveSeed` pour une forme/position déterministe).

Schéma défini avec Drizzle dans [`server/src/db`](server/src/db) ; migrations
versionnées dans `server/drizzle`.

## API

| Méthode | Route | Auth | Description |
| --- | --- | --- | --- |
| `*` | `/api/auth/*` | — | Better Auth (inscription, connexion, session) |
| `GET` | `/api/companies` | non | Liste des cimetières + nombre de tombes |
| `POST` | `/api/companies` | oui | Crée un cimetière |
| `GET` | `/api/companies/:id/colleagues` | non | Détail d'un cimetière + tombes |
| `POST` | `/api/companies/:id/colleagues` | oui | Ajoute une tombe |

## Scripts utiles

```bash
pnpm dev            # API + client en parallèle
pnpm dev:server     # API seule
pnpm dev:web        # client seul
pnpm build          # build de production (client + serveur)
pnpm typecheck      # vérification de types (TypeScript 7 / tsgo)
pnpm db:up          # démarre PostgreSQL 18 (Docker)
pnpm db:down        # arrête PostgreSQL
pnpm test           # tests unitaires + intégration (Vitest, tous packages)
pnpm e2e            # tests end-to-end (Playwright)
```

## Tests

Les conventions et objectifs mesurables sont décrits dans [`CLAUDE.md`](CLAUDE.md).

- **Unitaires (Vitest)** — fonctions pures : `web/src/ambiance.test.ts`,
  `web/src/graves.test.ts`, `server/src/lib/slug.test.ts`,
  `server/src/lib/random.test.ts`.
- **Intégration (Vitest + `app.inject`)** — `server/src/app.test.ts` (santé, CORS,
  sans base) et `server/src/app.integration.test.ts` (flux auth → entreprise →
  collègue ; ignoré automatiquement si la base est injoignable).
- **End-to-end (Playwright)** — `e2e/cemetery.spec.ts` : inscription → menu →
  création d'un cimetière → entrée → rendu WebGL → ajout d'un collègue →
  bascule d'ambiance Halloween. Utilise le Chromium pré-installé
  (`PW_CHROME` pour surcharger le chemin) et démarre l'API + le client
  automatiquement.

```bash
# Tout valider (definition of done)
pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```

## Ambiance dynamique

[`web/src/ambiance.ts`](web/src/ambiance.ts) calcule l'ambiance à partir de la
date et de l'heure réelles :

- **Heure** → couleur du ciel, position/teinte de l'astre (soleil/lune), brouillard.
- **Saison** → palette du sol et du feuillage, et particules (neige, feuilles
  mortes, pollen…).
- **Halloween** (fin octobre, ou choisi manuellement) → nuit violacée, pleine
  lune, brouillard épais, citrouilles lumineuses, chauves-souris, arbres morts et
  pierres penchées.
