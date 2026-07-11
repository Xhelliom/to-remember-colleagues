# Revue d'amélioration — Graphismes · Génération procédurale · Organisation & parcours

> Revue du 11 juillet 2026. Trois axes demandés : **qualité graphique**, **génération
> procédurale pour un meilleur rendu**, et **organisation/parcours dans le cimetière
> et sur le chemin commun**. Complémentaire de `REVUE_3D_PERF_RENDU.md` (juillet 2026,
> orientée performance) : les chantiers d'assets, d'instanciation et d'ombres y sont
> traités et sont **déjà en grande partie réalisés** — cette revue part de l'état actuel.

---

## TL;DR

Le cœur du moteur est solide : streaming par chunks, déterminisme par graine, tombes
à 3 axes avec géométrie usée par vertex, arbres procéduraux LOD (hero → cards →
impostors), sol splat-map, CSM, vent partagé. Le **plus gros levier visuel est déjà
codé mais pas branché** : toute la chaîne post-process (exposition auto, grade
filmique par heure, brume de sol) ne vit que dans la scène de test `?post=1` de
`main.ts` — le vrai jeu (`Cemetery`) rend en direct sans composer. Ensuite, le
contraste entre l'**intérieur des cimetières** (riche) et le **monde commun**
(route grise plate, sol uni, forêt d'icosaèdres) est devenu criant. Enfin, le
parcours souffre de trois défauts structurels : épine **rectiligne**, cimetière en
**cul-de-sac**, et joueur qui **ne suit pas le relief**.

| # | Chantier | Axe | Impact | Effort |
|---|----------|-----|--------|--------|
| 1 | Brancher le post-process dans le vrai jeu (déjà codé) | Graphismes | ★★★ | ½ j |
| 2 | Route commune : texture + spline + accotements fondus | Graphismes/Parcours | ★★★ | 1 j |
| 3 | Monde extérieur : terrain + sol texturé + forêt unifiée (impostors) | Graphismes | ★★★ | 1–2 j |
| 4 | Épine qui serpente + jitter des rangées | Procédural | ★★☆ | 1 j |
| 5 | Suivi du relief par le joueur + collisions douces | Parcours | ★★★ | 1 j |
| 6 | Boucle de circulation (fin d'épine → retour) | Parcours | ★★☆ | 1 j |
| 7 | Ordre chronologique des tombes + panneaux de quartier | Parcours/Sens | ★★☆ | 1 j |
| 8 | Intégrer deadfall + understory (déjà codés, non branchés) | Graphismes | ★★☆ | ½–1 j |
| 9 | Ciel de nuit (étoiles, lune) | Graphismes | ★★☆ | ½ j |
| 10 | Thèmes de cimetière par organisation | Procédural | ★★☆ | 1–2 j |
| 11 | Allées vertes : végétation en bandes le long des chemins + bras ramifiés | Procédural/Parcours | ★★★ | 2 j |

---

## 1. État des lieux — ce qui est déjà bien (à préserver)

- **Déterminisme rigoureux** : `seededRandom` (mulberry32) + `hashSeed` (FNV-1a)
  partout dans la génération ; terrain FBM invariant à la taille (`terrain.ts`),
  prérequis du chunking respecté.
- **Streaming intra-cimetière** (`worldStreamer.ts`, `chunkStreaming.ts`) : chargement
  par tranche à l'approche, plafond de builds simultanés, dirty-flag pour la shadow map.
- **Tombes 3 axes** (`graveAxes.ts`, `graves.ts`, `graveStone.ts`) : pipeline couleur
  HSL par axe, géométrie de stèle usée/fissurée par vertex, dressing mousse/lichen/coulures.
- **Arbres procéduraux** (`trees/`) : chaîne LOD complète activée
  (`PROCEDURAL_TREES_ENABLED = true`), capture d'atlas/impostors à l'exécution.
- **Sol splat-map** (`grass.ts`) : 3 textures PBR mélangées, chemin de terre **peint
  dans la splat** le long des vrais segments (`distanceToPath`) — le visiteur voit où marcher.
- **Biome clairière** (`biomes/clairiere/`) : fer à cheval orienté par `approach`,
  tombes en arc face au visiteur — la meilleure mise en scène du jeu actuellement.
- **CSM + cache de cascades** (`shadows.ts`, activé), herbe GPU instanciée avec LOD
  et hystérésis, vent partagé herbe/arbres (`wind.ts`).

Les recommandations ci-dessous s'appuient sur ces acquis au lieu de les refaire.

---

## 2. Graphismes

### 2.1 Brancher la chaîne post-process dans le vrai jeu — le quick win n°1

**Constat.** `scene/post/` contient trois passes finies et testées : `autoExposure.ts`
(adaptation d'exposition), `grade.ts` (étalonnage filmique **par moment de la journée**,
courbes distinctes dans `ambiance.ts` via `getFilmGrade`) et `groundFog.ts` (brume de
hauteur par depth-texture). Or elles ne sont montées **que** dans `runClusterTest`
(`main.ts:260-273`), derrière `?post=1`. La classe `Cemetery` rend en direct :
`this.renderer.render(this.scene, this.camera)` (`cemetery.ts:460`) — le joueur ne
voit jamais ce travail.

**Recommandation.**
- Introduire un `EffectComposer` dans `Cemetery` (créé avec `createFogRenderTarget`),
  passes : `RenderPass` → `AutoExposurePass` → grade filmique → `GroundFogPass`.
- Recâbler le grade à chaque changement d'ambiance : dans `applyAmbiance`, appeler
  `applyFilmGrade(pass, getFilmGrade(a.timeKey))` — le lien ambiance → grade existe déjà.
- Garder un flag de repli (`?post=0` ou détection d'un GPU faible via
  `renderer.capabilities`) pour préserver les machines modestes et les e2e.
- La brume de sol est l'amélioration d'ambiance la plus « cimetière » possible :
  nappes basses au crépuscule et par météo `brumeux`, quasi gratuites ici.

### 2.2 La route commune est le parent pauvre du rendu

**Constat.** `world.ts:buildRoad` produit un ruban plat `MeshStandardMaterial({ color: 0x55504a })`
— aucune texture, aucun relief, échantillonnage **linéaire** entre stations
(`ROAD_SAMPLES_PER_SEG = 6` sur une polyligne), donc des virages anguleux. À côté,
l'intérieur des cimetières a droit à 3 textures PBR mélangées. C'est le premier
élément que voit le joueur au spawn, et le fil conducteur de toute la visite.

**Recommandations.**
- **Spline** : lisser l'axe par Catmull-Rom (`THREE.CatmullRomCurve3` ou une
  interpolation pure testable dans `worldLayout.ts`) avant extrusion du ruban —
  la polyligne actuelle rend le serpentement (`MEANDER_AMP = 14`) mécanique.
- **Texturer comme le sol des cimetières** : réutiliser `rocky_trail` (déjà chargée)
  avec des UV le long de l'abscisse curviligne ; ajouter une bande d'accotement en
  dégradé (herbe → terre) au lieu du bord net actuel — même principe de `smoothstep`
  que `makeSplatTex`.
- **Micro-relief** : décaler les vertex du ruban sur `terrainHeightAt` d'une graine
  monde (voir 2.3) pour que la route épouse un terrain doux au lieu de flotter à
  `ROAD_Y = 0.02` sur un plan parfait.
- **Habiller le chemin commun** : lanternes/bornes instanciées à intervalle régulier
  le long de la spline (InstancedMesh, une géométrie), bancs près des entrées. De
  nuit, quelques `PointLight` budgétées près du spawn + émissifs ailleurs.

### 2.3 Monde extérieur : sol plat uni + forêt d'icosaèdres

**Constat.** Hors des parcelles : un unique `PlaneGeometry` couleur unie
(`cemetery.ts:127`, teinte `groundColor` de l'ambiance), et la forêt de transition
(`world.ts:buildForest`) utilise `makeTree` de `decor.ts` — tronc cylindre +
**icosaèdre** de feuillage. Ces arbres primitifs côtoient les arbres procéduraux
LOD des cimetières : la rupture de style est visible depuis la route, précisément
là où la forêt sert d'occulteur au streaming.

**Recommandations.**
- **Unifier la forêt** sur la chaîne `TreeLodField` : à cette distance, les arbres
  seraient quasi tous en **impostor** (2 triangles), donc le coût est marginal pour
  un gain de cohérence majeur. `buildTreePlacements` de `vegetation.ts` se réutilise
  presque tel quel (les emplacements sont déjà déterministes).
- **Terrain monde** : appliquer `terrainHeightAt(hashSeed("world"), x, z)` au plan
  extérieur (géométrie subdivisée par-dessus les bounds), avec fondu vers 0 à
  l'approche des parcelles et de la route (même principe que `borderFade`). Les
  cimetières gardent leur graine propre ; les jointures restent plates par le fade
  des deux côtés.
- **Texturer le sol extérieur** avec `forest_ground` tuilée + teinte d'ambiance en
  multiplicateur — une seule texture suffit hors parcelles, pas besoin de splat.
- `makeTree` peut alors être réservé au repli/tests, ou supprimé de `decor.ts`.

### 2.4 Ciel de nuit et astres

**Constat.** `hdriSky.ts` n'a pas de HDR pour la nuit ni Halloween → dôme dégradé
2 couleurs (`sky.ts`) ; l'astre est une sphère `MeshBasicMaterial` unie
(`lighting.ts`). Les nuits sont donc les moments les plus pauvres visuellement,
alors que c'est l'ambiance signature d'un cimetière.

**Recommandations.**
- Enrichir le shader du dôme (`sky.ts`) pour la nuit : **étoiles procédurales**
  (hash 2D sur la direction, scintillement doux), légère bande laiteuse, dégradé
  3 arrêts (horizon/mi-ciel/zénith). Déterministe, zéro asset.
- Lune texturée (une seule petite texture, ou cratères procéduraux) avec halo
  (sprite additif), qui remplace la sphère unie.
- Halloween : teinter les étoiles et grossir la lune — le mode `scary` a déjà
  toute la plomberie d'ambiance.

### 2.5 Vendre les 3 axes avec un bloom sélectif

**Constat.** Les tombes hantées/bénies ont déjà des matériaux émissifs
(`graves.ts:274-292`), les flammes de bougies aussi (`flameMat`,
`emissiveIntensity: 1.2`) — mais sans bloom, un émissif reste un aplat clair.

**Recommandations.**
- Une fois le composer en place (2.1), ajouter un **`UnrealBloomPass` à seuil haut**
  (threshold ≈ 1, ACES déjà actif) : seuls les émissifs forts s'embrasent — halos
  dorés des tombes bénies, lueur violacée des hantées, flammes des bougies,
  citrouilles d'Halloween. C'est l'axe votes (#25) qui devient lisible à 30 m.
- Option budget : bloom seulement si `devicePixelRatio` plafonné/GPU correct,
  résolution de passe ½.
- **Lucioles** au crépuscule près des tombes bien entretenues (points émissifs
  animés, même technique que les particules de `decor.ts`) : lie l'axe entretien
  à une récompense visuelle.

### 2.6 Tombes : gravure plus fine, moins de matériaux uniques

**Constats.**
- La texture de nom fait **256×320** (`makeNameTexture`) : à bout portant — la
  distance de lecture par excellence (`FOCUS_RADIUS`) — la gravure est floue.
- Chaque tombe crée 2–3 matériaux propres (`stoneMat`, `frontMat`, clone
  `steleMat`) + 1 `CanvasTexture` : ~4 programmes/matériaux par tombe chargée.

**Recommandations.**
- Passer le canvas à **512×640** et ne le générer qu'à l'approche (palier LOD :
  plaque unie au loin, texture nominative sous ~15 m). Coût mémoire net ≈ nul
  puisque seules les tombes proches ont leur texture résidente.
- Ajouter un **normal map de gravure** généré du même canvas (creusage par gradient
  d'alpha) : la lumière rasante du matin/soir révèle le texte — gros gain perçu
  pour un shader standard.
- Mutualiser `stoneMat` par **palier d'axes quantifiés** (âge/vote/entretien arrondis
  au dixième) : les tombes aux axes proches partagent le matériau, la variation fine
  restant portée par les vertex colors de `graveStone.ts`.

### 2.7 Brancher le travail déjà fait : deadfall, understory, grass ring

**Constat.** Trois missions du plan LAAS sont **codées, testées… et jamais montées
dans le jeu** :
- `scene/deadfall.ts` (troncs couchés, souches, champignons) — importé nulle part.
- `scene/trees/understory.ts` (buissons/fougères/fleurs procéduraux + `scatterUnderstory`)
  — seul le harnais e2e l'utilise.
- `scene/grassRing.ts` — `GRASS_RING_ENABLED = false` dans `worldStreamer.ts` (la
  bascule documentée n'a jamais été faite).

**Recommandations.**
- **Deadfall** : semer 1–3 pièces par chunk selon le karma/entretien moyen du
  cimetière (un cimetière négligé accumule les troncs moussus) — graine
  `hashSeed(companyId + ":deadfall:" + zStart)`, placement hors chemin via
  `distanceToPath`. Renforce l'axe narratif autant que le rendu.
- **Understory** : disperser sous la couronne des arbres des chunks (les canopées
  sont connues de `TreeLodField`) avec LOD distance — c'est exactement ce que
  `scatterUnderstory` attend. Les abords de l'épine restent dégagés.
- **Grass ring** : trancher. Soit faire la bascule prévue (ring caméra + extinction
  de l'herbe par-tranche), soit supprimer le module — le flag mort et le double
  système d'herbe compliquent chaque évolution de `worldStreamer.ts`.

### 2.8 Divers rendu

- **Route → entrée** : peindre un raccord de terre battue entre le bord de route et
  l'arche (aujourd'hui la splat du chunk d'entrée commence au mur ; un petit fondu
  côté route « invite » à entrer).
- **Arches** : l'enseigne `MeshBasicMaterial` est lisible de nuit (voulu) mais
  *brille* anormalement en plein jour — un léger `emissive` sur `MeshStandardMaterial`
  ferait les deux.
- **Particules** : `decor.ts` centre les particules sur le spawn (`PARTICLE_HALF = 60`)
  — les faire suivre la caméra (offset du groupe, wrap des positions) pour que
  neige/feuilles existent aussi au fond d'un long cimetière.

---

## 3. Génération procédurale

### 3.1 L'épine rectiligne — la monotonie n°1 des cimetières

**Constat.** Dans `procedural.ts`, l'épine est **exactement x = 0** sur toute la
longueur (`pathSegments.unshift({ x0: 0, z0: 0, x1: 0, z1: z })`) ; seuls les bras
s'écartent. Résultat : depuis l'entrée on voit le fond en ligne droite, tous les
cimetières ont la même colonne vertébrale, et la marche est prévisible.

**Recommandation.** Faire serpenter l'épine par une fonction pure et déterministe
`spineOffsetX(seed, z)` (somme de 2 sinus basse fréquence à phases seedées, amplitude
±3–5 m — ou le Perlin déjà présent dans `terrain.ts`) :
- l'épine devient une polyligne de segments courts (`pathSegments` en gère déjà N,
  la splat/`distanceToPath` suivent sans modification) ;
- les points de branchement lisent `spineOffsetX(z)` au lieu de 0 (l'`approach` des
  clusters aussi — l'orientation des biomes reste correcte) ;
- conserver la garantie anti-collision en ajoutant `SPINE_MEANDER_AMP` au calcul de
  `PLOT_WIDTH_BASE`/`BRANCH_Z_SPREAD_HALF` (l'astuce « par construction » du 1.2bis
  survit telle quelle) ;
- visibilité : le fond du cimetière n'est plus visible depuis l'entrée → chaque
  virage est une petite découverte, et l'occlusion aide le streaming.

Tests : même graine → même tracé ; largeur du couloir jamais dépassée ; continuité
des segments (pas de trou dans la peinture du chemin).

### 3.2 Rangées trop régulières

**Constat.** `placeRow` aligne les tombes au cordeau : pas constant
(`GRAVE_SPACING`), même `rotY` pour toute la rangée. Or tout le reste du jeu
« vend » l'irrégularité organique (stèles penchées, terrain bosselé).

**Recommandation.** Jitter déterministe par tombe : ±0,3 m le long du bras,
±0,25 m perpendiculairement, ±0,15 rad d'orientation (le `rand` du layout est déjà
sous la main). Garder `GRAVE_SPACING` comme distance *minimale* (jitter borné à
`(GRAVE_SPACING - margeMin)/2`). Les vieilles tombes (axe âge) pourraient recevoir
un jitter plus fort — un cimetière ancien est moins rectiligne qu'un récent.

### 3.3 Thèmes de cimetière par organisation

**Constat.** Deux cimetières ne se distinguent que par : largeur/longueur, ratio
clusters, et la variante de neige. Essences d'arbres, pierre, mobilier sont
identiques partout. Pour un jeu dont l'unité est « un cimetière = une entreprise »,
c'est la variété la moins chère à créer (tout est déjà paramétré par graine).

**Recommandation.** Dériver du `hashSeed(companyId)` un petit `CemeteryTheme` pur
et testé :
- **essence dominante** (paramètres de `treeBuilder` : port, teinte de feuillage,
  densité) — la grammaire les expose déjà ;
- **pierre locale** (teinte de base des stèles et des murs — le pipeline HSL de
  `graves.ts` prend ce hex en entrée aujourd'hui même) ;
- **type de clôture** : `WallType` (`"haie" | "cloture" | "mur"`) existe dans
  `fence.ts` avec un seul type câblé — c'est le branchement prévu ;
- **densité/hauteur d'herbe** (paramètre `heightScale` de `GrassField` déjà exposé).
Moduler le tout par karma (déjà fait pour la splat : bande désolée si karma < −5) —
le thème donne l'identité, le karma donne l'état.

### 3.4 Clusters : plus de variété de monuments

**Constat.** `ClusterPropKind = "tree" | "rocks" | "flat"` ; le cercle de tombes est
parfait, le rond-point de mur toujours identique.

**Recommandations.**
- Nouveaux props centraux déterministes : **saule pleureur** (variante de la
  grammaire d'arbre à branches tombantes), **puits/fontaine** (primitives + pierre
  procédurale de `stone.ts`), **mausolée** pour les clusters d'un cimetière fermé.
- Jitter radial/angulaire des tombes du cercle (même esprit que 3.2).
- Le biome clairière (fer à cheval) est excellent — étendre sa logique d'orientation
  (`approach`) aux nouveaux props pour qu'ils fassent toujours face à l'arrivant.

### 3.5 Des allées qui s'enfoncent — la végétation doit structurer, pas décorer

**Le problème ressenti** : le cimetière est nu, ouvert, sans ces petites allées qui
se glissent entre les arbres et la végétation et donnent envie de s'y enfoncer.
Trois causes mesurables dans le code :

1. **La densité est celle d'une pelouse.** `TREE_DENSITY = 0.004/m²`
   (`vegetation.ts`) : pour une tranche typique (~100 m d'épine × ~22 m de large,
   soit ~2 000 m²), cela fait **~8 arbres** — un arbre tous les 12 m de chemin,
   perdus au milieu de l'herbe rase.
2. **La dispersion est uniforme et aveugle.** `buildPlacementMatrices` /
   `buildTreePlacements` tirent x/z uniformément dans le rectangle de la tranche :
   la végétation **ignore totalement le chemin et les tombes** (aucun `exclude`,
   contrairement à l'herbe) — un arbre peut pousser au milieu de l'allée ou sur
   une sépulture. Or une allée ne se lit comme une allée que si elle est *bordée* :
   aujourd'hui rien ne cadre le regard, donc rien ne « s'enfonce ».
3. **Les bras sont des moignons rectilignes.** `BRANCH_ARM_MIN = 4`,
   `BRANCH_ARM_MAX = 9` : une ramification fait 4–9 m, sans courbe ni
   sous-ramification, et les tombes commencent à 2 m de l'épine
   (`BRANCH_START_GAP`). Tout est visible d'un coup depuis l'axe central — aucune
   pièce cachée, aucun seuil, aucune découverte.

**Recommandations — dans l'ordre du renversement le plus important :**

**a) Planter en bandes le long des chemins (le changement clé).**
Remplacer la dispersion uniforme par un échantillonnage par rejet pondéré par
`distanceToPath` (déjà exporté par `procedural.ts`) : probabilité **nulle** sur le
chemin (< 1,5 m), **maximale** dans une bande à 2–6 m de part et d'autre,
décroissante au-delà. Fonction pure `vegetationWeightAt(dPath)` testable seule,
même graine → mêmes placements. Effet : des **murs verts** longent l'épine et les
bras ; les rangées de tombes vivent dans des « chambres » derrière ce rideau et se
découvrent en s'y engageant, au lieu d'être étalées à vue. Au passage, cela corrige
le défaut actuel (arbre sur le chemin/sur une tombe) : ajouter aussi un rayon
d'exclusion ~1,2 m autour des `placements`. Compléter la bande avec l'understory
(2.7 — buissons/fougères, déjà codés) et des **haies** le long des bras :
`WallType = "haie"` est déclaré dans `fence.ts` précisément pour ça, jamais câblé.

**b) Des bras qui deviennent de vraies allées (topologie).**
- **Allonger et séparer corridor/chambre** : porter `BRANCH_ARM_MAX` vers 16–20 m,
  et réserver le premier tiers du bras au chemin seul (végétation serrée, zéro
  tombe), les tombes regroupées au bout — l'inverse d'aujourd'hui où `placeRow`
  aligne les tombes dès l'épine. Le bras devient : un seuil, un couloir, puis une
  clairière de sépultures.
- **Courber les bras** : 2–3 segments à dérive d'angle au lieu d'un seul —
  `pathSegments` accepte déjà N segments et la peinture de splat suit sans
  modification ; le bout du bras disparaît de la vue depuis l'épine.
- **Sous-ramification (profondeur 2)** : autoriser un bras long à porter un
  sous-bras — les fameuses petites allées cachées. La garantie anti-collision
  « par construction » (1.2bis) se met à jour en dérivant `MIN_BRANCH_GAP` de la
  portée totale (bras + sous-bras).
- **Récompenser les impasses** : au bout des bras les plus longs, toujours quelque
  chose — cluster/biome, banc, tombe remarquable. Une impasse vide punit la
  curiosité ; une impasse habitée l'entraîne.

**c) Tunnels et seuils végétaux.**
- Sur le corridor des bras : arbres plantés **en vis-à-vis, inclinés l'un vers
  l'autre** pour former une voûte — le biome clairière fait déjà exactement ça
  (`TREE_TILT = 0.16`, `builder.ts:224`), il suffit d'appliquer la recette au
  couloir d'approche. La grammaire `treeBuilder`/`skeleton.ts` (espèces
  paramétrées) permet un port arqué dédié.
