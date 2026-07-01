# Plan — Layout organique d'un cimetière

Objectif : remplacer le plan carré actuel (`grid`/`rows`/`rings` dans `procedural.ts`)
par un **chemin en terre ramifié**, largeur fixe (juxtaposable le long de la route),
longueur proportionnelle au nombre de tombes, avec des clusters à mini-biome en
bout de ramification et un mur d'enceinte. Streaming interne : seule l'entrée se
charge à l'approche, le reste au franchissement du mur (occulteur, comme la forêt
entre cimetières).

---

## Contexte technique

- Logique pure (testable seule, sans Three.js) : `web/src/procedural.ts`,
  `web/src/worldLayout.ts`. Effets de bord (Three.js) : `web/src/scene/terrain.ts`,
  `web/src/cemetery.ts`.
- Le cimetière actuel est un **carré** unique (`plotHalf`), un seul `TerrainChunk`,
  chargé d'un coup à l'approche (`loadCemetery` dans `cemetery.ts`).
- `worldLayout.ts` utilise `plotHalf` à la fois pour l'offset latéral hors-route et
  pour les bornes du monde — dépendance à casser proprement (phase 2).
- Voir mémoire `world-streaming-roadmap` : le chunking **inter**-cimetières (phase 2
  du monde continu) est un axe séparé, orthogonal à ce plan (chunking **intra**-cimetière).

---

## Phase 0 — Terrain FBM invariant à la taille (prérequis chunking) [x]

**Objectif mesurable** : la hauteur en un point monde `(x, z)` donné est identique
quelle que soit la longueur totale du cimetière au moment du calcul — ajouter une
tombe qui rallonge le chemin ne modifie **aucun** vertex déjà généré.

**Test associé** : `web/src/scene/terrain.test.ts` (nouveau)
- même `(seed, x, z)` → même hauteur, appelé avec deux `plotWidth`/longueurs
  simulées différentes → résultat identique (invariance)
- continuité à la jointure entre deux tranches contiguës (pas de saut > epsilon)

### Tâches
- [x] **0.1** Extraire la fonction FBM en fonction **pure et exportée**
  (`terrainHeightAt(seed, worldX, worldZ)`), échantillonnée en coordonnées monde
  fixes — plus de normalisation par `size`/`plotHalf`
- [x] **0.2** Seed unique par cimetière (`hashSeed(companyId + ":terrain")`), pas
  par chunk
- [x] **0.3** Fondu de bordure : ne s'applique qu'aux vrais bords extérieurs
  (largeur fixe du chemin + fin du chemin), jamais aux jointures internes
- [x] **0.4** `TerrainChunk` et `getHeightAt` utilisent la fonction pure en interne
- [x] **0.5** Typecheck + test

**Fichiers touchés** : `scene/terrain.ts`, nouveau `scene/terrain.test.ts`

---

## Phase 1 — Chemin ramifié pur (algorithme) [x]

**Objectif mesurable** : pour un `companyId` + `count` donnés, génère exactement
`count` placements, déterministe (même entrée → même sortie), dans un couloir de
largeur bornée `plotWidth`.

**Test associé** : `web/src/procedural.test.ts` (existant, à étendre)
- déterminisme : deux appels identiques → même résultat
- `placements.length === count` pour plusieurs valeurs de `count` (0, 1, petit, grand)
- tous les placements respectent `|x| <= plotWidth / 2`
- distance mini entre deux tombes respectée (pas de chevauchement)
- aucune branche ne s'approche d'une autre branche/de l'épine à moins de sa
  largeur de couloir (voir 1.2bis — pas de vraie détection de collision)
- ratio rangées/clusters dans la plage attendue (test statistique large)

### Tâches
- [x] **1.1** Chemin principal : avance en `z` depuis l'entrée (`z = 0`), pas
  variable tiré de la seed
- [x] **1.2** Ramification tous les N pas (N tiré de la seed) : angle léger,
  se termine en **rangée** (tombes le long du segment) ou **cluster** (rond-point +
  groupe de tombes), choix tiré de la seed
- [x] **1.2bis** Empêcher le croisement de branches **par construction**, pas par
  détection de collision : portée max par branche + écart minimum entre deux
  points de ramification successifs sur l'épine (le chemin principal, 1.1),
  calés pour qu'aucune branche ne puisse géométriquement atteindre une autre
  branche ou l'épine
- [x] **1.3** `clusterRatio` tiré de la seed (plage à caler en dev, ex. 0.25–0.6) —
  répartit `count` entre rangées et clusters
- [x] **1.4** Arrêt dès que les `count` tombes sont placées (pas de ramification
  surnuméraire)
- [x] **1.5** `plotWidth` légèrement variable (même mécanique que `spacing`
  actuel : base + jitter tiré de la seed)
