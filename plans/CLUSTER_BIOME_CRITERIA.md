# Référentiel de similarité — Cluster biome vs concept image

Objectif : mesurer finement l'écart entre le cluster généré (`?testCluster=<seed>`)
et `images/cluster-cocoon-concept.png`, avec des cibles chiffrées et une méthode
de mesure reproductible. Remplace le jugement « ça ressemble » par un score.

Référence : `images/cluster-cocoon-concept.png` (1024×1024).

---

## 0. Décomposition analytique du concept

Vue première personne, œil ~1,7 m, à l'entrée d'une **clairière** (pas une avenue).
Positions en coordonnées normalisées `[0,1]²` (origine haut-gauche) sur le concept.

| Élément | Description | Position(s) approximative(s) |
|---------|-------------|------------------------------|
| Allée en terre | Bande de terre depuis le bas-centre, se rétrécit vers la clairière, très légère courbe | base `(0.5, 1.0)` → arrivée `(0.5, 0.58)` |
| Bornes de pierre | 2 blocs dressés encadrant l'entrée de l'allée | `(0.14, 0.70)`, `(0.85, 0.71)` |
| Cailloux épars | Pierres roulées bordant l'allée | le long de l'allée |
| Herbe haute | Herbe sauvage mi-hauteur, remplit la clairière et borde l'allée | `y ∈ [0.55, 0.9]` |
| Tombes (arc) | ~8 pierres en **arc** face au visiteur, dos à la clairière | `y ∈ [0.43, 0.50]`, `x ∈ [0.15, 0.88]` |
| Monument central | Pierre ornée à sommet cintré, sur socle — **la plus haute**, sur l'axe | `(0.48, 0.44)` |
| Croix celtiques | 2 croix hautes, placées **symétriquement** gauche/droite | `(0.22, 0.44)`, `(0.77, 0.43)` |
| Buissons | Lierre/buissons denses entre/derrière les tombes, au pied des arbres | anneau `y ∈ [0.38, 0.55]` |
| Arbres (voûte) | Grands troncs cernant la clairière, canopées arquées vers le centre | remplissent `y ∈ [0, 0.5]` |
| Trouée de ciel | Petites ouvertures claires dans la canopée (rais de lumière) | `(0.42, 0.05)`, halo `(0.5, 0.28)` |

**Invariants de composition** :
- **Symétrie gauche/droite** marquée (allée centrée, une croix de chaque côté, arbres cadrant).
- **Rings concentriques** autour du centre du cluster : tombes < terre < buissons < arbres.
- **Fer à cheval** : arbres + buissons couvrent ~270°, **ouverts côté allée/visiteur**.
- **Clé de voûte lumineuse** : la seule zone claire est la trouée haut-centre + le sol ensoleillé au débouché de l'allée ; **le reste est sombre** (vignette forte).

---

## 1. Objectifs GÉOMÉTRIQUES (mesurés sur les données de scène — exacts, déterministes)

