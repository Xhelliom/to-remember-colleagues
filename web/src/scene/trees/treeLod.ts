// Chaîne LOD des arbres (mission 10) : hero (géométrie complète, unique) →
// cards R1 → cards R2 (bark + feuillage en cartes, instanciés PAR ESPÈCE/VARIANTE,
// mission 09) → impostor (quad billboard, mission 10 impostors.ts) → canopy
// shell (mission 10 canopyShell.ts, forêt lointaine agrégée). Orchestre le
// placement + la sélection de palier par distance (distanceLod.ts) + le
// crossfade anti-pop à la frontière cards↔impostor.
//
// « Jamais de hero instancié en masse » : au plus `MAX_HERO_INSTANCES` arbres
// hero simultanés (les plus proches), le reste dégradé en impostor. Les cards
// R1/R2 instancient un petit pool de VARIANTES canoniques (comme ATLAS_GRID
// pour les cartes de feuillage, mission 09) plutôt qu'une géométrie unique par
// arbre — sinon aucune InstancedMesh n'est possible (chaque graine produit un
// squelette distinct, cf. skeleton.ts).
import * as THREE from "three";
import { buildTree, type TreeBuild } from "./treeBuilder.ts";
import { hashSeed } from "../../procedural.ts";
import { selectLodTier, transitionProgress, ditherValue } from "../distanceLod.ts";
import { buildImpostorMesh, getOrCaptureImpostorAtlas, nearestViewsBlend, type ImpostorMesh } from "./impostors.ts";
import { buildCanopyShell, type CanopyShellBuild } from "./canopyShell.ts";

// --- Paliers de distance (m) — hero → cards R1 → cards R2 → impostor -------

const TREE_LOD_HERO_MAX = 30;
const TREE_LOD_CARDS_R1_MAX = 55;
const TREE_LOD_CARDS_R2_MAX = 95;
export const TREE_LOD_THRESHOLDS: readonly number[] = [TREE_LOD_HERO_MAX, TREE_LOD_CARDS_R1_MAX, TREE_LOD_CARDS_R2_MAX];
// Exportée (comme RING_HYSTERESIS dans grassRing.ts) : le test anti-pop
// (e2e/forest.spec.ts) en a besoin pour balayer précisément la fenêtre de
// transition [seuil-hystérésis, seuil+hystérésis] depuis le contexte page.
export const TREE_LOD_HYSTERESIS = 3;

export const TREE_LOD_TIER_HERO = 0;
export const TREE_LOD_TIER_CARDS_R1 = 1;
export const TREE_LOD_TIER_CARDS_R2 = 2;
export const TREE_LOD_TIER_IMPOSTOR = 3;

/** Palier actif à `distance`, avec hystérésis (cf. distanceLod.ts). Monotone :
 *  ne peut jamais sauter de palier en avançant, testé par treeLod.test.ts. */
export function pickTreeLodTier(distance: number, current: number): number {
  return selectLodTier(distance, TREE_LOD_THRESHOLDS, current, TREE_LOD_HYSTERESIS);
}

// --- Placement (calculé par l'appelant, cf. vegetation.ts) -----------------

export type TreePlacement = {
  readonly x: number;
  readonly y: number; // hauteur du sol au pied de l'arbre
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly seed: number;
};

/** Centroïde (x,z) d'un ensemble de placements — `{0,0}` si vide. Pur, testé. */
export function placementCentroid(placements: readonly TreePlacement[]): { x: number; z: number } {
  if (placements.length === 0) return { x: 0, z: 0 };
  const sum = placements.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / placements.length, z: sum.z / placements.length };
}

/** Rayon max des placements autour de (centerX, centerZ) — dimensionne le
 *  canopy shell (juste au-delà de la portée des arbres individuels). Pur, testé. */
export function placementBoundsRadius(placements: readonly TreePlacement[], centerX: number, centerZ: number): number {
  let max = 0;
  for (const p of placements) max = Math.max(max, Math.hypot(p.x - centerX, p.z - centerZ));
  return max;
}

// --- Constantes d'instanciation ---------------------------------------------

