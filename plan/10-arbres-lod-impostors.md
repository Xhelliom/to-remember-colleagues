# Mission 10 — Arbres : LOD hero/cards/impostors + canopy shell + intégration

```yaml
id: 10-arbres-lod-impostors
depends_on: [09-arbres-cards-atlas]
blocks: [13-ombres, 14-post-ambiance-bookmarks]
parallel_with: []
owns:
  - web/src/scene/trees/impostors.ts
  - web/src/scene/trees/impostors.test.ts
  - web/src/scene/trees/treeLod.ts
  - web/src/scene/trees/canopyShell.ts
  - e2e/forest.spec.ts
reads:
  - web/src/scene/vegetation.ts
  - web/src/scene/worldStreamer.ts
  - web/src/scene/distanceLod.ts
size: L
```

## Objectif
Passer d'« un bel arbre » à « une forêt » sans exploser : chaîne LOD hero→cards→impostors +
canopy shell lointain, branchée sur le placement et le streaming existants.

## Référence LAAS
`vegetation/Impostors.ts` (octaédrique 8×8, albedo+normal+depth, blend des 3 vues proches) ·
`ImpostorRuntime.ts` · `world/CanopyShell.ts` (forêts lointaines en surface agrégée) ·
crossfade dither complémentaire.

## Spécification technique
1. `impostors.ts` : capture 8×8 vues hémi-octaédriques (RenderTarget WebGL) → 2 atlas ; matériau
   qui blende les 3 vues proches (yaw/tint par instance).
2. `treeLod.ts` : hero (≤~30 m) → cards R1 → cards R2 → impostor, **même crossfade dither** que
   l'herbe (étend `distanceLod.ts`). Instancing par (espèce, bande) ; culling frustum+distance CPU.
3. `canopyShell.ts` : forêts lointaines en surface bosselée éclairée (dither-in derrière les impostors).
4. **Intégration** : `vegetation.ts` + `worldStreamer.ts` consomment la source procédurale
   derrière un flag par biome ; comparer A/B vs GLTF (harness), basculer si meilleur ET plus rapide.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `impostors.test.ts` : mapping direction→tuile correct pour les directions cardinales ;
      poids du blend des 3 vues somment à 1 ; sélection de bande LOD par distance monotone.
### e2e (Playwright)
- [ ] `forest.spec.ts` : framing forêt → les arbres lointains sont des **impostors** (drawCalls &
      tris bornés) ; diff vs baseline < seuil.
- [ ] **anti-pop** : traversée → diff entre frames aux frontières LOD < petit seuil (dither).
- [ ] **perf** : `assertPerf({ maxDrawCalls: 200, minFps: 55 })` au forest-hero ; la majorité des
      arbres visibles = 1 quad impostor.
### Definition of done
- Gate commun vert ; forêt dense à l'horizon, transitions invisibles ; GLTF arbre retirable du chemin défaut.

## Contraintes
Jamais de hero instancié en masse. Capture d'impostor au boot. `dispose()`. Déterminisme.
Const nommées (rayons de bande, `IMPOSTOR_VIEWS`…). Français.
