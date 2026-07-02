# Mission 05 — Herbe « partout » : ring caméra + LOD

```yaml
id: 05-herbe-ring-lod
depends_on: [04-herbe-geo-shader]
blocks: []
parallel_with: [07-dressing-deadfall, 09-arbres-cards-atlas, 11-understory]
owns:
  - web/src/scene/grassRing.ts
  - web/src/scene/grassRing.test.ts
  - e2e/grass-ring.spec.ts
reads:
  - web/src/scene/grassBlade.ts
  - web/src/scene/worldStreamer.ts
  - web/src/scene/distanceLod.ts
size: M
```

## Objectif
Que l'herbe **suive la caméra** (dense près, jamais chauve loin) au lieu du champ fixe plafonné
20k par tranche — le « partout » de l'image.

## Référence LAAS
`vegetation/GroundRing.ts` : clipmap toroïdal centré caméra ; amincissement continu **conservé
par élargissement** (`largeur ∝ 1/√densité`) ; 3 bandes (clump 4-seg → 2-seg → tuft croisé loin) ;
crossfade **dither complémentaire** (IGN) = zéro pop.

## Spécification technique
1. `grassRing.ts` : grille toroïdale (cellule congruente la plus proche de la caméra), placement
   sur le sol à la volée ; se branche sur `worldStreamer.ts`.
2. Amincissement continu avec la distance, compensé par élargissement des brins (couverture constante).
3. 3 bandes LOD (géométries de mission 04 + `tuftGeometry` croisée loin) ; **crossfade dither
   complémentaire** (étend `distanceLod.ts`/hystérésis au fondu par pixel).
4. Culling frustum + distance côté cellule. Réutilise `exclude(x,z)`.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `grassRing.test.ts` : sélection de cellule toroïdale déterministe ; fonction
      d'amincissement **monotone décroissante** avec la distance ; couverture ≈ constante
      (intégrale densité×largeur² stable sur les bandes, à tolérance près).
### e2e (Playwright)
- [ ] `grass-ring.spec.ts` : deux poses (avancer de N m) → **couverture d'herbe en bande proche
      ≥ seuil aux deux poses** (l'herbe suit la caméra).
- [ ] **anti-pop** : diff entre frames adjacentes dans la zone de transition LOD < petit seuil.
- [ ] **perf** : `assertPerf({ maxDrawCalls_herbe: 3, minFps: 55 })` ; **pas de spike** au
      streaming (fps min sur une traversée continue ≥ seuil).
### Definition of done
- Gate commun vert ; herbe dense dans tout le champ de vision, transitions invisibles, budget tenu.

## Contraintes
`dispose()` au recyclage de cellules. Déterminisme (layout par cellule dérivé de la position).
Const nommées (`GRASS_CELL`, bandes, caps). Français.
