# Revue 3D — Performance & Rendu

> Revue du 2 juillet 2026, orientée performance du rendu 3D et qualité visuelle/immersion.
> Pas une chasse aux bugs : des constats mesurés, des recommandations classées, et des idées.

---

## TL;DR

Le FPS s'effondre pour une raison dominante et mesurable : **les GLTF Poly Haven sont
utilisés bruts, en qualité photogrammétrie**. Un seul jacaranda fait **3 863 832 triangles**,
et `clusterBiome.ts` en clone 9 à 13 par clairière. Une clairière coûte **38 à 55 millions
de triangles** — un GPU moyen en digère 100–300 M/s, soit 2 à 8 fps rien que pour elle.
Aucune optimisation de code ne compensera ça : il faut un **pipeline d'assets** (décimation
+ compression). C'est le chantier n°1, et il divise aussi le temps de chargement par ~20.

| # | Chantier | Gain estimé | Effort |
|---|----------|-------------|--------|
| 1 | Pipeline d'assets `gltf-transform` (décimer + compresser) | FPS ×5–10, chargement ÷20 | ½ journée |
| 2 | Quick wins visuels (tone mapping prod, colorSpace, anisotropy) | Rendu nettement plus riche | 1–2 h |
| 3 | Instancier `clusterBiome.ts` (pattern `vegetation.ts` existant) | Draw calls ÷10 par clairière | ½ journée |
| 4 | Ombres : suivre la caméra + mise à jour statique | Ombres partout + passe d'ombre quasi gratuite | ½ journée |
| 5 | Tombes : géométries/matériaux partagés, accessoires instanciés | Draw calls ÷5 sur les tombes | 1 journée |
| 6 | Immersion : chemin visible, thèmes de clairière, lucioles, audio | Cimetières « habités » | progressif |

---

## 1. Constat chiffré

### 1.1 Les assets (mesuré sur `web/public/models/`)

| Modèle | Triangles | Poids disque | Usage |
|--------|-----------:|-------------:|-------|
| `jacaranda_tree_1k` | **3 863 832** | **205 Mo** | cloné 9–13× par clairière (voûte) |
| `tree_small_02_4k` | 2 062 487 | 154 Mo | instancié ~2–3× par chunk |
| `island_tree_02_2k` | 1 072 213 | 57 Mo | instancié + prop central |
| `didelta_spinosa_2k` (buisson) | 417 187 | 17 Mo | cloné ~⅓ des 10–16 buissons/clairière |
| `othonna_cerarioides_2k` | 118 149 | 14 Mo | idem |
| `rock_01_2k` | 107 390 | 9,7 Mo | cloné 9× par clairière (dont cailloux à échelle 0,12 !) |
| `grass_medium_01_2k` | ~1 450/touffe | 7,7 Mo | jusqu'à 20 000 instances par chunk |

Total : **488 Mo de modèles + 70 Mo de textures** servis au navigateur.

### 1.2 Budget triangles d'une clairière (`clusterBiome.ts`)

- Voûte : 9–13 × jacaranda 3,86 M ≈ **35–50 M**
- Buissons : 10–16 clones (moyenne ~188 k) ≈ 1,9–3 M
- Bornes + cailloux : 9 × rock 107 k ≈ 1 M
- Prop central : island tree 1,07 M ou pile de rochers 0,43 M

**≈ 38–55 M de triangles par clairière.** Un caillou décoratif de 12 cm coûte 107 000 triangles.

### 1.3 Le reste d'un chunk

- Herbe : ~8 brins/m² × ~600 m² ≈ 4 800 touffes × ~1 450 tris ≈ **7 M tris** en LOD plein
  (< 30 m), plafonné à 20 000 instances (≈ 29 M au max).
