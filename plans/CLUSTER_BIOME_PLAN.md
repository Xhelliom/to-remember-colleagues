# Plan — Cluster biome visuel (effet cocooning)

Objectif : donner à chaque cluster de cimetière une identité visuelle forte —
chemin en terre, herbe haute sur les côtés, buissons derrière les tombes,
arbres en voûte créant un effet « cathédrale naturelle ».

Référence visuelle : `images/cluster-cocoon-concept.png` (généré via gpt-image-2).

---

## Contexte d'implémentation (pour session fraîche)

- `ClusterInfo` est dans `web/src/procedural.ts` — actuellement `{ x, z, chunk }`, à étendre
- `CLUSTER_RADIUS = 3` est une constante exportée de `procedural.ts`
- Pattern de chargement GLTF à réutiliser depuis `web/src/scene/vegetation.ts` :
  `loadGltf` (depuis `scene/grass.ts`), `extractSubMeshes`, `buildPlacementMatrices`
- Le dossier bush est `web/public/models/Bush/` (**B majuscule**)
- `jacaranda_tree_1k` est nouveau — pas encore référencé dans `vegetation.ts`
- `Frame` et `toWorld` viennent de `web/src/worldLayout.ts`
- `seededRandom` vient de `web/src/graves.ts`, `hashSeed` de `web/src/procedural.ts`

### Origine des valeurs numériques des layers (issues du brainstorm visuel)

Ces valeurs ne sont pas dans le code — elles viennent de l'analyse du concept image
`images/cluster-cocoon-concept.png` et sont à calibrer via la scène de test (étape 0) :

| Valeur | Raison |
|--------|--------|
| `rotation.x ≈ -0.12 rad` | Inclinaison des arbres vers le centre pour créer la voûte |
| Trees radius `CLUSTER_RADIUS + 4 m` | Suffisant pour entourer les tombes sans les masquer |
| Bushes radius `CLUSTER_RADIUS + 1.5 m` | Juste derrière les tombes (CLUSTER_RADIUS = 3) |
| 5–8 arbres en arc | Couverture angulaire ~270° sans trous ni surcharge |
| 8–12 buissons | Densité visuelle suffisante pour le mur vert |
| Scale arbres 2–3.5 | Canopée assez haute pour la voûte sans dépasser le budget GPU |
| Scale buissons 0.8–1.3 | Hauteur ~1–2 m, entre herbe et arbre |

### Caméra de la scène de test

