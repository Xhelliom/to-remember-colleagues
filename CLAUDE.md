# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Ces règles sont **contraignantes** : tout code ajouté ou modifié doit s'y conformer.

## Project Overview

**Le Cimetière des Collègues** est une application web **3D** à la première personne :
on se promène dans des cimetières où chaque **tombe** honore un·e collègue ayant
quitté une entreprise, avec sa citation. C'est un **monorepo pnpm** à deux
packages — un client 3D et une API.

**Tech stack :**
- Frontend : Vite 8 · Three.js 0.185 · TypeScript 7 (tsgo) — pas de framework UI, DOM natif
- Backend : Fastify 5 · Better Auth 1.6 · Drizzle ORM 0.45 · PostgreSQL 18
- Tests : Vitest 4 (unitaires + intégration) · Playwright (e2e)
- Monorepo : pnpm 10 workspaces · Node ≥ 22 (ESM, `--experimental-strip-types`)

---

## Development Commands

**N'utilise jamais `npm` ou `yarn`.** Ce projet utilise `pnpm` exclusivement.
Le typage passe par **tsgo** (TypeScript 7 natif) avec repli sur `tsc`.

```bash
pnpm install
pnpm db:up                       # PostgreSQL 18 via docker compose (service "db", port 5499→5432)
pnpm db:generate                 # génère une migration Drizzle (offline, diff sur le snapshot)
pnpm db:migrate                  # applique les migrations
pnpm seed                        # données d'exemple (entreprises + collègues)
pnpm dev                         # API + client en parallèle
pnpm dev:server                  # API seule (Fastify, watch)
pnpm dev:web                     # client seul (Vite)
pnpm build                       # build client puis serveur
pnpm typecheck                   # tsgo --noEmit (tous les packages)
pnpm test                        # tests unitaires + intégration (Vitest, tous packages)
pnpm e2e                         # tests end-to-end (Playwright)
pnpm db:down                     # arrête PostgreSQL
```

