# Mission 06 — Pierre procédurale + tombes altérées (#25)

```yaml
id: 06-pierre-tombes
depends_on: [01-harness, 03-noise-bake]
blocks: [07-dressing-deadfall]
parallel_with: [04-herbe-geo-shader, 08-arbres-grammaire]
owns:
  - web/src/scene/stone.ts
  - web/src/scene/stone.test.ts
  - web/src/graveStone.ts
  - web/src/graveStone.test.ts
  - e2e/gravestone.spec.ts
reads:
  - web/src/graveAxes.ts
  - web/src/scene/noiseBake.ts
size: L
```

## Objectif
Générateur de roche procédurale, **et surtout** des **stèles usées/fissurées/moussues pilotées
par `maintenance` et `votes`** — le cœur thématique (#25). Remplace aussi les rochers GLTF.

## Référence LAAS
`vegetation/RockBuilder.ts` : icosphère soudée → squash → warp macro → **strates** inclinées →
crêtes → **coupes de fracture** (silhouettes craquelées) → grain micro. `vdata` : `hue`,
`strataT`, `moss/lichen openness`, `cavity AO` — **ces deux derniers alimentent le dressing (07)**.

## Spécification technique
1. `stone.ts` : `buildRock(params, seed)` (icosphère soudée + champ en couches, bruit **baké**
   mission 03) ; sortie `vdata` par sommet (hue, strataT, cavityAO, mossOpenness) ; LODs par
   sous-division du **même** champ (silhouette cohérente).
2. `graveStone.ts` : `buildGravestone(axes, seed)` où `axes` vient de `graveAxes.ts` (âge/votes/
   maintenance). Bas `maintenance` → plus de fractures, plus de `mossOpenness`, arêtes érodées.
   `votes` (hanté↔paradisiaque) module la teinte/l'altération. Se branche sur le pipeline
   `graves.ts` existant (les 3 axes).
3. Instancing pour les rochers de décor (remplace `ROCK_DENSITY` GLTF dans `vegetation.ts`).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `stone.test.ts` : `buildRock` tri-count ∈ [min,max] ; déterministe ; `vdata` ∈ [0,1] ;
      LOD bas garde la silhouette (bbox à tolérance près du LOD haut).
- [ ] `graveStone.test.ts` : **monotonie** — `maintenance` ↓ ⇒ agrégat `mossOpenness` ↑ et
      nb de fractures ↑ (mesurable sur le champ) ; même (axes, seed) → géométrie identique.
- [ ] `votes` extrême hanté vs paradisiaque → paramètres d'altération distincts.
### e2e (Playwright)
- [ ] `gravestone.spec.ts` : rendu d'une tombe `maintenance=1` vs `maintenance=0` → **diff visible > seuil**.
- [ ] déterminisme : même (axes, seed) → PNG identiques.
- [ ] **perf** : `assertPerf({ minFps: 55 })` sur un cimetière peuplé de stèles procédurales ;
      tri-budget par stèle respecté.
### Definition of done
- Gate commun vert ; l'état d'entretien/karma d'une tombe est **lisible à l'œil** ; rochers GLTF retirables.

## Contraintes
Déterminisme strict (dérive de l'id d'organisation + graine de tombe existants). `dispose()`.
Const nommées. Réutilise le bruit baké (pas de bruit live/px). Français.