const MAX_HERO_INSTANCES = 6;
const CARDS_VARIANT_COUNT = 3; // pool de silhouettes canoniques par bande (cf. en-tête)
const CARDS_R1_LOD = 0;
const CARDS_R2_LOD = 1;
const CARDS_CAPACITY_PER_VARIANT = 120;
const IMPOSTOR_CAPACITY = 500;
/** Gabarit du quad impostor (m) — approx. de la silhouette de l'arbre de
 *  référence (BEECH_SPECIES : hauteur ≈ 6,5 m, largeur de couronne ≈ 5 m),
 *  mis à l'échelle par instance via `placement.scale`. */
const IMPOSTOR_QUAD_WIDTH = 5.5;
const IMPOSTOR_QUAD_HEIGHT = 6.5;
const IMPOSTOR_CENTER_HEIGHT = IMPOSTOR_QUAD_HEIGHT / 2; // même repère vertical que la capture (sphère englobante)
const TREE_TINT_MIN = 0.85;
const TREE_TINT_RANGE = 0.3;

const CANOPY_MARGIN = 20; // m au-delà du placement le plus lointain
const CANOPY_THICKNESS = 0; // non utilisé (mur simple), gardé nommé pour lisibilité de l'appel
const CANOPY_BASE_HEIGHT = 9;
const CANOPY_HEIGHT_VARIANCE = 4;
// Mur de « forêt lointaine » (concept open-world LAAS) DÉSACTIVÉ : dans un cimetière
// borné il dessinait un grand cercle vert autour de la parcelle. Les impostors couvrent
// déjà le fond. Réactiver (+ retuner rayon/hauteur) si on veut une silhouette au loin.
const CANOPY_SHELL_ENABLED = false;

type CardsVariant = { readonly bark: THREE.InstancedMesh; readonly foliage: THREE.InstancedMesh };
type CardsBand = { readonly variants: readonly CardsVariant[] };

/** Construit le pool de variantes canoniques d'une bande de cartes (bark +
 *  cartes de feuillage instanciés, matériaux/vent déjà gérés par buildTree —
 *  cf. treeBuilder.ts). ponytail : les `noiseTex` internes de chaque variante
 *  ne sont jamais disposés (buildTree ne sépare pas « garder la géométrie »
 *  de « disposer tout ») — fuite bornée et unique (CARDS_VARIANT_COUNT × 2
 *  bandes = 6 petites textures pour toute la session), sans impact mesurable. */
function buildCardsBand(lod: number, renderer: THREE.WebGLRenderer): CardsBand {
  const variants = Array.from({ length: CARDS_VARIANT_COUNT }, (_, v): CardsVariant => {
    const seed = hashSeed(`treelod:cards:${lod}:${v}`);
    const tree = buildTree(seed, { lod, foliageMode: "cards", renderer });
    const bark = new THREE.InstancedMesh(tree.bark.geometry, tree.bark.material as THREE.Material, CARDS_CAPACITY_PER_VARIANT);
    const foliage = new THREE.InstancedMesh(
      tree.foliageMesh.geometry, tree.foliageMesh.material as THREE.Material, CARDS_CAPACITY_PER_VARIANT,
    );
    bark.count = 0;
    foliage.count = 0;
    bark.castShadow = true;
    foliage.castShadow = true;
    return { bark, foliage };
  });
  return { variants };
}

function disposeCardsBand(band: CardsBand): void {
  for (const v of band.variants) {
    v.bark.geometry.dispose();
    (v.bark.material as THREE.Material).dispose();
    v.foliage.geometry.dispose();
    (v.foliage.material as THREE.Material).dispose();
  }
}

/** Rotation par -yaw : exprime une direction monde dans le repère LOCAL
 *  (non tourné) de l'arbre canonique capturé par impostors.ts — c'est le
 *  « yaw par instance » du blend de vues (cf. impostors.ts en-tête). */
