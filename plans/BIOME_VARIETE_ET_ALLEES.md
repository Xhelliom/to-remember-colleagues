# Notes — variété des biomes & décoration d'allées (linéaire)

Notes de travail pour reprise en session ultérieure. Deux sujets liés :
1. **Variété** : rendre les biomes moins répétitifs (même vibe, instances différentes).
2. **Allées** : appliquer le process image→biome à du **linéaire** (chemins), sans
   « blocs répétés » ni rigidité.

Contexte : voir `plans/BIOME_FROM_IMAGE_PLAYBOOK.md` (workflow + kit de mesure) et
`plans/REVUE_3D_PERF_RENDU.md` (perf). Modèles désormais **décimés** dans
`/models/opt/*.glb` (`tools/optimize-models.sh`) → ~98 % de tris en moins : ajouter de
la variété de modèle coûte maintenant bien moins cher qu'avant.

---

## 1. Randomisation actuelle du biome « clairière »

Fichier : `web/src/scene/biomes/clairiere/builder.ts` (RNG seedé par
`companyId + position du cluster` → **déterministe** : varié entre clusters, stable
par cimetière ; règle de reproductibilité du projet).

| Élément | Ce qui varie (seedé) | Variété de **modèle** |
|---------|----------------------|-----------------------|
| Arbres voûte | nombre 9–13, rayon ±1,2 m, échelle 2,0–3,2 | ❌ 1 modèle (jacaranda), pas de rotation Y (face au centre) |
| Buissons | nombre 10–16, rayon ±0,8 m, **rotation libre**, échelle 0,9–1,5 | ✅ **3 espèces** (`BUSH_PATHS`) |
| Herbe (`grassField.ts`) | position, rotation libre, largeur 0,8–2,0, hauteur 1,0–3,5 | ❌ 1 modèle (selon karma) |
| Prop / cailloux | échelle, rotation | — |

**Constat** : la variété vient surtout de la **transformation** (échelle/rotation/
position/nombre), peu du **modèle**. Arbres et herbe répètent la même silhouette
retaillée ; seuls les buissons ont une vraie diversité de forme.

### Pistes pour plus de variété (« autre arbre / autre touffe »)
- **Pool de modèles tiré au seed** : 2–3 arbres, 2–3 herbes, comme le fait déjà
  `vegetation.ts` (`treePath()` alterne `island_tree` / `tree_small` par hash). Le biome
  utilise le rendu **instancié** (`MatrixBuckets` : un `InstancedMesh` par asset) → un
  pool = +1 bucket/asset (quelques draw calls de plus, chaque asset reste instancié).
- **Rotation Y aléatoire des arbres voûte** (aujourd'hui absente) + léger tilt varié.
- **Variantes de teinte par instance** (déjà fait pour les buissons : `BUSH_DESAT`/
  `BUSH_DARKEN`) → décliner en légères variations chaud/froid.
- **Micro-variations de hauteur d'herbe par touffe** (déjà partiel) + quelques touffes
  « accent » plus hautes.
- Garder le **déterminisme** : tout via `seededRandom`/`hashSeed`, jamais `Math.random`.

---

## 2. Le process est-il applicable aux allées (linéaire) ? Oui

### Ce qui se réutilise tel quel
Le **process de mesure** (image concept → vecteur cible → itérer rendu → similarité)
est indépendant de la forme : un concept « marche dans une jolie allée » s'analyse et
s'itère avec le **même kit** (`e2e/png.ts`, `imageDescriptor.ts`, `captureBiome.ts`,
`analyzeBiome.ts`), la même convention **dossier-par-biome** + `manifest.ts`, le même
harnais `?test<Nom>=<seed>`.

### Ce qui diffère : le builder
- Clairière = modèle « **anneaux autour d'un point** » (`Clearing`).
- Allée = modèle « **distribution le long d'une polyligne** » : parcourir la centerline,
  poser des objets avec décalage latéral.
- Existant proche : `web/src/scene/vegetation.ts` décore déjà le couloir, mais par
  **dispersion uniforme aléatoire** (du bruit) — ça évite la grille mais ce n'est pas
  une allée *composée* (pas de rythme, pas d'intention).

### Anti-« blocs répétés » sans rigidité (leviers)
- **Espacement irrégulier** : intervalle = base + jitter seedé (jamais un modulo fixe
  → pas de cadence « bloc »).
- **Côtés alternés + décalage latéral** tirés au seed.
- **Pool de modèles + transform par instance** (échelle/rotation/inclinaison).
- **Accents rares** à faible probabilité (banc, lanterne, gros arbre, trouée, statue)
  pour casser la monotonie — l'astuce du « rare focal ».
- **Densité en gradient / grappes** (type Poisson-disc) plutôt que parfaitement régulier.
- **Continuité inter-chunks** : seed par **position absolue** le long du chemin → le
  rythme ne « reset » pas aux jointures (pas de couture visible au bord des tranches).

### Exemples de vibes d'allée (non rigides)
- **Allée de cyprès funéraire** — colonnes sombres irrégulières, brume.
- **Sous-bois envahi** — herbes hautes débordant sur le chemin, racines, lumière tachetée.
- **Allée pavée & lanternes** — dalles usées, lampes à intervalles irréguliers, muret bas.
- **Jardin du souvenir fleuri** — massifs, bancs, variété de couleurs.
- **Allée spectrale brumeuse** — arbres nus clairsemés, halos, silence.

### Hook « vibe par allée » déjà disponible
Le système karma/ambiance module déjà l'aspect (karma → herbe on/off + bordure
rocheuse ; saison → neige ; mode Halloween). Une allée peut piloter sa vibe depuis le
**statut/karma de l'entreprise** — variation gratuite sans tout coder à la main.

---

## Où reprendre (points d'entrée code)
- Builder du biome (variété) : `web/src/scene/biomes/clairiere/builder.ts`
  (constantes `*_COUNT/_SCALE/_JITTER`, `BUSH_PATHS`, `MatrixBuckets`).
- Herbe : `web/src/scene/grassField.ts` (`grassPath`, boucle de placement des brins).
- Décor linéaire existant à faire évoluer : `web/src/scene/vegetation.ts`
  (`buildPlacementMatrices` = dispersion uniforme) + `fence.ts`.
- Un futur biome d'allée suivrait la recette « ajouter un biome » du playbook, avec un
  builder *path-following* au lieu du modèle `Clearing`.