- Une **pergola légère** à l'entrée des bras principaux (mini-variante de
  `buildEntranceArch`) : franchir un seuil, même symbolique, transforme un
  embranchement en lieu.

**d) Allées en creux (le terrain participe).**
Creuser légèrement le chemin (−0,3 à −0,5 m, `smoothstep` sur `distanceToPath`)
et/ou épauler ses bords : même à végétation égale, un chemin encaissé « s'enfonce »
physiquement. `TerrainChunk` peut recevoir les `pathSegments` (déjà disponibles
dans `chunkMeshes.ts`) ; les tombes et murs suivent automatiquement via
`getHeightAt`, et l'invariance au chunking est préservée puisque le layout est
global et déterministe.

**e) Gradient de profondeur.**
Densité végétale et hauteur d'herbe (`heightScale` de `GrassField`, déjà exposé)
croissantes avec `z / plotDepth` : entrée dégagée et entretenue, fond dense et
sauvage. Combiné à la promenade chronologique (4.3), le gradient devient
narratif : plus on s'enfonce, plus c'est ancien, ombragé, envahi.

**Garde-fous perf.** Planter en bande *concentre* les instances là où elles
portent visuellement sans faire exploser le total : budget par tranche (par ex.
≤ 40 arbres, la chaîne `treeLod` bascule en impostors 2-triangles au-delà de
~30 m), herbe déjà plafonnée, et l'occlusion accrue **réduit** ce qui est à
l'écran — des murs verts sont aussi des occulteurs pour le streaming.

