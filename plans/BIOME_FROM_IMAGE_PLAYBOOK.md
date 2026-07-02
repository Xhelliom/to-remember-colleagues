# Playbook — d'une image concept à un mini-biome

Workflow réexploitable pour transformer une **image de référence** (générée ou
trouvée) en **mini-biome 3D** mesurablement fidèle. Éprouvé sur le biome cimetière
« clairière cocoon » (similarité 27 % → 59 %). À réutiliser pour les prochains
thèmes : **enfer** (rouge/lave), **paradis** (blanc/or/nuages), etc.

Principe directeur : **on ne juge pas « à l'œil », on mesure**. Une image concept
donne un *vecteur cible* ; on itère le biome jusqu'à s'en rapprocher.

---

## Boîte à outils (réutilisable telle quelle)

| Fichier | Rôle | Générique ? |
|---------|------|-------------|
| `e2e/png.ts` | Décode un PNG (zlib natif, sans dépendance) | ✅ |
| `e2e/imageDescriptor.ts` | Descripteur **générique** (luminance, saturation, vignette, symétrie, **histogramme de teintes 12 secteurs**, grille de luminance 3×3) + `similarity()` | ✅ tout thème |
| `e2e/clusterMetrics.ts` | Descripteur **spécialisé** cimetière (green/earth/grave…) | exemple à copier |
| `e2e/captureBiome.ts` | Capture un rendu carré du harnais (`toDataURL`) → PNG décodé | ✅ |
| `e2e/analyzeCluster.ts` | CLI : `node … <concept.png> [<render.png>]` → vecteur + score | ✅ |
| `?testCluster=<seed>` dans `web/src/main.ts` | Harnais de scène isolé (caméra canonique, grade, capture) | motif à copier |