Position matching le concept image : hauteur 1.7 m (hauteur d'œil), légèrement
surélevée et reculée à l'entrée du chemin, regardant vers le centre du cluster
(axe +Z local). En coords locales du cluster : `(0, 1.7, -6)` → `lookAt(0, 1, 0)`.

---

## Assets disponibles

| Rôle | Fichier |
|------|---------|
| Buisson dense | `Bush/didelta_spinosa_2k` |
| Buisson touffu | `Bush/othonna_cerarioides_2k` |
| Buisson sauvage | `Bush/wild_rooibos_bush_1k` |
| Arbre voûte (canopée large) | `tree/jacaranda_tree_1k` |
| Arbre prop central (grand) | `tree/island_tree_02_2k` |
| Rocher prop | `rock/rock_01_2k` |
| Sol chemin | texture `rocky_trail_2k` |

`ClusterInfo` existe dans `procedural.ts` avec `x, z, chunk` — il manque `propType`.

---

## Étape 0 — Scène de test isolée [ ]

**À faire EN PREMIER** — itérer sur le visuel sans marcher 300 m dans le cimetière.

- URL param `?testCluster=<seed>` dans `main.ts` : bypass complet du routing cemetery/hub
- Charge une scène minimale : 1 cluster, caméra fixe à l'entrée du chemin
  (hauteur 1.7 m, angle proche du concept image — légèrement surélevé, axe Z vers l'intérieur)
- Ajouter `data-ready="cluster"` sur `<body>` quand le cluster est chargé (pour le test E2E)
- Pas de nouveau HTML ni nouveau renderer — guard en tête de `main.ts`

**Fichiers touchés** : `web/src/main.ts`

---

## Étape 4.1 — `propType` dans `ClusterInfo` [ ]

```ts
// dans procedural.ts
type ClusterInfo = { x: number; z: number; chunk: number; propType: "tree" | "rock" | "flat" }
```

Tiré de la seed dans `placeCluster()` — même mécanique que `clusterRatio`.

**Test** (`procedural.test.ts`) :
- déterminisme : même seed → même `propType` par cluster
- ratio des trois types dans la plage attendue sur N layouts

**Fichiers touchés** : `web/src/procedural.ts`, `web/src/procedural.test.ts`

---

## Étape 4.2 — `scene/clusterBiome.ts` [ ]

Nouvelle fonction pure (sans effets de bord métier) :

```ts
export async function buildClusterBiome(
  cluster: ClusterInfo,
  frame: Frame,
  terrain: TerrainChunk | undefined,
  companyId: string,
): Promise<THREE.Group>
```

### Layers (ordre de construction)

| # | Layer | Technique |
|---|-------|-----------|
| 1 | **Chemin en terre** | `PlaneGeometry(0.9, dist)` + texture `rocky_trail_2k`, posé sur terrain entre entrée et centre |
| 2 | **Arc d'arbres voûte** | 5–8 `jacaranda_tree_1k`, radius `CLUSTER_RADIUS + 4 m`, scale 2–3.5 seedé, `rotation.x ≈ -0.12 rad` vers le centre (crée la voûte) |
| 3 | **Arc de buissons** | 8–12 instances des 3 bush assets, radius `CLUSTER_RADIUS + 1.5 m`, derrière les tombes (demi-cercle côté fond), scale 0.8–1.3 seedé |
| 4 | **Prop central** | `propType === "tree"` → `island_tree_02` scale 2.5–3.5 ; `"rock"` → empilement 3–5 rocks ; `"flat"` → `moss_01` au sol |

Les tombes elles-mêmes restent gérées par `cemetery.ts` — `clusterBiome` ne les touche pas.

**Règle d'itération** : implémenter et valider chaque layer séparément via la scène de test (étape 0) avant de passer au suivant. Ordre recommandé : arbres voûte → buissons → chemin → prop.

**Fichiers touchés** : nouveau `web/src/scene/clusterBiome.ts`

---

## Étape 4.3 — Branchement dans `cemetery.ts` [ ]

Pour chaque cluster du layout :

```ts
const biome = await buildClusterBiome(cluster, frame, terrain, companyId)
cemeteryGroup.add(biome)
```

Dispose propre dans `clearWorld` : traverser le groupe, libérer géométries et matériaux.

**Fichiers touchés** : `web/src/cemetery.ts`

---

## Étape 4.4 — E2E visual test [ ]

`e2e/clusterBiome.spec.ts` :

```ts
await page.goto("/?testCluster=42")
await page.waitForSelector("[data-ready=cluster]")
await expect(page).toHaveScreenshot("cluster-biome.png", { maxDiffPixelRatio: 0.05 })
```

- Le golden est généré au premier run (`--update-snapshots`) et **validé manuellement**
  en comparant au concept image `images/cluster-cocoon-concept.png`
- L'image IA sert de référence humaine, pas de comparaison pixel (styles trop différents)
- Committer le golden après validation visuelle

**Fichiers touchés** : nouveau `e2e/clusterBiome.spec.ts`

---

## Ordre de dev recommandé

```
0 → 4.1 → 4.2 arbre voûte → 4.2 buissons → 4.2 chemin → 4.2 prop → 4.3 → 4.4
```

## État

```
Étape 0  — Scène de test isolée          [ ] à faire
Étape 4.1 — propType dans ClusterInfo    [ ] à faire
Étape 4.2 — scene/clusterBiome.ts        [ ] à faire
Étape 4.3 — Branchement cemetery.ts      [ ] à faire
Étape 4.4 — E2E visual test              [ ] à faire
```
