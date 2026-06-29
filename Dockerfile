# ── Étape 1 : dépendances ─────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json ./web/
COPY server/package.json ./server/

RUN pnpm install --frozen-lockfile

# ── Étape 2 : build du client Vite ────────────────────────────────────────────
FROM deps AS build-web

COPY web/ ./web/

RUN pnpm --filter web build

# ── Étape 3 : build du serveur Fastify ────────────────────────────────────────
FROM deps AS build-server

COPY server/ ./server/

RUN pnpm --filter server build

# ── Étape 4 : dépendances de production uniquement ────────────────────────────
FROM deps AS prod-deps

RUN pnpm --filter server --prod deploy /prod/server

# ── Étape 5 : image de production ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Dépendances de production
COPY --from=prod-deps /prod/server/node_modules ./node_modules

# Serveur compilé
COPY --from=build-server /app/server/dist ./dist

# Assets du client (servis par @fastify/static)
COPY --from=build-web /app/web/dist ./public

# Migrations Drizzle (appliquées au démarrage si besoin)
COPY --from=build-server /app/server/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=3300
ENV STATIC_DIR=/app/public

EXPOSE 3300

CMD ["node", "dist/index.js"]