**Tests associés** : poids de placement nul sur le chemin ; aucune instance à
< 1,2 m d'une tombe ; déterminisme (même graine → mêmes matrices) ; continuité de
la peinture de splat sur bras courbes et sous-bras ; hauteur des tombes = hauteur
du terrain creusé.

### 3.6 Le monde commun aussi est procédural — mais trop peu

**Constat.** `worldLayout.ts` : serpentement sinusoïdal régulier
(`MEANDER_AMP * sin(i * MEANDER_FREQ)`), paires de cimetières face à face — fonctionnel
mais mécanique, et le monde n'existe qu'en fonction des cimetières.

**Recommandations.**
- Bruiter le serpentement (amplitude/phase seedées par station) et lisser (cf. 2.2).
- Insérer des **stations d'agrément** sans cimetière (1 sur 4–5, seedé) : clairière
  de repos, banc, statue — la route respire au lieu d'être un distributeur d'entrées.
- Un **belvédère** au point le plus élevé du terrain monde (cf. 2.3) d'où l'on
  aperçoit plusieurs arches : aide à la construction de la carte mentale.

---

## 4. Organisation & parcours

### 4.1 Le joueur ne suit pas le relief (et traverse tout)

**Constat.** `controls.ts:139` : `p.y = EYE_HEIGHT` — hauteur d'œil **constante à
1,7 m** alors que le terrain des cimetières varie de ±2 m (`AMPLITUDE = 2.0`). En
montée, la caméra s'enfonce visuellement dans le sol ; en descente, elle flotte.
Par ailleurs aucune collision : murs d'enceinte, tombes, arbres et clôtures se
traversent — le mur d'enceinte censé structurer le parcours n'a aucune réalité.

