# Mission 04 — Herbe : géométrie blade-clump + shader (normale→terrain)

```yaml
id: 04-herbe-geo-shader
depends_on: [01-harness, 02-vent, 03-noise-bake]
blocks: [05-herbe-ring-lod, 12-depth-prepass, 13-ombres]
parallel_with: [06-pierre-tombes, 08-arbres-grammaire]
owns:
  - web/src/scene/grassBlade.ts
  - web/src/scene/grassBlade.test.ts
  - web/src/scene/grassField.ts
  - e2e/grass.spec.ts
reads:
  - web/src/scene/terrain.ts
  - web/src/scene/wind.ts
  - web/src/scene/noiseBake.ts
size: L
```

## Objectif
Remplacer les touffes GLTF de `grassField.ts` par de l'herbe **procédurale qui épouse le sol** :
géométrie multi-brins + normale de brin fondue vers la normale du terrain (le trick qui tue le
scintillement gris).

## Référence LAAS
`vegetation/GroundRing.ts` : `bladeClump` (N brins/instance = « lush »), normales
demi-cylindre (bords ±38°), **blend normale brin → normale terrain** (0.5 près → 1.0 loin),
gradient racine→pointe, lean anti-« maïs planté ».

## Spécification technique
1. `grassBlade.ts` : `bladeClump(blades, segs, seed)` — N brins fusionnés (yaw/offset/lean/
   hauteur variés, déterministe), normales demi-cylindre. Une géométrie par bande LOD.
2. `grassField.ts` : instancier ces clumps ; **attribut d'instance `instanceTerrainNormal`**
   calculé par **différences finies** sur `terrain.getHeightAt` à la pose du brin.
3. Shader (`onBeforeCompile`) : fondre `normale_brin → instanceTerrainNormal` (0.5→1.0 avec la
   distance) ; gradient albedo racine→pointe (frais→sec) + variance teinte/hauteur par instance ;
   vent via `applyWind` (mission 02 — API : `addWindWeightAttribute(geo, GRASS_WIND_POOL)` puis
   `applyWind(mat, { pool: GRASS_WIND_POOL })`, cf. `scene/wind.ts`).
   ⚠️ **Réconciliation** : l'utilisateur a commité `scene/windSway.ts` (ancien système ad-hoc) et
   allégé `grassField.ts` en parallèle. Cette mission migre `grassField` vers `wind.ts` **et
   supprime `windSway.ts`** (+ ses consommateurs, cf. `vegetation.ts`) une fois `08` aligné.
4. Conserver `exclude(x,z)` (pas d'herbe sur terre/allées/tombes) et `shouldHaveGrass`.

## Critères d'acceptation MESURABLES
### Unitaires (Vitest)
- [ ] `grassBlade.test.ts` : `bladeClump(n, s)` a `n·versParBrin` sommets ; normales normalisées ;
      déterministe (même seed → mêmes positions).
- [ ] normale terrain par diff. finies ≈ normale analytique sur une pente connue (erreur < tol).
- [ ] variance : deux seeds → layouts différents ; même seed → identique.
### e2e (Playwright)
- [ ] `grass.spec.ts` shot prairie `?cam=…&seed=1` → **diff vs baseline < seuil**.
- [ ] **anti-scintillement** : sur une pente, la luminance de l'herbe suit `sun·normaleTerrain`
      (échantillons pixel : chroma/variance sous seuil — pas de « sparkle gris »).
- [ ] **perf** : `assertPerf({ maxDrawCalls_herbe: 6, minFps: 55 })` au framing prairie.
- [ ] déterminisme : deux runs même seed → PNG identiques.
### Definition of done
- Gate commun vert ; l'herbe épouse le relief, ondule sans jitter, varie en couleur ; FPS ≥ ancien chemin.

## Contraintes
`dispose()` géo+mat au rebuild. Déterminisme (pas de `Math.random`). Const nommées
(`BLADE_SEGS`, `NORMAL_BLEND_NEAR/FAR`…). Fichiers ≤ 500 lignes (découper si besoin). Français.