- [x] **1.6** Chaque placement porte son index de **chunk** (segment/cluster
  d'appartenance) pour les phases 3 et 5 — la règle de regroupement (ex. une
  tranche toutes les 4 ramifications) est décidée **ici**, pas en phase 3 qui ne
  fait que la consommer
- [x] **1.7** Typecheck + test

**Fichiers touchés** : `procedural.ts`, `procedural.test.ts`

---

## Phase 2 — Adapter `worldLayout.ts` (largeur/longueur réelles) [x]

**Objectif mesurable** : deux cimetières adjacents le long de la route ne se
chevauchent jamais, quelle que soit leur `plotWidth`/longueur respective.

**Test associé** : `web/src/worldLayout.test.ts` (existant, à étendre)
- pour un jeu de cimetières aux tailles variées (générées), les emprises
  latérales de deux slots consécutifs ne s'intersectent jamais
- bornes du monde (`bounds`) englobent toujours tous les slots

### Tâches
- [x] **2.1** Remplacer `plotHalf` scalaire par `plotWidth`/`plotDepth` distincts
  dans `WorldSlot`
- [x] **2.2** `STATION_STEP` fixe → pas adaptatif : accumulation à partir de
  `plotWidth/2` du slot courant + suivant + marge
- [x] **2.3** Bornes du monde (`bounds`) recalculées à partir de l'emprise réelle
  (largeur fixe × longueur dynamique, après rotation `rotY`)
- [x] **2.4** Refaire le test "suis-je dans l'emprise" (`nearestId` dans
  `updateStreaming()`) : le calcul actuel (`Math.hypot(plotCenter → caméra) <
  plotHalf + NEAR_MARGIN`, `cemetery.ts:281`) suppose un footprint compact ; sur
  un couloir allongé le centre géométrique peut être loin de l'entrée. Remplacer
  par un containment en coordonnées locales (projection via `rotY`, `|localX| <
  plotWidth/2 && 0 <= localZ <= plotDepth`)
- [x] **2.5** Typecheck + test

**Fichiers touchés** : `worldLayout.ts`, `worldLayout.test.ts`, `cemetery.ts` (usages de `plotHalf`, `nearestId`)

---

## Phase 3 — Terrain en chunks + clôture par segment [x]

**Objectif mesurable** : un cimetière de N chunks se construit comme N meshes de
terrain indépendants, visuellement sans couture (validation visuelle) ; la clôture
suit le contour réel du chemin (pas un rectangle).

**Test associé** : visuel (`pnpm dev`, marcher le long d'une jointure de chunk,
aucune marche visible) — la continuité numérique est déjà couverte par le test de
la phase 0.

### Tâches
- [x] **3.1** `TerrainChunk` découpé en tranches suivant la règle de regroupement
  décidée en 1.6 (ex. une tranche toutes les 4 ramifications) — chaque tranche =
  un mesh, géométrie construite via `terrainHeightAt` (phase 0)
- [x] **3.1bis** `GrassField`/`VegetationInstances` découpés selon le **même**
  regroupement par chunk (actuellement construits pour toute la parcelle d'un
  coup, dimensionnés sur `plotHalf`) — sinon la Phase 5 ne réduit rien sur
  l'herbe/la végétation ambiantes