**Ports** : client Vite `5173`, API Fastify `3300`, PostgreSQL `5499`. Le client
**proxifie tout `/api`** (y compris l'auth Better Auth et les flux SSE) vers
`localhost:3300` — voir `web/vite.config.ts`. Variables dans `server/.env`
(copier depuis `server/.env.example`, renseigner `BETTER_AUTH_SECRET` ≥ 32 car.).

---

## Repository Structure

```
to-remember-colleagues/
├── web/                         # Client 3D (Vite + Three.js)
│   ├── index.html               # tous les écrans (auth, menu, HUD, dialog) en un seul DOM
│   └── src/
│       ├── main.ts              # orchestration des écrans (auth → menu → hub/cimetière)
│       ├── cemetery.ts          # orchestrateur Three.js : modes "hub" et "cemetery", boucle
│       ├── scene/               # sky.ts, lighting.ts, decor.ts, controls.ts (issus du découpage)
│       ├── graves.ts            # construction d'une tombe (pipeline de rendu des 3 axes #25)
│       ├── graveAxes.ts         # modèle PUR des 3 axes (âge/votes/entretien) — testable seul
│       ├── procedural.ts        # layout procédural déterministe d'un cimetière (#5)
│       ├── hub.ts               # route + portails de cimetières avec enseignes (#5)
│       ├── net.ts               # présence temps réel côté client : SSE + POST (#4)
│       ├── avatars.ts           # avatars fantômes des visiteurs + emotes (#4)
│       ├── ambiance.ts          # ambiance selon heure/saison (+ mode Halloween)
│       ├── api.ts / types.ts    # client HTTP + types partagés
│       └── ui/                  # auth.ts, menu.ts, hud.ts, dialog.ts (manipulation DOM directe)
├── server/                      # API Fastify
│   ├── src/
│   │   ├── app.ts               # buildApp() — instance Fastify testable via inject()
│   │   ├── index.ts             # bootstrap : démarre l'écoute
│   │   ├── auth.ts / session.ts # Better Auth + helpers de session (requireUser)
│   │   ├── realtime.ts          # présence temps réel : SSE autoritatif-relais (#4)
│   │   ├── routes/              # companies.ts, colleagues.ts
│   │   ├── lib/                 # logique pure testable (slug, random, company-status)
│   │   ├── db/                  # schema.ts, auth-schema.ts, client.ts, migrate.ts
│   │   └── seed.ts
│   └── drizzle/                 # migrations SQL versionnées + snapshots meta
├── e2e/                         # tests Playwright (parcours utilisateur)
└── docker-compose.yml           # PostgreSQL 18
```

---

## Key Design Decisions

- **Monorepo pnpm, ESM `.ts` direct** : Node exécute le TypeScript via
  `--experimental-strip-types` ; les imports gardent l'extension `.ts`
  (`allowImportingTsExtensions`). Pas d'étape de transpilation au runtime serveur.
- **Une seule scène Three.js, deux modes** : la classe `Cemetery` (`cemetery.ts`)
  orchestre `scene/` (sky, lighting, decor, controls) et gère à la fois le **hub**
  (route) et un **cimetière**, en basculant `mode`. Les groupes (`gravesGroup`,
  `hubGroup`, `peersGroup`, `decor.group`) sont vidés/reconstruits selon le mode.
  Ne pas créer un second renderer.
- **Déterminisme par graine** : toute la génération procédurale est reproductible.
  `seededRandom` (mulberry32) + `hashSeed` (FNV-1a) dérivent les graines depuis
  des données stables (`graveSeed`, **id d'organisation**). Même entrée → même
  rendu. Garder cette propriété (pas de `Math.random()` dans la génération).
- **3 axes visuels d'une tombe (#25)** : l'aspect résulte de **trois axes
  indépendants** combinés sur la même pierre, jamais d'un score unique :
  **âge** (dérivé de la date, irréversible), **votes** (`vote_score`,
  hanté ↔ paradisiaque), **entretien** (`maintenance` 0..1). Le modèle pur est
  dans `graveAxes.ts`, le pipeline de rendu dans `graves.ts`.
- **Hub + cimetières procéduraux (#5)** : une route commune borde les entrées de
  tous les cimetières (enseigne nom/karma/statut). Le plan de chaque cimetière est
  généré procéduralement depuis l'id de l'organisation ; ses tombes sont chargées
  **à la demande** à l'entrée (touche E).
- **Multijoueur — serveur autoritatif-relais, pas de P2P (#4)** : le serveur
  attribue les ids, possède les **salons** (un par cimetière + `hub`) et relaie
  l'état ; il ne simule pas la physique (présence légère). Transport **natif** :
  **SSE** serveur→client + `fetch` POST client→serveur — **aucune dépendance
  WebSocket**. Positions publiées à ~10 Hz et interpolées côté client.
- **Auth Better Auth + Drizzle** : Better Auth gère `/api/auth/*` et ses propres
  tables (`user`/`session`/`account`/`verification`, ré-exportées dans `schema.ts`).
  Protéger une route serveur avec `requireUser` (`session.ts`).

---

## Règles de clean code (obligatoires)

### Taille et découpage
- **Fichier : 500 lignes maximum.** Au-delà, découper en modules cohérents
  (voir `web/src/scene/` issu du découpage de `cemetery.ts`).
- **Fonction / méthode : 50 lignes maximum.** Extraire des fonctions auxiliaires
  nommées plutôt que d'allonger un corps.
- **Une responsabilité par module / fonction.** Limiter l'imbrication (≈ 3 niveaux),
  préférer les retours anticipés aux `else` profonds.

### Pas de « magic numbers » / « magic strings »
- Aucune valeur numérique non triviale en dur : la nommer en `const` en tête de
  module (ex. `const FOCUS_RADIUS = 3.2;`). Exceptions : `0`, `1`, `-1`, `2` quand
  le sens est évident.

### Types & lisibilité
- `strict` activé ; **pas de `any`** (préférer `unknown` + rétrécissement).
- Typer les frontières (API, fonctions exportées). Réutiliser les types Drizzle
  (`$inferSelect`) et partagés (`web/src/types.ts`).
- Commenter le *pourquoi*, pas le *quoi*. Pas de code commenté laissé en place.

### Fonctions pures et testabilité
- Isoler la logique pure (calculs, transformations) des effets de bord (DOM,
  réseau, base) — ex. `server/src/lib/*`, `web/src/graveAxes.ts`,
  `web/src/procedural.ts`, `web/src/ambiance.ts`.

---

## Tests (obligatoires)

Toute nouvelle fonctionnalité ou correction de bug s'accompagne de tests.

- **Unitaires (Vitest)** — fonctions pures, fichiers `*.test.ts` à côté du code.
- **Intégration (Vitest + `app.inject`)** — routes API ; ignorées proprement si la
  base est injoignable (`describe.skipIf`).
- **End-to-end (Playwright)** dans `e2e/` — parcours critiques (auth → menu →
  cimetière → rendu WebGL → ajout d'un collègue).
- Une **régression corrigée** est couverte par un test qui échouait avant le correctif.

### Definition of done

Avant de considérer une tâche terminée, **tout** doit passer :

```bash
pnpm typecheck     # 0 erreur de type (tsgo / tsc)
pnpm test          # tous les tests unitaires + intégration verts
pnpm build         # build de production sans erreur
pnpm e2e           # parcours e2e verts (nécessite la base + serveurs)
```

Ne jamais marquer une tâche terminée si un test échoue, si l'implémentation est
partielle, ou si le typecheck/build casse.

---

## Conventions

- **Français partout** : UI, commentaires et messages en français, avec accents
  corrects (jamais d'ASCII appauvri : « collègue », pas « collegue »).
- **Pas de dépendance superflue** : préférer une fonctionnalité native (SSE, CSS,
  contrainte SQL) à un nouveau package.
- **Migrations** : modifier `server/src/db/schema.ts` puis `pnpm db:generate`
  (diff offline, pas besoin de DB) ; ne pas éditer le SQL généré à la main.
  Casing **snake_case** côté DB, camelCase côté TS (configuré dans Drizzle).
- **SSE côté Fastify** : `reply.hijack()` puis écrire sur `reply.raw` ; nettoyer
  sur `request.raw.on("close")`.
- **Dispose Three.js** : libérer géométries **et** matériaux/textures lors des
  reconstructions de groupes.
- **HUD** : pas de framework ; `web/src/ui/*` manipule `index.html` par id.
  Échapper systématiquement le HTML injecté (`escapeHtml`).

## Génération d'images (gpt-image-2)

Le skill `gpt-image-2` est disponible pour générer des concepts visuels et assets.
Les images sont à sauvegarder dans `images/` à la racine du projet et commitées.

```bash
# Qualités disponibles : low | medium | high (pas standard/hd)
# Tailles : 1024x1024 | 1792x1024 | 1024x1792
curl -s --max-time 90 https://api.openai.com/v1/images/generations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"...","n":1,"size":"1024x1024","quality":"low"}' \
  -o /tmp/img.json && python3 -c '
import json,base64
d=json.load(open("/tmp/img.json"))
open("images/mon-concept.png","wb").write(base64.b64decode(d["data"][0]["b64_json"]))
'
# Utiliser le skill via : Skill("gpt-image-2", args="prompt...")
# Le script du skill utilise quality "standard/hd" (incorrect) — appeler curl directement.
```

## Conventions Git

- Branche de développement : `claude/3d-cemetery-web-app-71uxwr`.
- Messages de commit clairs et descriptifs (en français).
- Ne pas committer : `node_modules/`, `dist/`, `.env`, `test-results/`,
  `playwright-report/`, `pgdata/`. **Committer** les migrations (`server/drizzle/`).