**Recommandations.**
- **Suivi du sol** : échantillonner la hauteur sous le joueur à chaque frame —
  `WorldStreamer` sait déjà le faire (`ringHeightSampler` retrouve le chunk sous la
  caméra et appelle `terrain.getHeightAt`) ; il suffit d'exposer ce sampler aux
  contrôles et de lisser (`p.y → ground + EYE_HEIGHT`, amorti exponentiel comme
  `PEER_SMOOTH_RATE`). Publier le `y` réel dans la présence (#4) pour que les
  fantômes des visiteurs suivent aussi le terrain.
- **Collisions douces** : pas besoin de physique — un test de distance aux segments
  de murs (`pathSegments`-like, les portées de `fence.ts` sont connues) et un rayon
  par tombe (cercle ~0,7 m autour des `placements`), avec glissement le long de
  l'obstacle. Tout est déjà en coordonnées locales pures et testables.

### 4.2 Un cimetière est un cul-de-sac

**Constat.** L'épine s'arrête au mur du fond (`isLastChunk` → bouchon plein). Pour
un long cimetière (la longueur croît avec le nombre de tombes), le visiteur doit
refaire **tout le chemin en sens inverse** — la pire figure de level design pour
un lieu de flânerie.

**Recommandations (au choix, cumulables).**
- **Boucle** : dédoubler l'épine en deux allées parallèles (aller x = −w, retour
  x = +w) reliées au fond — `pathSegments` et la peinture de splat absorbent ça
  sans changement de rendu ; les bras se greffent alternativement sur l'une ou l'autre.
