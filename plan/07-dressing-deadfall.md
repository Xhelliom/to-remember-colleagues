# Mission 07 — Dressing (mousse/lichen/coulures) + deadfall

```yaml
id: 07-dressing-deadfall
depends_on: [06-pierre-tombes]
blocks: []
parallel_with: [05-herbe-ring-lod, 09-arbres-cards-atlas, 11-understory]
owns:
  - web/src/scene/dressing.ts
  - web/src/scene/dressing.test.ts
  - web/src/scene/deadfall.ts
  - e2e/grave-dressing.spec.ts
reads:
  - web/src/graveStone.ts
  - web/src/graveAxes.ts
  - web/src/scene/noiseBake.ts
size: M
```

## Objectif
Habiller pierres/tombes/décor par mousse-lichen-coulures **pilotées par `upness + cavity`** et
par les axes de tombe (`maintenance`/`votes`) ; ajouter le deadfall (troncs, souches, champignons)
pour l'ambiance cimetière.

## Référence LAAS
`vegetation/Dressing.ts` (mousse/lichen/coulures par upness+cavity) · `Deadfall.ts` (troncs ×3
états de décomposition, souches, champignons).

## Spécification technique
1. `dressing.ts` : `dressingFor({ upness, cavity, maintenance, votes })` → paramètres de
   mousse/lichen/coulures. Mousse là où `cavity` haut & `upness` bas ; lichen sur faces exposées
   (`upness` haut) ; intensité ∝ (1 − `maintenance`). Consomme `vdata` de mission 06 + bruit baké.
2. Appliqué en shader sur `graveStone` et rochers (pas de nouvelle géométrie lourde : c'est du
   matériau + éventuels décalques instanciés légers).
3. `deadfall.ts` : troncs couchés / souches / champignons, états de décomposition déterministes.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `dressing.test.ts` : mousse maximale quand `cavity`↑ & `upness`↓ ; lichen quand `upness`↑ ;
      intensité globale **monotone décroissante** avec `maintenance` ; déterministe.
- [ ] deadfall : les états de décomposition sont énumérés et déterministes par graine.
### e2e (Playwright)
- [ ] `grave-dressing.spec.ts` : tombe `maintenance` haut vs bas → **différence mousse/coulures
      visible > seuil** ; même (axes, seed) → identique.
- [ ] **règle anti-ombre-noire** : tombes à l'ombre d'arbres → `sampleShadowChroma` > seuil (pas de noir).
### Definition of done
- Gate commun vert ; l'entretien/karma d'une tombe est lisible via l'habillage ; test pur du mapping vert.

## Contraintes
Pas d'explosion géométrique (privilégier le matériau). Déterminisme. `dispose()`. Const
nommées. Français.
