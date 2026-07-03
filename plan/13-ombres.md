# Mission 13 — Qualité des ombres (CSM + PCSS soft + cache de cascades)

```yaml
id: 13-ombres
depends_on: [04-herbe-geo-shader, 10-arbres-lod-impostors]
blocks: []
parallel_with: [12-depth-prepass, 14-post-ambiance-bookmarks]
owns:
  - web/src/scene/shadows.ts
  - web/src/scene/shadows.test.ts
  - e2e/shadows.spec.ts
reads:
  - web/src/scene/lighting.ts
  - web/src/cemetery.ts
size: M
```

## Objectif
Le cimetière est **saturé d'ombres d'arbres sur les tombes** — c'est là que le rendu se joue.
Ombres douces, jamais noires, et un cache de cascades pour tenir la perf.

## Référence LAAS
CSM 4 cascades + **PCSS** + contact shadows + `render/CsmCached.ts` (cascade re-render toutes N
frames car soleil quasi statique) + règle **anti-ombre-noire** (Pillar B).

## Spécification technique
1. `shadows.ts` : CSM via l'addon three.js (`examples/jsm`) sur le soleil ; **PCSS soft** (pénombre
   qui s'élargit avec la distance à l'occludeur) en shader d'ombre.
2. **Cache de cascades** : soleil bougeant peu entre deux éditions de ToD → re-render des cascades
   lointaines toutes N frames (staggered), refresh forcé sur mouvement du soleil.
3. Ambient plancher pour garantir la règle anti-ombre-noire (chroma minimal dans l'ombre).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `shadows.test.ts` : calcul des splits de cascades correct ; **prédicat d'invalidation du
      cache** (déclenche au mouvement du soleil, pas sinon).
### e2e (Playwright)
- [ ] `shadows.spec.ts` : golden hour, tombe sous arbre → `sampleShadowChroma` > seuil (**pas de noir**).
- [ ] **douceur** : largeur du gradient de pénombre > seuil (vs ombre dure) sur un bord d'ombre connu.
- [ ] **perf** : `__perf.fps(cache on) ≥ fps(cache off)` ; diff visuel cache on/off < seuil (identique).
### Definition of done
- Gate commun vert ; ombres douces et colorées ; cache sans artefact ; budget tenu.

## Contraintes
Honnête : CSM+PCSS est plus lourd en WebGL — **mesurer** et retomber sur `?preset=low` si besoin.
Const nommées (nb cascades, cadence de cache). `dispose()`. Français.
