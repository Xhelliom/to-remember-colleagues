# Mission 12 — Depth prepass pour la végétation alpha-testée

```yaml
id: 12-depth-prepass
depends_on: [04-herbe-geo-shader, 09-arbres-cards-atlas]
blocks: []
parallel_with: [10-arbres-lod-impostors, 13-ombres, 14-post-ambiance-bookmarks]
owns:
  - web/src/scene/vegPrepass.ts
  - web/src/scene/vegPrepass.test.ts
  - e2e/prepass.spec.ts
reads:
  - web/src/scene/grassField.ts
  - web/src/scene/trees/foliageCards.ts
size: M
```

## Objectif
Tuer l'overdraw de l'herbe et des cards (2-8× shading par pixel) sans **aucun** changement
visuel — le classique « prepass profondeur puis couleur en depthFunc=EQUAL ».

## Référence LAAS
`render/VegPrepass.ts` : rasteriser la MÊME géométrie depth-only d'abord, puis passe couleur en
`depthFunc=EQUAL` → le shading complet s'exécute **une fois par pixel visible**.

## Spécification technique
1. `vegPrepass.ts` : pour l'herbe (04) et les cards (09), créer un jumeau depth-only partageant
   **exactement** la même logique de position/mask/alphaTest.
2. Passe couleur configurée en `depthFunc=EQUAL`, prepass rendu avant (renderOrder).
3. Flag `?prepass=0|1` pour l'A/B.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `vegPrepass.test.ts` : le matériau prepass partage la même expression de discard
      (mask/alphaTest) que le matériau couleur — même entrée → même décision de discard.
### e2e (Playwright)
- [ ] `prepass.spec.ts` : `?prepass=0` vs `?prepass=1` → **image pixel-équivalente** (diff < très
      petit seuil) — c'est le critère de correction (pas de trou vers le ciel).
- [ ] **gain mesurable** : `__perf.fps(prepass=1) ≥ __perf.fps(prepass=0)` (ou draws/overdraw
      proxy en baisse) au framing prairie **et** forêt dense.
### Definition of done
- Gate commun vert ; même image, meilleure perf ; prepass activé par défaut.

## Contraintes
⚠️ Correctness : un fragment écrit en profondeur mais discardé en couleur bloque le ciel → les
deux passes DOIVENT discarder pareil. `dispose()`. Français.