- Végétation instanciée (`vegetation.ts`) : 2–3 arbres de 1–2 M tris + rochers, **×2 car
  `castShadow = true`** (la passe d'ombre re-rend tout) ≈ 4–12 M.

En approchant une clairière avec 2–3 chunks chargés : **50–80 M de triangles par frame**.
Le diagnostic « beaucoup de modèles 3D → FPS qui chute » est confirmé, mais la cause n'est
pas le *nombre* de modèles : c'est leur *densité* unitaire.

### 1.4 Draw calls des tombes (`graves.ts`)

Chaque tombe crée 5 à 30 meshes avec géométries **et matériaux neufs** (un
`MeshStandardMaterial` par fleur, par tige, par bougie…). 40 tombes chargées ≈
**400–800 draw calls** rien que pour les tombes. Aucun partage, aucun batching possible.

---

## 2. Performance

### P0 — Pipeline d'assets (le gros gain)

Décimer et compresser les GLTF **hors ligne**, une fois pour toutes, avec
[`gltf-transform`](https://gltf-transform.dev) (CLI, pas de dépendance runtime) :

```bash
# Exemple pour un arbre : 3,86 M tris → ~40 k, 205 Mo → ~5 Mo
pnpm dlx @gltf-transform/cli optimize \
  web/public/models/tree/jacaranda_tree_1k/jacaranda_tree_1k.gltf \
  web/public/models/opt/jacaranda.glb \
  --simplify true --simplify-error 0.001 \
  --texture-compress webp --texture-size 1024 \
  --compress meshopt
```

Budgets cibles par catégorie (largement suffisants en vue première personne) :

| Catégorie | Budget tris | Ratio vs actuel |
|-----------|------------:|-----------------|
| Arbre « héros » (prop central) | ≤ 50 k | ~1 % |
| Arbre d'ambiance (voûte, forêt) | ≤ 20 k | ~0,5 % |
| Buisson | ≤ 8 k | ~2–30 % |
| Rocher | ≤ 2 k | ~2 % |
| Touffe d'herbe | ≤ 200 | ~15 % |

Points d'intégration :

- Un script `tools/optimize-models.mjs` (ou un simple script shell) commité, qui produit
  `web/public/models/opt/*.glb` ; les chemins dans `clusterBiome.ts`, `vegetation.ts`,
  `grassField.ts` pointent vers les versions optimisées.
- `--compress meshopt` nécessite d'enregistrer `MeshoptDecoder` sur le `GLTFLoader` de
  `grass.ts:13` (3 lignes, `three/examples/jsm/libs/meshopt_decoder.module.js`, déjà dans three).
- Pour les textures : WebP suffit (décodage natif). KTX2/BasisU serait encore mieux pour la
  VRAM (÷4–6) mais ajoute le `KTX2Loader` + transcodeur — à garder pour plus tard si la VRAM
  devient le goulot (mobile/iGPU).
- L'herbe mérite un traitement à part : à 20 000 instances, chaque triangle de la touffe
  compte. Décimer agressivement (~100–200 tris) ou passer sur des cartes croisées (2 quads
  texturés alpha) : visuellement équivalent en mouvement, 10× moins cher.

**C'est le seul chantier qui règle à la fois le FPS (vertex throughput), le temps de
chargement (205 Mo → ~5 Mo par arbre) et les à-coups d'upload GPU à l'entrée des chunks.**

### P0 — Instancier le biome de clairière

`clusterBiome.ts` fait `gltf.clone(true)` par arbre/buisson/caillou
(`buildVaultTrees:192`, `buildBushes:210`, `buildPathAndGate:159-173`). Le clone partage la
géométrie en mémoire mais **chaque clone = ses draw calls + son vertex shading complet**.
Avec 3 primitives par arbre × 13 arbres, c'est 39 draw calls là où 3 suffisent.

Le pattern correct existe déjà dans le code : `vegetation.ts` (un `InstancedMesh` par
sous-mesh GLTF, matrices précalculées, `computeBoundingSphere()` pour le culling). À
réutiliser tel quel pour la voûte, les buissons (1 batch par espèce), les cailloux et la
pile de rochers. Résultat par clairière : ~60 draw calls → **~10**.

Au passage : `vegetation.ts:34` fait `m.geometry.clone()` **par chunk**. Pour un arbre de
1–2 M de vertex, chaque chunk chargé duplique des dizaines de Mo de géométrie en RAM/VRAM.
Mettre en cache les sous-meshes extraits par chemin de modèle (comme `gltfCache`), ne plus
les disposer par chunk (ils sont partagés), et le problème disparaît. Après décimation ce
sera moins grave, mais le partage reste gratuit.

### P1 — Ombres

Deux problèmes dans `lighting.ts` :

1. **La caméra d'ombre est figée à l'origine** (`apply()` : `key.target.position.set(0,0,0)`,
   emprise ±40 m). Le monde s'étend sur des centaines de mètres en −Z : au-delà de ~40 m du
   spawn, **plus aucune ombre portée**. Fix : déplacer `key.position`/`key.target` avec la
   caméra chaque frame, en quantifiant la cible sur la grille de texels de la shadow map
   (`extent × 2 / mapSize`) pour éviter le scintillement.
2. **La passe d'ombre re-rend la végétation lourde** (`vegetation.ts:99` : `castShadow = true`
   sur des meshes à millions de triangles). Après décimation ça devient tenable ; en
   attendant, ou en plus : `renderer.shadowMap.autoUpdate = false` +
   `renderer.shadowMap.needsUpdate = true` uniquement au chargement/déchargement d'un chunk
   et au changement d'ambiance. La scène est quasi statique (l'herbe ne projette pas
   d'ombre, les avatars non plus) — c'est une passe d'ombre presque gratuite.

Incohérence à trancher : les clones du biome de clairière ne projettent **aucune** ombre
(`castShadow` jamais posé) alors que la végétation instanciée si. Après le passage à
l'instancing, harmoniser (tout projeter, puisque la passe deviendra bon marché).

### P1 — Tombes : partage et batching (`graves.ts`)

- **Géométries partagées** : `BoxGeometry(1.3, 0.25, 0.7)` du socle, cylindres de tiges,
  icosphères de fleurs, etc. sont recréés par tombe. Les déclarer une fois au niveau module
  (géométries unitaires, mise à l'échelle par mesh) — zéro changement visuel.
- **Matériaux partagés** : un `MeshStandardMaterial` par fleur/tige/bougie → des centaines
  de matériaux identiques. Tables de matériaux partagés par couleur (la palette
  `PETAL_PALETTE` a 5 entrées, pas besoin de plus de 5 matériaux de pétale au monde).
  Attention au dispose : `disposeObject` ne doit plus les libérer (même logique que les
  matériaux GLTF en cache).
- **Étape suivante (si besoin)** : les accessoires (fleurs, herbes folles, offrandes) en
  `InstancedMesh` par chunk plutôt que par tombe, et fusion socle+stèle par
  `BufferGeometryUtils.mergeGeometries` avec couleurs par vertex. Une tombe passe de
  5–30 draw calls à **2** (pierre fusionnée + plaque nominative, qui reste unique car sa
  texture l'est).
- La texture de nom (256×320 canvas) est le seul élément légitimement unique par tombe —
  c'est très bien ainsi.

### P1 — Chaîne de LOD par distance (après le pipeline d'assets)

Le script de décimation produit **plusieurs niveaux par modèle** (mêmes commandes,
`--simplify-error` différents) ; le choix du niveau se fait par distance. Dimensionnement
adapté à CE monde : un objet n'est jamais visible à plus de ~40 m (`CHUNK_UNLOAD_RADIUS`)
et le brouillard estompe déjà fort — inutile de copier l'échelle d'un open-world.

| Niveau | Budget tris (arbre) | Distance | Rôle |
|--------|--------------------:|----------|------|
| **high** (LOD0) | ~20–50 k | 0–12 m | ce qu'on regarde de près (clairière où l'on se tient) |
| **medium** (LOD1) | ~5–8 k | 12–25 m | le gros du champ visuel |
| **low** (LOD2) | ~1–2 k | 25–40 m | silhouettes dans le brouillard, jusqu'au déchargement |
| **super-low** (billboard) | 2–8 | > 40 m | croix de 2 quads texturés (ou impostor), **persistant** après déchargement du chunk — règle aussi le « monde vide au loin » du §4 |

Mécanisme de bascule — il existe déjà à moitié :

- La boucle (`cemetery.ts:415-428`) évalue déjà une distance par chunk (`veg.center`,
  `field.center`) et pilote des `count` d'`InstancedMesh` ; l'herbe a déjà sa propre
  échelle à 3 niveaux (plein < 30 m, réduit < 50 m, zéro au-delà). Généraliser :
  `VegetationInstances` (et le futur clusterBiome instancié) porte ses meshes **par
  niveau**, la boucle active un seul niveau (`count = maxCount`, 0 sur les autres) selon
  la distance du chunk.
- **Granularité par chunk, pas par instance** : les chunks font ~20 m de profondeur, la
  sélection par chunk est presque juste et quasi gratuite (pas de re-bucketing des
  matrices par frame). Une granularité par instance n'apporterait rien ici.
- **Hystérésis** de ~2–3 m entre montée et descente de niveau (même principe que
  `CHUNK_LOAD_RADIUS`/`CHUNK_UNLOAD_RADIUS`) pour ne pas clignoter à la frontière.
- **Un seul helper DRY** (`scene/distanceLod.ts`) plutôt que trois bascules ad hoc :
  aujourd'hui l'herbe (`cemetery.ts:416-421`), la végétation (`:422-427`) et bientôt les
  clairières codent chacune leur `if (distance < seuil)` dans la boucle. À remplacer par
  un petit composant pur et testable — `selectLod(distance, seuils, niveauActuel)` avec
  hystérésis intégrée (logique pure façon `chunkStreaming.ts`, testée en Vitest sans
  Three.js) + un porteur `LodMeshes` qui applique le niveau choisi aux `count` de ses
  `InstancedMesh`. GrassField, VegetationInstances et ClusterBiomes le consomment tous
  les trois ; la boucle de `cemetery.ts` se réduit à `lod.update(camPos)` par chunk.
- Coût mémoire des niveaux supplémentaires : ~+30 % du LOD0 (5 k + 1 k par-dessus 20 k) —
  négligeable une fois la décimation faite. Draw calls inchangés (un seul niveau actif).
- Anti-« pop » optionnel : fondu court (scale ou `alphaHash`) à la bascule — à ne faire
  que si le pop gêne réellement une fois le reste posé.

Objectif mesurable associé : `renderer.info.render.triangles` sur la scène de test à
trois positions de caméra (3 m / 20 m / 35 m de la clairière), chacune sous son budget.

### P2 — Divers runtime (petits mais gratuits)

- `cemetery.ts:381` : `new THREE.Vector3()` alloué à chaque frame dans `publishPresence` —
  réutiliser un vecteur module.
- `grass.ts:85-89` : `tile()` **mute `repeat` sur la texture partagée du cache**. Chaque
  chunk ayant un `reach` différent, le dernier chunk chargé impose son tiling à tous les
  autres (densité de texture incohérente d'un chunk à l'autre). Fix : `tex.clone()` par
  matériau (l'image reste partagée), ou un tiling en espace monde constant.
- `clusterBiome.ts:65-71` recrée son propre `TextureLoader` + cache alors que
  `rocky_trail_diff_2k.jpg` est déjà chargé par `grass.ts` → même JPG uploadé deux fois.
  Exporter `loadTex` depuis `grass.ts`.
- `cemetery.ts:340-356` : `applyAmbiance` reconstruit les particules du décor toutes les
  60 s même si rien n'a changé — comparer l'ambiance effective avant d'appliquer.
- `cemetery.ts:94` : ajouter `powerPreference: "high-performance"` au renderer (les
  laptops double-GPU choisissent sinon l'iGPU).
- `MAX_PIXEL_RATIO = 2` + MSAA : sur écran hi-DPI c'est 4× les pixels. 1,5 est
  indistinguable en mouvement et rend ~40 % de pixels en moins. Option plus fine :
  résolution dynamique (baisser le ratio quand le frame time dépasse ~20 ms).
- Le toggle de visibilité de la végétation (`cemetery.ts:422-427`) est quasi inopérant :
  il coupe à 36 m alors que le chunk se décharge à 40 m (`CHUNK_UNLOAD_RADIUS`). À
  supprimer ou à transformer en vrai LOD (voir idées).
- Construction de chunk : `terrain.getHeightAt` est appelé ~20 000 fois (une par brin
  d'herbe), FBM 3 octaves à chaque fois, sur le thread principal → à-coup à l'entrée d'un
  chunk. Précalculer une grille de hauteurs par chunk + interpolation bilinéaire, ou étaler
  la construction sur plusieurs frames.

### Outillage de mesure (pour piloter tout ça)

- Un overlay DEV maison (~20 lignes, pas de dépendance) affichant
  `renderer.info.render.calls`, `.triangles` et un compteur FPS — c'est la boussole de
  toute cette revue. À brancher derrière `import.meta.env.DEV`.
- Le harnais photométrique e2e (`e2e/clusterBiome.spec.ts`) est une excellente base :
  y ajouter une **assertion de budget** (`renderer.info.render.triangles < 2_000_000` sur
  la scène de test cluster) pour verrouiller les gains dans la CI.
- Ponctuellement : Spector.js (extension navigateur) pour auditer les draw calls réels.

---

## 3. Rendu visuel — corrections

Par impact décroissant :

1. **Le tone mapping n'existe qu'en scène de test.** `main.ts:40` règle
   `ACESFilmicToneMapping` pour `?testCluster`, mais le renderer de production
   (`cemetery.ts:94`) reste en `NoToneMapping` : les HDRI et les émissifs saturent, les
   hautes lumières clippent. Poser `renderer.toneMapping = THREE.ACESFilmicToneMapping`
   (ou `AgXToneMapping`, plus doux sur les verts) + `toneMappingExposure` ~1,0 dans le
   constructeur de `Cemetery`, puis réajuster les intensités d'ambiance. C'est LE réglage
   qui fait passer un rendu three.js de « jeu flash » à « filmique ».
2. **`colorSpace` manquant sur toutes les textures de sol.** Les `loadTex` de `grass.ts`
   et `clusterBiome.ts` ne posent pas `tex.colorSpace = THREE.SRGBColorSpace` sur les
   diffuses (`_diff`). Elles sont interprétées comme linéaires → sols délavés, incohérents
   avec les GLTF (que `GLTFLoader` configure correctement). Les normal maps (`_nor_gl`)
   restent bien en linéaire.
3. **Anisotropy à 1 sur les sols.** En vue rasante (le cas permanent en première personne),
   les textures de sol deviennent floues à 3 m. Poser
   `tex.anisotropy = renderer.capabilities.getMaxAnisotropy()` (ou 8) sur les textures de
   terrain et le disque de terre.
4. **Ombres absentes au-delà de 40 m de l'origine** (voir P1 ci-dessus — c'est autant un
   problème visuel que perf).
5. **Acné d'ombre potentielle** : aucun `shadow.bias`/`normalBias` configuré dans
   `lighting.ts`. `normalBias: 0.03` + `bias: -0.0002` comme point de départ.
6. **Double éclairage quand le HDRI est actif** : `scene.environment` (IBL) s'ajoute à
   hémisphérique + ambiante + directionnelle, toutes calibrées sans lui → surexposition
   plate. Quand `hdriSky.apply()` renvoie `true`, réduire `ambient`/`hemi` (ou utiliser
   `scene.environmentIntensity`, dispo en r185) ; les valeurs d'`ambiance.ts` ont été
   calées avant le HDRI.
7. **La caméra ignore le relief** : `controls.ts:139` fixe `p.y = EYE_HEIGHT` alors que le
   terrain FBM ondule sur ±2 m — on « coupe » les bosses et les tombes montent jusqu'aux
   genoux. Échantillonner la hauteur du terrain sous le joueur (via le chunk chargé,
   `terrain.getHeightAt`) et poser `p.y = ground + EYE_HEIGHT`, lissé.
8. **Brouillard vs HDRI** : le `FogExp2` de couleur unie se lit sur fond HDRI (les objets
   lointains fondent vers une couleur qui n'est pas celle de l'horizon HDR). Accorder
   `fogColor` par HDRI (échantillonner l'horizon une fois) ou baisser la densité de jour.
9. **Déterminisme** : `makeNameTexture` (`graves.ts:38-44`) utilise `Math.random()` pour le
   grain — contraire à la règle « même entrée → même rendu » du projet. Utiliser
   `seededRandom(colleague.graveSeed)`.
10. **Cohérence stylistique** — le point le plus structurant : trois langages visuels
    cohabitent (arbres primitifs low-poly de `decor.makeTree`/`world.ts`, GLTF
    photogrammétrie, tombes en primitives colorées). Une fois le pipeline d'assets en
    place, remplacer la forêt primitive par les mêmes arbres décimés en `InstancedMesh`
    (un seul batch pour toute la forêt du monde), et texturer les tombes avec les textures
    `rock/` déjà présentes (12 Mo inutilisés dans `web/public/textures/rock`). Le monde
    entier parlera la même langue visuelle.

---

## 4. Idées — biomes & immersion

### Le chemin visible (le meilleur ratio effet/effort)

`procedural.ts` connaît l'épine dorsale et chaque bras de ramification… mais **rien n'est
rendu au sol** : le visiteur marche « nulle part ». Peindre le tracé dans la splat map
(`makeSplatTex` dans `grass.ts`) — canal G (rocky_trail) le long de l'épine et des bras,
avec un peu de bruit sur les bords — donne instantanément : lisibilité du parcours,
guidage naturel vers les clairières, et le sol cesse d'être un aplat. Supprimer l'herbe
sur le tracé (le mécanisme `exclude` de `GrassField` existe déjà pour le disque de terre —
le généraliser en liste de formes).

### Thèmes de clairière (étendre le système propKind/karma existant)

Le socle est déjà là (`propKind` tree/rocks/flat, karma < −5 = sol rocailleux,
hiver = neige). Proposition : un **thème par clairière** dérivé du karma des tombes
qu'elle contient, qui module les layers existants sans nouveau système :

- **Paradisiaque** (votes positifs) : jacaranda en fleurs, pétales qui tombent (le système
  de particules de `decor.ts` sait déjà faire), lucioles au crépuscule, herbe plus haute
  et fleurie, halo doré du prop central.
- **Hantée** (votes négatifs) : arbres remplacés par `dry_branches` (déjà dans
  `models/branch/`, inutilisé !), nappe de brume au sol (2–3 plans alpha superposés
  animés lentement — pas cher), corbeaux qui s'envolent à l'approche (le pattern des
  chauves-souris Halloween de `decor.ts` se généralise tel quel), lueur violette.
- **Neutre/oubliée** : herbes folles denses, pierres moussues, un seul arbre penché.

Chaque thème = un choix de modèles + une palette + un système de particules local. Tout
le code nécessaire existe déjà en pièces détachées.

### Ambiance sonore (zéro dépendance)

Le Web Audio API natif suffit : un souffle de vent en boucle (gain modulé par la météo
existante), corbeaux épars côté hanté, cloche lointaine à l'entrée d'un cimetière,
`PannerNode` positionnel par clairière. L'audio est le multiplicateur d'immersion le
moins cher de toute cette liste — un cimetière silencieux n'existe pas.

### Lumière et post-traitement

- **Rayons crépusculaires low-cost** dans les clairières : 2–3 cônes additifs
  (`MeshBasicMaterial` transparent, `depthWrite: false`) orientés selon `keyLightDir` à
  l'aube/au crépuscule. Effet « cathédrale naturelle » — exactement le concept visé par
  `CLUSTER_BIOME_CRITERIA`.
- **Bloom sélectif** sur les émissifs (tombes hantées/bénies, bougies, citrouilles) :
  `UnrealBloomPass` avec seuil haut — `EffectComposer` est déjà importé dans `main.ts`,
  l'infra est à moitié posée. À n'activer qu'après le chantier perf (le bloom coûte cher
  en pixels, capper le pixelRatio d'abord).
- **Vignette légère** (ShaderPass déjà importé) : cadre le regard, gratuit.

### Vent sur les arbres

Le shader de vent de `grassField.ts` (`aWind` + `onBeforeCompile`) s'applique tel quel à
la primitive « feuilles » des arbres instanciés (pondérer par la hauteur du vertex). Des
arbres figés sont le premier signal « décor de carton » ; trois lignes de shader réglent ça.

### LOD & transitions

- La chaîne de LOD complète (high/medium/low/billboard, distances, helper DRY) est
  spécifiée en §2 « P1 — Chaîne de LOD par distance ».
- **Fondu d'apparition des chunks** : aujourd'hui un chunk « pope » d'un coup à 24 m.
  Un scale-in de 300 ms sur `chunk.fence`/`biomes.group` + fondu d'opacité de l'herbe
  adoucirait beaucoup — ou simplement charger à 40 m et laisser le brouillard masquer.
- Les tombes, murs et clairières au-delà du rayon de déchargement disparaissent : une
  **silhouette persistante** par cimetière (arche déjà persistante + 3–4 billboards
  d'arbres) donnerait de la profondeur au monde depuis la route.

---

## 5. Plan d'attaque proposé

1. **Quick wins visuels** (1–2 h) : tone mapping prod, `colorSpace` + anisotropy sols,
   `normalBias`, `powerPreference`. → le rendu change immédiatement de catégorie.
2. **Pipeline d'assets** (½ j) : script `gltf-transform`, budgets du §2, chemins mis à
   jour, `MeshoptDecoder` branché. → c'est ici que le FPS revient.
3. **Instancing du biome de clairière** (½ j) : pattern `vegetation.ts`, cache de
   sous-meshes partagé inter-chunks.
4. **Ombres** (½ j) : suivi caméra quantifié + `shadowMap.autoUpdate = false`.
5. **Tombes** (1 j) : géométries/matériaux partagés, puis accessoires instanciés si le
   compteur de draw calls le justifie encore.
6. **Immersion** (progressif, dans l'ordre du meilleur ratio) : chemin peint dans la
   splat → audio ambiant → thèmes de clairière → vent sur les arbres → rayons/bloom.

Verrous de régression : l'overlay `renderer.info` en DEV + une assertion de budget
triangles dans `e2e/clusterBiome.spec.ts`.

---

## Annexe — fichiers cités

| Fichier | Rôle | Points relevés |
|---------|------|----------------|
| `web/src/scene/clusterBiome.ts` | clairières | clones non instanciés (§2), texLoader dupliqué, colorSpace |
| `web/src/scene/vegetation.ts` | arbres/rochers instanciés | `geometry.clone()` par chunk, castShadow coûteux |
| `web/src/scene/grassField.ts` | herbe GPU | touffes trop denses (~1 450 tris), pattern vent réutilisable |
| `web/src/scene/grass.ts` | sol splat + caches | mutation `repeat` partagée, colorSpace/anisotropy |
| `web/src/graves.ts` | tombes | géométries/matériaux non partagés, `Math.random()` dans le grain |
| `web/src/scene/lighting.ts` | lumières | caméra d'ombre figée à l'origine, pas de bias |
| `web/src/cemetery.ts` | orchestrateur | pas de tone mapping, alloc/frame, LOD végétation inopérant |
| `web/src/scene/controls.ts` | déplacement | caméra ignore le relief |
| `web/src/scene/terrain.ts` | relief FBM | 20 k appels FBM par chunk sur le thread principal |
