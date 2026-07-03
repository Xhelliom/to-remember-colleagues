# Mission 11 — Understory (fougères / arbustes / fleurs)

```yaml
id: 11-understory
depends_on: [08-arbres-grammaire]
blocks: []
parallel_with: [05-herbe-ring-lod, 07-dressing-deadfall, 09-arbres-cards-atlas]
owns:
  - web/src/scene/trees/understory.ts
  - web/src/scene/trees/understory.test.ts
  - e2e/understory.spec.ts
reads:
  - web/src/scene/trees/treeBuilder.ts
  - web/src/scene/trees/skeleton.ts
size: M
```

## Objectif
La couche intermédiaire herbe ↔ arbres qui manque à l'image : fougères, arbustes, fleurs —
depuis la **même grammaire** que les arbres. Thématique cimetière : lierre/fougères/fleurs
sauvages sur les tombes négligées.

## Référence LAAS
`vegetation/Understory.ts` : arbustes = arbres multi-tiges à params « bush » ; fougères =
rosettes de frondes captées ; fleurs = petits builders sur `MeshGrower`.

## Spécification technique
1. `understory.ts` : arbustes via `treeBuilder` avec params bush-tuned ; fougères/fleurs =
   builders dédiés sur le `MeshGrower` (mission 08).
2. Champs de densité : fougères **sous les couronnes**, fleurs **dans les trouées** (predicate
   de placement lié à la carte de canopée). Lierre/mousse rampante près des tombes négligées
   (lien `maintenance`, cf. 07).
3. Instancing + LOD (réutilise cards mission 09 pour les frondes lointaines).

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `understory.test.ts` : builders fougère/arbuste/fleur déterministes ; tri-budgets respectés.
- [ ] **placement** : prédicat « fougère sous couronne / fleur en trouée » vérifié sur cas connus.
### e2e (Playwright)
- [ ] `understory.spec.ts` : understory visible sous les arbres `?cam=…` → diff vs baseline < seuil.
- [ ] **perf** : `assertPerf({ minFps: 55 })` au framing sous-bois.
### Definition of done
- Gate commun vert ; strate intermédiaire présente et cohérente avec la canopée.

## Contraintes
Déterminisme. `dispose()`. Const nommées. Fichiers ≤ 500 lignes. Français.