**Générique vs spécifique** : `imageDescriptor` marche pour n'importe quel thème
(l'histogramme de teintes distingue vert/rouge/blanc automatiquement). Les métriques
« nommées » (green, earth, grave) sont **spécifiques cimetière** — pour l'enfer on
écrirait plutôt fire/lava/rock. Commencer avec le générique, spécialiser au besoin.

---

## Le workflow, étape par étape

### 0. Image concept
Générer (skill `gpt-image-2`) ou fournir une image **carrée** (1024²), vue première
personne à hauteur d'œil, cadrage représentatif. La sauvegarder dans `images/`.

### 1. Extraire le vecteur de référence
```bash
node --experimental-strip-types e2e/analyzeCluster.ts images/<concept>.png
```
→ le vecteur cible **mesuré** (pas estimé). Surprises fréquentes : la scène est bien
plus **sombre** et **désaturée** qu'on ne croit (le cimetière : meanLum 0.15, pas 0.3).

### 2. Décomposer en objectifs mesurables
Écrire un référentiel (cf. `CLUSTER_BIOME_CRITERIA.md`) :
- **Géométriques** (exacts, testables sans rendu) : rayons des anneaux, nombre/arc
  d'objets, disque central, caméra canonique…
- **Photométriques** (sur le rendu carré) : cibles du vecteur de référence.

Repérer les **invariants de composition** de l'image : symétrie ? anneaux
concentriques ? zone claire / zone sombre (vignette) ? point focal ?

### 3. Harnais de test isolé
Bypass du routing via un param d'URL (`?testCluster=` → à dupliquer en `?testEnfer=`).
Le harnais fournit la partie **réutilisable** :
- `renderer` avec **`preserveDrawingBuffer: true`** (obligatoire pour la capture)
- caméra canonique fixe (hauteur d'œil, distance, cible) — **même cadrage que le concept**
- pipeline de post-traitement (color grade) + `document.body.dataset.ready`
Itérer ici, pas en marchant 300 m dans le vrai monde.

### 4. Construire la STRUCTURE d'abord (avant la lumière)
Poser la géométrie : anneaux/arcs, sol, props, placement des objets. Valider la
composition en plein jour avant de toucher à l'ambiance. *Leçon : la structure
d'abord — un beau grade sur une mauvaise structure reste mauvais.*

### 5. Lumière + color grade
- **Contraste spatial** : le point clé du réalisme. Une **flaque de lumière** sur la
  zone focale (sol/centre) SOUS un pourtour sombre — c'est ce qui « fait » l'image.
- **Color grade** plein écran (`EffectComposer` + `ShaderPass`) : désaturation +
  vignette + contraste. Indispensable pour matcher un concept *gradé*.
- Régler l'exposition (`toneMappingExposure`) pour viser `meanLum` de la référence.

### 6. Boucle de mesure
Un test E2E (cf. `clusterBiome.spec.ts`) : `captureBiome()` → `analyze()`/`describe()`
→ `similarity()` vs concept, imprime le score et échoue sous un seuil.
```bash
PW_CHROME=/usr/bin/google-chrome-stable pnpm exec playwright test <biome>
```

### 7. Itérer jusqu'au seuil
Regarder **le vecteur**, pas que le score : la métrique la plus éloignée = le
prochain levier. Ordre d'impact observé sur le cimetière :
`structure > flaque de lumière au sol > désaturation/grade > exposition > détails`.

### 8. Intégrer en production + tests
Brancher le builder dans le pipeline réel (`chunkMeshes` / `worldStreamer`), disposer
proprement (géométries **et** matériaux clonés), ajouter tests unitaires (déterminisme)
+ garder le test E2E de similarité comme garde anti-régression.

---

## Pièges & astuces (durement gagnés)

- **Capture headless lente** : le `screenshot` Playwright boucle sur les *ReadPixels*
  de swiftshader (timeout). Solution : `preserveDrawingBuffer` + `canvas.toDataURL()`
  côté page (un seul readback). C'est ce que fait `captureBiome`.
- **Chrome pour Playwright** : `PW_CHROME=/usr/bin/google-chrome-stable` (le chromium
  bundlé n'est pas installé). Config déjà prévue (`PW_CHROME`).
- **Dump d'image pour inspection** : écrire le PNG depuis le worker Playwright dans le
  **scratchpad** et lancer la commande **sans sandbox** (sinon l'écriture du
  sous-process est isolée et le fichier « disparaît »).
- **Seuils de classification fragiles** : les champs nommés (isEarth/isGrass) ratent
  les teintes sombres/rouges → préférer le **descripteur générique** (histogramme) et
  ne spécialiser que si nécessaire. Ne pas *bricoler les seuils pour gonfler le score*.
- **Le concept est gradé** : un rendu temps réel brut n'atteindra pas 100 %. Viser une
  bonne **composition + ambiance** (générique ~90 %+) plutôt que le pixel-perfect.

---

## Ajouter un nouveau biome (recette express)

1. `images/<biome>-concept.png` (skill `gpt-image-2`).
2. `node e2e/analyzeCluster.ts images/<biome>-concept.png` → vecteur cible.
3. Nouveau `web/src/scene/<biome>.ts` : builder de la structure (copier la forme de
   `clusterBiome.ts` : Clearing/anneaux, dispose des ressources clonées).
4. Harnais : ajouter `?test<Biome>=<seed>` dans `main.ts` (dupliquer `runClusterTest`,
   adapter caméra + lumière + grade au thème — enfer = clé rouge/orange, exposition
   plus haute ; paradis = clé blanche/dorée, brume claire, vignette faible).
5. `e2e/<biome>.spec.ts` : `captureBiome()` + `similarityGeneric()` vs le concept.
6. Itérer (étapes 5–7), puis intégrer (étape 8).

> À la **2ᵉ ou 3ᵉ** copie, factoriser le harnais commun (`runBiomeTest(builder, opts)`)
> et un registre `?testBiome=<nom>` — l'abstraction sera juste car adossée à ≥ 2 cas
> réels. Pas avant (YAGNI).