- [x] **3.2** Clôture (`WallType = "haie" | "cloture" | "mur"`, un seul type câblé
  pour l'instant) : segments extrudés le long de chaque tronçon de chemin et
  autour de chaque cluster, offset `±plotWidth/2` (même transfo que le placement
  des tombes)
- [x] **3.3** Dispose propre (géométrie + matériaux) dans `clearWorld`
- [x] **3.4** Typecheck + test visuel

**Fichiers touchés** : `scene/terrain.ts`, `scene/grassField.ts`, `scene/vegetation.ts`, nouveau `scene/fence.ts`, `cemetery.ts`

---

## Phase 4 — Élément caractéristique par cluster (mini-biome) [x]

**Objectif mesurable** : chaque cluster affiche un prop caractéristique tiré de la
seed (méga-arbre / rocher-falaise / plat), reconnaissable visuellement à l'approche.

**Test associé** : `procedural.test.ts` — le type de prop par cluster est
déterministe (même seed → même choix) ; visuel pour le rendu (`pnpm dev`).

### Tâches
- [x] **4.1** Tirage du type de prop par cluster dans la logique pure (phase 1),
  pas de nouvel asset — réutilise `island_tree_02`/`tree_small_02` (méga-arbre,
  scale disproportionnée) et `rock_01`/`marble_rock_01` (empilement = fausse
  falaise) — `marble_rock_01` absent des assets, `rock_01` réutilisé seul
- [x] **4.2** Placement du prop au centre du cluster (posé sur le terrain via
  `terrainHeightAt`), instance dédiée dans `vegetation.ts` ou nouveau module
- [x] **4.3** Dispose propre
- [x] **4.4** Typecheck + test visuel

**Fichiers touchés** : `procedural.ts`, `scene/vegetation.ts` (ou nouveau), `cemetery.ts`

---

## Phase 5 — Streaming intra-cimetière (charge/décharge progressif) [x]

**Objectif mesurable** : à l'approche (`LOAD_RADIUS` extérieur), seul le chunk
d'entrée est construit. Une fois l'emprise franchie (2.4), les chunks suivants se
chargent **progressivement** par proximité individuelle (même mécanique que le
streaming inter-cimetières de `updateStreaming()`, une fois niveau plus bas) —
pas tout d'un coup. Les chunks laissés loin derrière sont **déchargés**
(dispose), avec une marge d'hystérésis pour ne jamais osciller charge/décharge à
la frontière. Aucun appel réseau (les collègues sont déjà en mémoire).

**Test associé** : fonctions pures extraites `chunksToLoad`/`chunksToUnload(cameraPos, slot, chunks)`
- hors `LOAD_RADIUS` → aucun chunk
- dans `LOAD_RADIUS`, hors emprise du cimetière → seulement le chunk 0 (entrée)
- dans l'emprise, un chunk se charge dès que la caméra entre dans son propre
  rayon de proximité (pas besoin des autres chunks pour se charger)
- un chunk quitté au-delà de `UNLOAD_RADIUS` (> `LOAD_RADIUS`, marge
  d'hystérésis) est proposé au déchargement ; aucun chunk entre `LOAD_RADIUS` et
  `UNLOAD_RADIUS` n'oscille (test : séquence de positions aller-retour à la
  frontière → pas de charge/décharge répétée)
- recharger un chunk précédemment déchargé donne un résultat identique
  (déterminisme, aucune perte d'état puisque les collègues restent en mémoire)

### Tâches
- [x] **5.1** Extraire `chunksToLoad` en fonction pure testable : chunk 0 sur
  seuil `LOAD_RADIUS` extérieur, chunks suivants sur proximité individuelle une
  fois l'emprise franchie (2.4)
- [x] **5.2** Extraire `chunksToUnload` en fonction pure testable : chunks hors
  `UNLOAD_RADIUS` (> `LOAD_RADIUS`, marge d'hystérésis nommée en constante)
- [x] **5.3** `Map<string, ChunkMeshes>` `loadedChunks` (clé `` `${companyId}:${chunkIndex}` ``)
  pour retrouver les meshes (terrain, herbe, végétation, tombes, clôture) d'un
  chunk à décharger — pas de `loadingCount`/Promise, construction/dispose
  synchrones (pas de réseau) — les tombes sont gérées via un tag `chunk` sur
  chaque grave plutôt que dans `ChunkMeshes`, réutilisant le mécanisme existant
- [x] **5.4** Brancher `chunksToLoad`/`chunksToUnload` dans `updateStreaming()`
  (extrait dans `scene/worldStreamer.ts` pour rester sous 500 lignes)
- [x] **5.5** Dispose d'un chunk déchargé : réutilise `disposeObject` existant
  sur l'ensemble de ses meshes (terrain, grass, veg, tombes, clôture)
- [x] **5.6** Typecheck + test

**Fichiers touchés** : `cemetery.ts`, `scene/terrain.ts`, `scene/grassField.ts`,
`scene/vegetation.ts`, `scene/fence.ts`, nouveau test pur pour
`chunksToLoad`/`chunksToUnload`

---

## Hors scope (pour l'instant)

- Sélecteur de type de mur (UI/règles de choix) — un seul type câblé en dur, le
  champ `WallType` existe pour brancher les autres plus tard
- Vraie géométrie de falaise (déformation du terrain) — un empilement de rochers
  suffit visuellement, garde `terrain.ts` simple

---

## Règles transversales (rappel)

- Fichier ≤ 500 lignes, fonction ≤ 50 lignes
- Pas de `Math.random()` dans la génération → `seededRandom(hashSeed(...))`
- Dispose géométries + matériaux + textures à chaque `clearWorld`
- `pnpm typecheck` + `pnpm test` verts avant de cocher une phase terminée
- Logique pure isolée des effets de bord (Three.js, réseau) → testable sans DOM
- Cocher les cases `[ ]` → `[x]` (tâches puis phase) au fur et à mesure du dev,
  et mettre à jour le tableau « État global » en fin de phase

---

## État global

```
Phase 0 — Terrain FBM invariant à la taille       [x] fait
Phase 1 — Chemin ramifié pur (algorithme)         [x] fait
Phase 2 — Adapter worldLayout.ts                  [x] fait
Phase 3 — Terrain en chunks + clôture             [x] fait
Phase 4 — Élément caractéristique par cluster     [x] fait
Phase 5 — Streaming intra-cimetière (charge/décharge) [x] fait
```