- **Porte arrière** : ouvrir le mur du fond sur un sentier de retour longeant
  l'extérieur du couloir jusqu'à la route (il vit dans la marge `WORLD_MARGIN`).
- **Retour rapide diégétique** : une « lanterne de retour » au fond (interaction E)
  qui téléporte à l'arche avec un fondu — trivial à implémenter
  (`controls.placeAt`), cohérent avec l'univers.

### 4.3 Donner un sens à l'ordre des tombes : la promenade chronologique

**Constat.** `buildChunkGraves` associe `colleagues[i]` → `placements[i]` dans
l'ordre brut de l'API. La position d'une tombe ne signifie rien ; deux visites
racontent la même non-histoire.

**Recommandation.** Trier les collègues par **date de départ** avant l'association
(tri stable par id en cas d'égalité — le déterminisme est préservé puisque layout
et liste sont indépendants) : l'entrée = les départs récents, le fond = les anciens.
Marcher dans le cimetière devient **remonter le temps**, et l'axe âge (#25) cesse
d'être dispersé au hasard : le fond du cimetière est naturellement patiné, moussu,
affaissé — un gradient visuel gratuit qui structure la lecture de l'espace.

En complément : un **panneau de quartier** par chunk (« 2019 – 2021 », petite stèle
d'angle au bord de l'épine, texture canvas comme les enseignes) — les tranches
techniques du streaming deviennent des quartiers lisibles.