Rayons ancrés sur `CLUSTER_RADIUS = 3` (rayon de l'anneau de tombes existant).
Mesure : fonction pure `clusterGeometry(params)` → métriques, asserties en tests unitaires.

| ID | Objectif | Cible | Tolérance | Poids |
|----|----------|-------|-----------|-------|
| G1 | **Allée** en terre : largeur | 1,0–1,4 m | ±0,2 | 4 |
| G2 | Allée : longueur (bord clairière → caméra) | 5–8 m | ±1 | 3 |
| G3 | Allée : légère courbe (écart max à la droite) | 0,3–1,0 m | — | 2 |
| G4 | **Centre en terre** : rayon du disque de terre | `R_graves + 1` = 4 m | ±0,5 | 6 |
| G5 | Herbe **supprimée** dans le disque de terre, présente au-delà | oui | binaire | 5 |
| G6 | **Tombes en arc** : nombre | = taille du cluster (4–6) | exact | 6 |
| G7 | Tombes sur un cercle de rayon | `R_graves` = 3 m | ±0,3 | 6 |
| G8 | Tombes réparties en **arc ouvert côté allée** (couverture angulaire) | 160–210° | ±20° | 5 |
| G9 | **Monument central** au centre, plus haut que toute tombe/buisson | ratio h ≥ 1,3 | — | 5 |
| G10 | 2 **croix celtiques** placées symétriquement (±) sur l'arc | oui | binaire | 3 |
| G11 | **Buissons** : anneau de rayon | 4,5–6 m | ±0,5 | 4 |
| G12 | Buissons : couverture angulaire (mur vert) | ≥ 80 % | — | 4 |
| G13 | Buissons : hauteur | 1–2 m | ±0,3 | 2 |
| G14 | **Arbres** : anneau (fer à cheval) rayon | 7–10 m | ±1 | 5 |
| G15 | Arbres : couverture angulaire, ouverte côté allée | 250–300° | ±20° | 5 |
| G16 | Arbres : inclinaison vers le centre (voûte) | 0,12–0,20 rad | ±0,03 | 4 |
| G17 | **Voûte fermée sauf trouée** : canopées se rejoignent en haut, 1 gap central conservé | oui | binaire | 4 |
| G18 | **Bornes de pierre** encadrant l'entrée de l'allée (2) | oui | binaire | 2 |
| G19 | **Cailloux** épars le long de l'allée | ≥ 4 | — | 1 |
| G20 | **Caméra canonique** : hauteur / distance au centre / cible | 1,7 m / 9 m / centre@1,6 | ±0,2 | 5 |

Décision d'architecture (issue du retour) : **le mini-biome possède l'emplacement des
tombes** (il expose les ancres de l'arc), pour garantir la concentricité terre/tombes/
buissons/arbres. `procedural.ts` fournit le centre + le nombre ; le biome place l'arc.

---

## 2. Objectifs PHOTOMÉTRIQUES (mesurés sur un rendu carré canonique)

Rendu de référence : capture **1024×1024** à la caméra canonique (G20).
Régions normalisées : haut `y∈[0,.33]`, milieu `[.33,.66]`, bas `[.66,1]` ;
colonne centrale `x∈[.4,.6]` ; bordure = 12 % extérieurs.

**Méthode de comparaison fine** : l'analyseur (`e2e/clusterMetrics.ts`) calcule le
**même vecteur de métriques sur le concept ET sur le rendu**. Similarité = `1 − distance
L2 normalisée` entre les deux vecteurs (`similarity()`).

### 2.1 Vecteur de référence — MESURÉ sur le concept (source de vérité)

Extrait par `node e2e/analyzeCluster.ts images/cluster-cocoon-concept.png`.
Ces valeurs remplacent mes estimations : le rendu doit converger vers **elles**.

| Champ | Réf. concept | Robustesse | Lecture |
|-------|-------------:|------------|---------|
| meanLum | **0.147** | robuste | scène **très sombre** (pas 0.3) |
| vignette | **2.43** | robuste | centre >> bords |
| canopyTop | 0.151 | seuil-sensible | feuillage dans l'ombre → peu « vert » |
| skyGapArea | 0.0038 | robuste | trouée petite et sombre |
| skyGapX / skyGapY | 0.418 / 0.346 | moyenne | trouée haut-centre |
| pathEarth | **0.568** | robuste | **terre dominante** en bas-centre |
| grass | 0.130 | seuil-sensible | herbe surtout à l'ombre |
| graveBlobs | 20 | bruitée | ≥ ~6 taches pierre (surcompte) |
| graveTallestX | 0.560 | moyenne | monument proche de l'axe |
| symmetry | **0.931** | robuste | composition symétrique |
| green / brown / blue | 0.126 / 0.137 / 0.008 | robuste | **brun ≈ vert**, ~pas de bleu |
| meanSat | 0.194 | robuste | très désaturé |

**Cibles prioritaires (robustes)** pour le rendu : `meanLum ≈ 0.15`, `vignette ≥ 2`,
`pathEarth ≈ 0.55`, `symmetry ≥ 0.9`, `blue < 0.03`, `meanSat < 0.25`, `brown ≈ green`.
Les champs « seuil-sensibles » comptent moins (mêmes seuils des deux côtés = comparaison
valide, mais interprétation à relativiser).

### 2.2 Définition conceptuelle des métriques (cibles indicatives)

| ID | Métrique | Cible (concept, provisoire) | Tolérance | Poids |
|----|----------|-----------------------------|-----------|-------|
| P1 | Luminance moyenne globale (ambiance sombre) | 0,25–0,38 | ±0,05 | 5 |
| P2 | Ratio vignette `L(centre 30 %)/L(bordure 12 %)` | ≥ 1,4 | — | 4 |
| P3 | Couverture canopée bande haute (feuillage vert sombre) | ≥ 0,55 | −0,1 | 5 |
| P4 | Trouée : aire des pixels clairs `L>0.7` en haut-centre | 1–8 % | ±2 % | 4 |
| P4b | Trouée : centroïde du plus clair | `x∈[.4,.6], y∈[.05,.35]` | — | 2 |
| P5 | Bande d'allée : pixels terre (teinte 15–45°) en bas-centre | ≥ 4 % de la bande basse | −1 % | 4 |
| P6 | Couverture herbe (vert) bande basse | ≥ 0,40 | −0,1 | 3 |
| P7 | Silhouettes de tombes (blobs gris peu saturés) bande milieu | ≥ 4 | — | 5 |
| P7b | Blob le plus haut proche de l'axe (monument) | `x∈[.4,.6]` | — | 2 |
| P8 | Symétrie G/D : `SSIM(image, miroir(image))` | ≥ 0,50 | — | 4 |
| P9 | Palette : parts vert > brun > bleu ; saturation moyenne | `S̄ < 0,45` | — | 3 |

---

## 3. Score agrégé & barre de passage

```
score_geo   = Σ(poids_Gi · réussite_Gi) / Σ poids_G      // réussite ∈ [0,1] (dans tol. = 1, dégradé linéaire)
score_photo = 1 − distance_normalisée(vecteur_rendu, vecteur_concept)
score_total = 0,6 · score_geo + 0,4 · score_photo
```

**Passe si `score_total ≥ 0,80`** ET aucun objectif de poids ≥ 5 en échec dur.

---

## 4. Harnais de mesure (à implémenter)

- **Géométrique** : `web/src/scene/clusterGeometry.ts` (pur) + `clusterGeometry.test.ts`
  — assertions G1–G20 sur les paramètres/ancres du biome. Aucun rendu, déterministe.
- **Photométrique** : `e2e/clusterBiome.spec.ts` capture le PNG carré canonique ;
  `e2e/analyzeCluster.ts` calcule P1–P9 sur le rendu **et** sur le concept, émet le
  vecteur + le score, échoue hors tolérance. (décodage PNG via `pngjs`, déjà tirable
  par Playwright ; sinon `sharp`.)

---

## 5. État du modèle actuel vs objectifs (au moment de l'écriture)

| Écart | Objectif violé |
|-------|----------------|
| Arbres en avenue le long d'un chemin de 15 m | G14, G15, G17 |
| Pas de centre en terre (grass partout) | G4, G5 |
| Pas de tombes dans la scène de test | G6–G10, P7 |
| Pas de bornes de pierre ni cailloux | G18, G19 |
| Caméra à 15 m en tunnel | G20 |
| Allée droite, trop longue | G2, G3 |

→ Refonte : revenir à l'anneau/fer à cheval (l'arc initial était bon), ajouter le
disque de terre central, faire posséder l'arc de tombes par le biome, caméra au
débouché de la clairière.
