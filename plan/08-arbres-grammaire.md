# Mission 08 — Arbres : grammaire procédurale (squelette → tubes → feuilles)

```yaml
id: 08-arbres-grammaire
depends_on: [01-harness, 02-vent, 03-noise-bake]
blocks: [09-arbres-cards-atlas, 11-understory]
parallel_with: [04-herbe-geo-shader, 06-pierre-tombes]
owns:
  - web/src/scene/trees/skeleton.ts
  - web/src/scene/trees/skeleton.test.ts
  - web/src/scene/trees/tubeMesh.ts
  - web/src/scene/trees/leafMesh.ts
  - web/src/scene/trees/treeBuilder.ts
  - web/src/scene/trees/treeBuilder.test.ts
  - e2e/tree-hero.spec.ts
reads:
  - web/src/scene/wind.ts
  - web/src/scene/noiseBake.ts
size: L
```

## Objectif
Premier arbre **100 % autogénéré, unique par instance** (prototype UNE espèce). Base des cards
(09) et de l'understory (11).

## Référence LAAS
`vegetation/Skeleton.ts` + `Species.ts` (tropismes, phyllotaxie, enveloppe de couronne,
asymétrie par compétition lumière) · `TubeMesh.ts` (`MeshGrower`) · `LeafMesh.ts` · `TreeBuilder.ts`.

## Spécification technique
1. `skeleton.ts` : `growSkeleton(species, seed)` déterministe (lean/âge/biais par instance).
   **Espèce de départ = un FEUILLU type hêtre** : enveloppe de couronne arrondie, ramification
   dense, phyllotaxie de feuilles (spirale/alterne). Plus exigeant qu'un conifère mais c'est là
   que le look cluster-cards (09) paie — couronne pleine.
2. `tubeMesh.ts` : squelette → tronc + branches maillés (rayon décroissant). LOD0 hero = hiérarchie complète.
3. `leafMesh.ts` : vraies **feuilles** (strips/lames) sur les ancres, groupées en sprays denses
   (servira la capture d'atlas en 09).
4. `treeBuilder.ts` : assemble `{ bark, foliageMesh, skeleton, stats }` ; écorce = matériau
   paramétrique (bruit **baké** mission 03, pas de texture externe).
5. Vent via `applyWind` (mission 02, pool arbre).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `skeleton.test.ts` : `growSkeleton` déterministe ; **unicité** — deux seeds → divergence
      positionnelle des nœuds > seuil (pas de clone) ; nb d'ancres dans la plage attendue.
- [ ] `treeBuilder.test.ts` : tri-count hero ∈ budget ; LOD bas < LOD haut ; bark+foliage non vides.
### e2e (Playwright)
- [ ] `tree-hero.spec.ts` : rendu d'un arbre hero `seed=1` → **diff vs baseline < seuil**.
- [ ] déterminisme : même seed → PNG identiques ; seeds différents → silhouettes différentes (diff > seuil).
- [ ] **perf** : un seul hero visible → `assertPerf({ minFps: 55 })` ; tri-budget hero respecté.
### Definition of done
- Gate commun vert ; un arbre unique et déterministe ; API `treeBuilder` stable pour 09.

## Contraintes
Hero lourd toléré **mais 1 seul visible** (le reste = cards/impostors en 09/10 — jamais
d'instanciation de masse du hero). Déterminisme. Const nommées. Fichiers ≤ 500 lignes
(d'où le sous-dossier `trees/`). Français.