### 4.4 Orientation sur le chemin commun

**Constats.** La route n'a ni panneaux ni repères : les enseignes ne se lisent
qu'une fois devant l'arche ; `highlightGrave` (lien de partage #18) cherche la tombe
dans `gravesGroup` — si le chunk n'est pas chargé, le lien ne mène nulle part.

**Recommandations.**
- **Panneau directionnel au spawn** (et aux stations tous les 2–3 cimetières) :
  poteau à flèches listant les prochains cimetières et leur distance — les données
  (`slots`, ordre le long de la route) sont déjà dans `World`.
- **Réparer le voyage vers une tombe** : résoudre `companyId` + `placement` depuis
  le layout (pur, sans chargement), téléporter à l'entrée du bon chunk, laisser le
  streaming charger, puis placer la caméra — au lieu de chercher un mesh peut-être absent.
- **Boussole HUD** discrète (cap + nom du cimetière courant, déjà fourni par
  `onNearestCemetery`) ; en option une mini-carte du monde générée du layout pur
  (canvas 2D : centerline + rectangles des parcelles) — aucune donnée 3D nécessaire.
- **Repères nocturnes** : lanternes émissives aux arches (avec le bloom de 2.5,
  elles balisent la route de loin).

### 4.5 L'arrivée dans un cimetière : marquer le seuil

**Constat.** On entre « à vue » sous l'arche, mais rien ne change au passage — pas
de transition sonore ni visuelle ; l'enceinte se traverse (cf. 4.1).

**Recommandations.**
- Franchissement du seuil (`distanceToSlot` passe sous ~1 m) → **stinger audio**
  discret (cloche lointaine, corbeau — `ambientAudio` a déjà la notion de lieu),
  et titre du cimetière en surimpression HUD 2 s (le pattern existe pour le focus).
- Moduler l'ambiance **par karma du cimetière** à l'intérieur de l'enceinte :
  brume légèrement plus dense et désaturation dans un cimetière très négatif
  (le grade par ambiance de 2.1 donne le point d'accroche).

---

## 5. Immersion — faire exister le monde au-delà du rendu

Les sections 2–4 rendent le monde *beau* et *lisible* ; celle-ci le rend *vivant*.
Classé du plus au moins impactant, à effort comparable.

### 5.1 Le son est le chantier d'immersion le plus rentable

**Constat.** `ambientAudio.ts` se limite à un souffle de vent synthétisé (bruit
blanc filtré) modulé par la météo. Aucun `AudioListener`/`PositionalAudio` dans le
projet : le monde 3D est **muet spatialement** — pas de pas, pas de faune, rien ne
sonne « quelque part ».

**Recommandations (dans l'ordre).**
- **Bruits de pas selon la surface.** L'information existe déjà : `distanceToPath`
  dit si l'on marche sur la terre battue, la splat sait si c'est herbe ou neige
  (`seasonKey`), `nearRoad` couvre la route. Synthétiser 3–4 variantes (gravier,
  herbe feutrée, neige crissante) comme le vent — Web Audio pur, zéro asset —
  cadencées sur la vitesse réelle des contrôles. C'est LE retour sensoriel qui
  ancre la première personne ; son absence se « sent » sans qu'on sache pourquoi.
- **Sources positionnelles** (`THREE.PositionalAudio`, natif Three.js) : corbeaux
  dans les arbres des chunks chargés (1–2 par chunk, graine du chunk), cloche très
  lointaine côté spawn, craquements de bois près des deadfalls (2.7). Le panning
  stéréo + l'atténuation par distance donnent la profondeur que le vent global ne
  donnera jamais.
- **Sonoriser les 3 axes à bout portant** : sous ~3 m d'une tombe très hantée, un
  murmure grave presque subliminal ; près d'une bénie, un carillon ténu ; les
  bougies d'offrandes crépitent. L'axe votes devient perceptible **avant** d'être vu.
- **Le vent audio suit déjà la météo — le lier aussi au vent visuel** : `wind.ts`
  expose une horloge partagée herbe/arbres ; moduler le gain du souffle sur la même
  intensité pour que ce qu'on entend corresponde à ce qui bouge.

### 5.2 Transitions d'ambiance : supprimer les « pops »

**Constat.** `maybeRefreshAmbiance` (`cemetery.ts`) applique la nouvelle météo ou
l'heure **instantanément** : ciel, brouillard et lumières sautent d'un état à
l'autre en une frame, toutes les 5–15 min. Rien ne brise plus l'immersion qu'un
monde qui change de couleur d'un coup.

**Recommandation.** Interpoler dans la boucle : conserver `Ambiance` courante et
cible, et lerp couleurs (fog, hemi, key, ground) + scalaires (densité, intensités)
sur **30–60 s**. Les couleurs sont déjà des hex → `THREE.Color.lerp` ; la logique
d'easing est une fonction pure testable (`ambianceBlend(from, to, t)`). Le
crépuscule qui *tombe* progressivement pendant qu'on se recueille est un moment de
jeu en soi. (Une seule vigilance : ne recalculer la shadow map qu'à pas espacés
pendant le lerp, `autoUpdate` étant déjà à `false`.)

### 5.3 Orage complet — la météo existe, pas son spectacle

**Constat.** `orageux` ne fait aujourd'hui qu'assombrir l'ambiance et épaissir le
souffle. Pas de pluie visible (la couleur `rain` des particules existe pourtant
dans `decor.ts`), pas d'éclairs.

**Recommandations.**
- Particules de pluie par météo (le système de `decor.ts` sait déjà faire tomber
  neige/feuilles — la pluie est le même code, vitesse verticale plus forte).
- **Éclairs** : flash de 2–3 frames (intensité de l'`AmbientLight` + ciel blanchi),
  puis **tonnerre décalé** de 1–4 s selon une distance fictive — le délai
  lumière/son est un réflexe primitif qui rend l'orage réel. Web Audio : burst de
  bruit brun filtré, pas d'asset.
- **Ombres de nuages** par beau temps : une texture de bruit qui défile, multipliée
  dans le shader du sol (un `onBeforeCompile` de plus dans `grass.ts`, uniform de
  temps déjà disponible). Effet énorme sur les grandes étendues, coût quasi nul.

### 5.4 Un corps pour le joueur

**Constat.** La caméra glisse comme un drone : aucune oscillation de marche, FOV
fixe, aucun poids.

**Recommandations.**
- **Head bob discret** (2–3 cm, fréquence calée sur la cadence des pas de 5.1 pour
  que son et mouvement coïncident) + micro-roulis en strafe ; amplitude nulle à
  l'arrêt. Option « réduire les mouvements » dans le panneau Ambiance
  (accessibilité).
- **FOV kick** en courant (+4–6°, lerpé) : la course se *sent* au lieu d'être un
  simple multiplicateur de vitesse.
- À l'interaction de recueillement (5.5) : léger abaissement de caméra — le corps
  s'agenouille.

### 5.5 Rituels : donner des gestes au recueillement

**Constat.** Les emotes existent (`wave`/`pray`/`flower` dans `avatars.ts`) mais
s'affichent en **émoji dans une bulle** — une notification, pas un geste. La
citation du collègue (`quote`, `types.ts:31`) ne vit que dans le dialogue HUD 2D.

**Recommandations.**
- **Se recueillir** (touche near-focus) : caméra qui s'abaisse et se cale face à la
  stèle 3–4 s, brève montée de la brume/du silence (duck du vent), emote `pray`
  relayée aux pairs. Transforme la lecture d'une tombe en moment.
- **Graver la citation au dos de la stèle** : même pipeline canvas que
  `makeNameTexture`, révélée quand on fait le tour — récompense l'exploration et
  sort la citation du HUD. (Le dialogue 2D reste pour l'édition.)
- **Le dépôt d'offrande devient un geste** : au lieu d'un simple POST + rebuild,
  jouer l'animation — l'objet apparaît dans la main (fixé caméra), s'incline, la
  tombe se reconstruit *après* la pose. Trois secondes qui changent la nature de
  l'acte.
- **Cloche à l'arche** (interaction E) : audible par tous les visiteurs du monde
  via la présence (#4) — un signal social diégétique (« quelqu'un entre »).

### 5.6 Faune discrète — un monde qui réagit

**Constat.** Seul Halloween a de la vie animée (chauves-souris, `decor.ts`). Le
reste de l'année, rien ne bouge que l'herbe.

**Recommandations (par coût croissant).**
- **Papillons** le jour près des tombes bien entretenues, **mouches** (points
  sombres orbitant) sur les négligées — encore l'axe entretien rendu sensible,
  même technique que les chauves-souris existantes.
- **Corbeaux posés** sur les murs/branches qui **s'envolent à l'approche** (< 4 m :
  bascule posé → courbe de fuite + son 5.1). C'est le monde qui *réagit au joueur* —
  le déclencheur d'immersion le plus fort de cette liste.
- **Un gardien par cimetière** : un animal déterministe par graine (chat, corbeau,
  chouette selon le thème 3.3) qui erre sur l'épine. Les habitués le reconnaissent —
  « le chat de chez Acme ».

### 5.7 Présence : des fantômes plus fantomatiques

**Constat.** Les avatars (`avatars.ts`) sont des capsules translucides statiques —
lisibles mais raides : pas d'oscillation, opacité fixe, emotes en émoji plates.

**Recommandations.**
- Flottement sinusoïdal léger (±4 cm, phase par id), opacité qui **pulse doucement**,
  traîne de 3–4 particules s'estompant derrière le déplacement — le vocabulaire
  visuel « fantôme » complet, trois petites modifs dans `updatePeers`.
- La nuit, chaque visiteur porte une **lanterne** (point émissif + halo bloom 2.5) :
  on voit de loin les lueurs des autres se déplacer entre les tombes — la plus belle
  image « multijoueur » possible pour ce jeu, presque gratuite.
- **Échos de visite** (optionnel, côté serveur) : rejouer en silhouettes très
  faibles (opacité ~0,1) des trajectoires enregistrées de visiteurs passés quand le
  salon est vide — un cimetière n'est jamais tout à fait désert.

### 5.8 Événements rares et mémoire du monde

Ce qui fait raconter « tu te souviens quand… » :
- **Étoile filante** la nuit (~1 chance/min, seedée sur l'horloge) — deux points
  émissifs et une traînée ; **halo de brume exceptionnel** certains matins.
- **Anniversaire de départ** : le jour J (donnée déjà en base), la tombe du
  collègue s'allume de bougies d'office et son quartier reçoit un léger surcroît de
  lucioles — le monde se souvient tout seul, sans action utilisateur.
- **Usure sociale des chemins** : compteur de visites par cimetière côté API →
  élargir/renforcer la bande de terre de la splat selon la fréquentation réelle. Un
  cimetière très visité a un chemin creusé ; un oublié se fait envahir par l'herbe.
  La donnée sociale devient géologie.

---

## 6. Ordre d'attaque suggéré

1. **Vague « brancher l'existant »** (le meilleur ratio gain/effort, quasi sans
   risque) : post-process dans `Cemetery` (2.1) + bloom sélectif (2.5) + deadfall/
   understory (2.7) + décision grass ring (2.7).
2. **Vague « monde commun »** : route spline + texture (2.2), terrain + sol + forêt
   unifiée (2.3), panneaux directionnels (4.4). C'est la première impression du jeu.
3. **Vague « parcours »** : suivi du relief + collisions (4.1), boucle/retour (4.2),
   tri chronologique + quartiers (4.3).
4. **Vague « variété »** : allées vertes — végétation en bandes + bras-allées
   ramifiés (3.5, le plus structurant de cette vague), épine serpentante (3.1),
   jitter (3.2), thèmes (3.3), clusters enrichis (3.4), ciel de nuit (2.4).
5. **Vague « vie du monde »** : bruits de pas + transitions d'ambiance lissées
   (5.1, 5.2 — les deux plus rentables, éligibles dès la vague 1 car indépendantes),
   puis orage complet (5.3), corps du joueur (5.4), rituels (5.5), faune (5.6),
   fantômes améliorés (5.7), événements rares (5.8).

Chaque chantier respecte la Definition of Done du projet : logique pure extraite et
testée (Vitest) — offsets d'épine, tri chronologique, collisions, thèmes sont tous
des fonctions pures candidates — et parcours e2e mis à jour quand le HUD ou le
déplacement changent. Aucun `Math.random()` dans la génération : tout dérive de
`hashSeed`/`seededRandom` comme aujourd'hui.
