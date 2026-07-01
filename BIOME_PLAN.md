# Plan — Mini Biome Cimetière

Objectif : chaque parcelle de cimetière est un mini biome beau et performant.
Relief procédural · herbe GPU animée · sol multi-texture · arbres instanciés.

---

## Contexte technique

- Three.js 0.185, WebGL (pas WebGPU pour l'instant)
- Parcelle ≈ 20×20 m, chargée « à vue » dans le monde continu
- Assets GLTF Poly Haven déjà en place dans `web/public/models/`
- Fichiers concernés : `web/src/scene/grass.ts`, `web/src/cemetery.ts`

### Assets disponibles

```
models/grass/    grass_bermuda_01_2k · grass_medium_01_2k · grass_medium_02_2k
textures/ground/   moss_01_2k · celandine_01_2k · snow_01/02/03_2k
                 forest_ground_04_2k · rocky_trail_2k
models/rock/     rock_01_2k
textures/rock/   marble_rock_01_2k
models/tree/     island_tree_02_2k · tree_small_02_4k
models/branch/   dry_branches_medium_01_2k
```

### Karma → biome (règle actuelle, à affiner)

| karma        | herbe (touffes) | sol tuilé             |
|--------------|-----------------|-----------------------|
| ≥ 5          | bermuda         | —                     |
| 0 … 4        | medium_01       | —                     |
| -5 … -1      | medium_02       | —                     |
| < -5         | —               | forest_ground_04      |
| hiver        | —               | snow_01/02/03         |

---

## Phase 1 — Herbe GPU instanciée + vent [x]

**Objectif** : remplacer les `clone()` GLTF actuels (80 draw calls) par un seul
`InstancedMesh` avec `ShaderMaterial` animé. Impact perf + visuel maximum.

### Tâches

- [ ] **1.1** Supprimer `buildCemeteryGrass` actuel (clones GLTF) dans `grass.ts`
- [ ] **1.2** Créer `GrassField` dans `web/src/scene/grassField.ts`
  - Géométrie blade : 5 vertices (strip effilé), vertex color top=[1,1,1] / bas coloré
  - `InstancedMesh(bladeGeo, mat, MAX_BLADES)` avec frustum culling manuel (`count` mis à jour chaque frame)
  - Positions XZ déterministes (seededRandom depuis companyId), rotation Y aléatoire
- [ ] **1.3** `ShaderMaterial` wind (3 layers) :
  - Layer 1 : `sin(uTime * speed) * vColor.r`  — balancement global
  - Layer 2 : `sin(uTime * speed + position.x * phase)` — rafale par lame
  - Layer 3 : `texture2D(uNoise, uv + uTime * scroll).r` — turbulence spatiale
  - Alpha cutout (discard si alpha < 0.5), double-side
- [ ] **1.4** Intégrer `GrassField` dans `cemetery.ts` : créer/dispose avec le cimetière
- [ ] **1.5** Conserver `buildCemeteryGroundPlane` (sol tuilé) — inchangé
- [ ] **1.6** Typecheck + test visuel (lancer `pnpm dev`)

**Fichiers touchés** : `grass.ts` · nouveau `grassField.ts` · `cemetery.ts`

---

## Phase 2 — Relief terrain procédural [x]

**Objectif** : chaque parcelle a un sol légèrement ondulé (FBM déterministe).
Les tombes, l'herbe et les arbres se posent sur le terrain réel.

### Tâches

- [ ] **2.1** Créer `web/src/scene/terrain.ts` — `TerrainChunk` class
  - `PlaneGeometry(size, size, 64, 64)` → déformer les vertices Y en CPU via FBM
  - Graine FBM = `hashSeed(companyId + ":terrain")` → déterministe
  - Amplitude max 0.8 m, fréquence douce (cimetière, pas montagne)
  - Exposer `getHeightAt(x, z): number` (interpolation bilinéaire sur la grille)
- [ ] **2.2** Mettre à jour `GrassField` : lire `getHeightAt` pour caler les lames sur le terrain
- [ ] **2.3** Mettre à jour `buildCemeteryGraves` : `grave.position.y = terrain.getHeightAt(x, z)`
- [ ] **2.4** Mettre à jour `buildCemeteryGroundPlane` : remplacé par `TerrainChunk` (le plan tuilé devient le matériau du terrain)
- [ ] **2.5** Typecheck + test visuel

**Fichiers touchés** : nouveau `terrain.ts` · `grassField.ts` · `cemetery.ts` · `grass.ts`

---

## Phase 3 — Sol multi-texture (splat map) [x]

**Objectif** : le sol du terrain mélange jusqu'à 4 matériaux PBR selon le karma
et la position (herbe dense au centre, terre/mousse en bordure).

### Tâches

- [ ] **3.1** Générer une splat texture RGBA (Float32Array 64×64) côté CPU :
  - R = herbe principale (karma-dépendant)
  - G = terre nue (zones autour des tombes)
  - B = rocher/mousse (bord parcelle ou karma < -5)
  - A = neige (hiver)
  - Valeurs interpolées doucement (pas de frontières dures)
- [ ] **3.2** Écrire le `ShaderMaterial` terrain avec splat :
  - Uniforms : `uSplat` (DataTexture RGBA), + 4 paires `uDiffuseN`/`uNormalN`
  - Fragment : `mix(tex1, tex2, splat.r)` etc. + normal mapping combiné
  - Rester sous 12 textures actives (limite safe WebGL)
- [ ] **3.3** Les textures PBR des GLTF Poly Haven (`_diff`, `_nor_gl`, `_arm`) sont extraites
  et réutilisées dans ce shader (pas de chargement supplémentaire)
- [ ] **3.4** Typecheck + test visuel (3 karmas : bon / neutre / mauvais)

**Fichiers touchés** : `terrain.ts` · potentiellement nouveau `splatMaterial.ts`

---

## Phase 4 — Arbres & rochers instanciés [ ]

**Objectif** : peupler la parcelle avec des arbres et rochers GLTF via `InstancedMesh`.

### Tâches

- [ ] **4.1** Créer `buildTreeInstances(slot, terrain)` dans `decor.ts` ou nouveau `vegetation.ts`
  - Extraire la géométrie du premier mesh des GLTF `island_tree_02` / `tree_small_02`
  - `InstancedMesh` par variante (2 draw calls max pour les arbres)
  - Positions en bord de parcelle, déterministes, calées sur terrain
  - Variante (petits/grands) choisie par `hashSeed(companyId + ":trees")`
- [ ] **4.2** Éparpiller `rock_01` / `marble_rock_01` en accents décoratifs (5-10 rochers)
  - InstancedMesh unique, scale et rotation aléatoires
- [ ] **4.3** LOD simple : `mesh.count` réduit à 0 si la parcelle est hors `LOAD_RADIUS * 1.5`
- [ ] **4.4** Dispose propre dans `clearWorld`
- [ ] **4.5** Typecheck + test visuel

**Fichiers touchés** : `decor.ts` ou nouveau `vegetation.ts` · `cemetery.ts`

---

## Règles transversales (rappel)

- Fichier ≤ 500 lignes, fonction ≤ 50 lignes
- Pas de `Math.random()` dans la génération → `seededRandom(hashSeed(...))`
- Dispose géométries + matériaux + textures à chaque `clearWorld`
- `pnpm typecheck` + `pnpm test` verts avant de cocher une phase terminée
- Commenter le *pourquoi*, pas le *quoi*

---

## État global

```
Phase 1 — Herbe GPU instanciée + vent     [x] terminé
Phase 2 — Relief terrain procédural       [x] terminé
Phase 3 — Sol multi-texture (splat map)   [x] terminé
Phase 4 — Arbres & rochers instanciés     [ ] non démarré
```
