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

### 3.5 Le monde commun aussi est procédural — mais trop peu

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

## 5. Ordre d'attaque suggéré

1. **Vague « brancher l'existant »** (le meilleur ratio gain/effort, quasi sans
   risque) : post-process dans `Cemetery` (2.1) + bloom sélectif (2.5) + deadfall/
   understory (2.7) + décision grass ring (2.7).
2. **Vague « monde commun »** : route spline + texture (2.2), terrain + sol + forêt
   unifiée (2.3), panneaux directionnels (4.4). C'est la première impression du jeu.
3. **Vague « parcours »** : suivi du relief + collisions (4.1), boucle/retour (4.2),
   tri chronologique + quartiers (4.3).
4. **Vague « variété »** : épine serpentante (3.1), jitter (3.2), thèmes (3.3),
   clusters enrichis (3.4), ciel de nuit (2.4).

Chaque chantier respecte la Definition of Done du projet : logique pure extraite et
testée (Vitest) — offsets d'épine, tri chronologique, collisions, thèmes sont tous
des fonctions pures candidates — et parcours e2e mis à jour quand le HUD ou le
déplacement changent. Aucun `Math.random()` dans la génération : tout dérive de
`hashSeed`/`seededRandom` comme aujourd'hui.
