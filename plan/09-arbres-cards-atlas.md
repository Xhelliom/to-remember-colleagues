# Mission 09 — Arbres : feuillage cluster-cards + capture d'atlas

```yaml
id: 09-arbres-cards-atlas
depends_on: [08-arbres-grammaire]
blocks: [10-arbres-lod-impostors, 12-depth-prepass]
parallel_with: [05-herbe-ring-lod, 07-dressing-deadfall, 11-understory]
owns:
  - web/src/scene/trees/foliageCards.ts
  - web/src/scene/trees/foliageCards.test.ts
  - web/src/scene/trees/atlasCapture.ts
  - e2e/tree-cards.spec.ts
reads:
  - web/src/scene/trees/treeBuilder.ts
  - web/src/scene/trees/leafMesh.ts
size: L
```

## Objectif
LE « propre » : un spray de vraies feuilles rendu **une fois** en atlas, puis posé en grandes
cartes alpha-testées aux ancres. Une carte = tout un cluster à 2-4 tris = volume de couronne pas cher.

## Référence LAAS
`vegetation/FoliageCards.ts` — « le look ez-tree, zéro asset ». Les 3 détails du propre :
albedo **encodé sqrt**, **dilatation du fond** (zéro halo noir dans les mips), alpha-test.

## Spécification technique
1. `atlasCapture.ts` : rendre le spray (mission 08 `leafMesh`) dans un `WebGLRenderTarget` →
   atlas 2×2 par espèce. Albedo écrit **sqrt-encodé** (le 8-bit linéaire massacre les verts sombres).
2. **Dilatation du fond sur CPU** avant génération des mips → pas de halo noir. Décodage sqrt au shader.
3. `foliageCards.ts` : poser les cartes aux ancres de foliage ; `alphaToCoverage = true` (+ MSAA
   déjà actif via `antialias:true`). Mode hybride hero (cards + vraies feuilles) au plus près.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `foliageCards.test.ts` : sqrt encode/decode round-trip < tolérance ; l'atlas capturé est
      non vide (couverture alpha > 0) ; **dilatation** — aucun texel sombre adjacent à du
      transparent (test anti-halo sur l'atlas).
- [ ] nb de cartes déterministe par (espèce, seed).
### e2e (Playwright)
- [ ] `tree-cards.spec.ts` : arbre en cards vs hero → **couverture de silhouette à tolérance près**
      (le feuillage ne « maigrit » pas) ; diff vs baseline < seuil.
- [ ] **anti-halo** : échantillons pixel en bord de couronne → chroma/luminance sans liseré noir.
- [ ] **perf** : arbre mid en cards → tris ≤ budget (ordre de grandeur d'un GLTF décimé, pas brut) ; `minFps: 55`.
### Definition of done
- Gate commun vert ; couronnes pleines, bords propres, verts sombres préservés.

## Contraintes
Capture au boot (pas par frame). `dispose()` des RT/atlas si régénérés. Déterminisme. Const
nommées (`ATLAS_RES`…). Français.