function toLocalDirection(dx: number, dz: number, yaw: number): { x: number; z: number } {
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

/**
 * Champ complet de la chaîne LOD pour un ensemble de placements déterministes
 * (calculés par l'appelant, cf. vegetation.ts). `update()` recalcule chaque
 * frame le palier de chaque arbre et redistribue les instances — même
 * stratégie « rebuild complet » que GrassRing (grassRing.ts), suffisante pour
 * les effectifs d'un cimetière (quelques dizaines à centaines d'arbres).
 */
export class TreeLodField {
  readonly group = new THREE.Group();
  private readonly heroGroup = new THREE.Group();
  private readonly heroBuilt = new Map<number, TreeBuild>();
  private readonly tiers: number[];
  private readonly dummy = new THREE.Object3D();
  private readonly canopy: CanopyShellBuild | null;

  private constructor(
    readonly placements: readonly TreePlacement[],
    private readonly cardsR1: CardsBand,
    private readonly cardsR2: CardsBand,
    private readonly impostor: ImpostorMesh,
    private readonly renderer: THREE.WebGLRenderer,
    canopy: CanopyShellBuild | null,
  ) {
    // Palier initial = le plus lointain : le premier update() construit tout
    // depuis zéro sans « pop » d'un état hero fictif jamais rendu.
    this.tiers = placements.map(() => TREE_LOD_TIER_IMPOSTOR);
    this.canopy = canopy;
    this.group.add(this.heroGroup);
    for (const band of [cardsR1, cardsR2]) for (const v of band.variants) this.group.add(v.bark, v.foliage);
    this.group.add(impostor.mesh);
    if (canopy) this.group.add(canopy.mesh);
  }

  static create(seed: number, placements: readonly TreePlacement[], renderer: THREE.WebGLRenderer): TreeLodField {
    const cardsR1 = buildCardsBand(CARDS_R1_LOD, renderer);
    const cardsR2 = buildCardsBand(CARDS_R2_LOD, renderer);
    const impostor = buildImpostorMesh(getOrCaptureImpostorAtlas(renderer), IMPOSTOR_CAPACITY);
    const canopy = TreeLodField.buildCanopy(seed, placements);
    return new TreeLodField(placements, cardsR1, cardsR2, impostor, renderer, canopy);
  }

  private static buildCanopy(seed: number, placements: readonly TreePlacement[]): CanopyShellBuild | null {
    if (!CANOPY_SHELL_ENABLED || placements.length === 0) return null;
    const center = placementCentroid(placements);
    const radius = placementBoundsRadius(placements, center.x, center.z) + CANOPY_MARGIN;
    void CANOPY_THICKNESS; // nommé pour lisibilité de l'appel (mur simple, pas d'épaisseur)
    return buildCanopyShell(seed, center.x, center.z, radius, CANOPY_BASE_HEIGHT, CANOPY_HEIGHT_VARIANCE);
  }

  /** Recalcule les paliers de tous les arbres selon la position caméra et
   *  redistribue hero/cards/impostor. `camY` : hauteur caméra (yeux), utilisée
   *  pour l'angle de vue de l'impostor (par défaut 0 si l'appelant l'ignore). */
  update(camX: number, camZ: number, camY: number): void {
    const cardsR1Counts = new Array(CARDS_VARIANT_COUNT).fill(0);
    const cardsR2Counts = new Array(CARDS_VARIANT_COUNT).fill(0);
    let impostorCount = 0;
    let heroCount = 0;
    const activeHero = new Set<number>();

    const byDistance = this.placements
      .map((p, i) => ({ i, d: Math.hypot(p.x - camX, p.z - camZ) }))
      .sort((a, b) => a.d - b.d);

    for (const { i, d } of byDistance) {
      const placement = this.placements[i];
      const tier = pickTreeLodTier(d, this.tiers[i]);
      this.tiers[i] = tier;

      if (tier === TREE_LOD_TIER_HERO && heroCount < MAX_HERO_INSTANCES) {
        activeHero.add(i);
        heroCount++;
        continue;
      }
      if (tier === TREE_LOD_TIER_CARDS_R1) {
        this.writeCardsInstance(this.cardsR1, placement, cardsR1Counts);
        continue;
      }
      if (tier === TREE_LOD_TIER_CARDS_R2) {
        this.writeCardsInstance(this.cardsR2, placement, cardsR2Counts);
        const progress = transitionProgress(d, TREE_LOD_CARDS_R2_MAX, TREE_LOD_HYSTERESIS);
        if (progress > 0 && impostorCount < IMPOSTOR_CAPACITY) {
          this.writeImpostorInstance(placement, camX, camY, camZ, progress, impostorCount++);
        }
        continue;
      }
      // IMPOSTOR, ou HERO en surplus de la casquette → dégradé en impostor.
      if (impostorCount < IMPOSTOR_CAPACITY) {
        this.writeImpostorInstance(placement, camX, camY, camZ, 1, impostorCount++);
      }
    }

    this.syncHero(activeHero);
    this.commitCardsCounts(this.cardsR1, cardsR1Counts);
    this.commitCardsCounts(this.cardsR2, cardsR2Counts);
    this.impostor.mesh.count = impostorCount;
    this.impostor.mesh.instanceMatrix.needsUpdate = true;
  }

  private writeCardsInstance(band: CardsBand, placement: TreePlacement, counts: number[]): void {
    const variantIndex = placement.seed % CARDS_VARIANT_COUNT;
    const idx = counts[variantIndex];
    if (idx >= CARDS_CAPACITY_PER_VARIANT) return;
    this.dummy.position.set(placement.x, placement.y, placement.z);
    this.dummy.rotation.set(0, placement.yaw, 0);
    this.dummy.scale.setScalar(placement.scale);
    this.dummy.updateMatrix();
    const { bark, foliage } = band.variants[variantIndex];
    bark.setMatrixAt(idx, this.dummy.matrix);
    foliage.setMatrixAt(idx, this.dummy.matrix);
    counts[variantIndex] = idx + 1;
  }

  private commitCardsCounts(band: CardsBand, counts: number[]): void {
    band.variants.forEach((v, i) => {
      v.bark.count = counts[i];
      v.foliage.count = counts[i];
      v.bark.instanceMatrix.needsUpdate = true;
      v.foliage.instanceMatrix.needsUpdate = true;
    });
  }

  private writeImpostorInstance(
    placement: TreePlacement, camX: number, camY: number, camZ: number, fadeIn: number, slot: number,
  ): void {
    const dx = camX - placement.x;
    const dy = camY - (placement.y + IMPOSTOR_CENTER_HEIGHT * placement.scale);
    const dz = camZ - placement.z;
    const local = toLocalDirection(dx, dz, placement.yaw);
    const len = Math.hypot(local.x, dy, local.z) || 1;
    const blend = nearestViewsBlend(local.x / len, dy / len, local.z / len);
    const tint = TREE_TINT_MIN + TREE_TINT_RANGE * ditherValue(placement.seed, 0);
    this.impostor.updateInstance(slot, {
      x: placement.x, y: placement.y, z: placement.z,
      width: IMPOSTOR_QUAD_WIDTH * placement.scale, height: IMPOSTOR_QUAD_HEIGHT * placement.scale,
      blend, tint, fadeIn,
    });
  }

  private syncHero(active: ReadonlySet<number>): void {
    for (const i of Array.from(this.heroBuilt.keys())) {
      if (!active.has(i)) this.disposeHero(i);
    }
    for (const i of active) if (!this.heroBuilt.has(i)) this.buildHero(i);
  }

  private buildHero(i: number): void {
    const placement = this.placements[i];
    // Nuage (banc générateur) : blobs low-poly, couronne pleine par chevauchement,
    // le meilleur match visuel au concept — remplace l'hybride cartes+vraies feuilles.
    const tree = buildTree(placement.seed, { foliageMode: "cloud", renderer: this.renderer });
    tree.group.position.set(placement.x, placement.y, placement.z);
    tree.group.rotation.y = placement.yaw;
    tree.group.scale.setScalar(placement.scale);
    tree.bark.castShadow = true;
    tree.foliageMesh.castShadow = true;
    this.heroGroup.add(tree.group);
    this.heroBuilt.set(i, tree);
  }

  private disposeHero(i: number): void {
    const tree = this.heroBuilt.get(i)!;
    this.heroGroup.remove(tree.group);
    tree.dispose();
    this.heroBuilt.delete(i);
  }

  /** Comptes d'instances actives par palier après le dernier `update()` —
   *  réservé au harnais e2e forêt (forestDemo.ts / forest.spec.ts) pour
   *  vérifier que la majorité des arbres visibles sont des impostors. */
  tierCounts(): { hero: number; cardsR1: number; cardsR2: number; impostor: number } {
    const bandCount = (band: CardsBand) => band.variants.reduce((sum, v) => sum + v.bark.count, 0);
    return {
      hero: this.heroBuilt.size,
      cardsR1: bandCount(this.cardsR1),
      cardsR2: bandCount(this.cardsR2),
      impostor: this.impostor.mesh.count,
    };
  }

  dispose(): void {
    for (const i of Array.from(this.heroBuilt.keys())) this.disposeHero(i);
    disposeCardsBand(this.cardsR1);
    disposeCardsBand(this.cardsR2);
    this.impostor.dispose();
    this.canopy?.dispose();
    this.group.clear();
  }
}
