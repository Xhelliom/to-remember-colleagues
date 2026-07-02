// Qualité des ombres (mission 13) : Cascaded Shadow Maps (addon three.js) + pénombre
// élargie par cascade (approximation PCSS) + cache de rafraîchissement pour tenir la
// perf (le soleil est quasi statique entre deux éditions de l'heure/ambiance).
//
// DERRIÈRE FLAG (CSM_SHADOWS_ENABLED, cemetery.ts) : comportement par défaut inchangé
// (ombre unique PCFSoftShadowMap, voir scene/lighting.ts) tant que le flag n'est pas
// activé — voir plan/13-ombres.md.
//
// Référence de concept : LAAS `render/CsmCached.ts` (cache de cascades). Porté ici sur
// l'addon officiel `three/examples/jsm/csm/CSM.js` (WebGLRenderer 0.185, pas de code
// LAAS copié, pas de WebGPU/TSL).
//
// Approximation PCSS : le PCSS « vrai » élargit la pénombre par une recherche de
// bloqueurs par fragment — coûteux, et demande de patcher le shader de TOUS les
// matériaux receveurs d'ombre (hors périmètre de cette mission, cf. partition de
// fichiers). On approxime l'effet « plus loin de la caméra ⇒ ombre plus douce » en
// élargissant `shadow.radius` par cascade : une cascade lointaine couvre plus de
// mètres par texel, donc le même rayon en texels donne un flou plus large en unités
// monde (`shadow.radius` est honoré par `PCFSoftShadowMap`, pas seulement VSM).
// ponytail: vrai PCSS (blocker-search par fragment) si cette approximation ne suffit
// plus visuellement — coûteux, à ne faire qu'après mesure.

import * as THREE from "three";
import { CSM } from "three/examples/jsm/csm/CSM.js";

// ---- Répartition des cascades (calcul pur, testé) --------------------------

export type CascadeSplitMode = "uniform" | "logarithmic" | "practical";

const PRACTICAL_LAMBDA = 0.5; // mélange 50/50 uniforme/logarithmique (défaut historique de l'addon CSM)

function uniformSplits(cascades: number, near: number, far: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < cascades; i++) out.push((near + (far - near) * (i / cascades)) / far);
  out.push(1);
  return out;
}

function logarithmicSplits(cascades: number, near: number, far: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < cascades; i++) out.push((near * (far / near) ** (i / cascades)) / far);
  out.push(1);
  return out;
}

/**
 * Fractions [0,1] (de `far`) délimitant `cascades` cascades entre `near` et `far` —
 * même algorithme que l'addon `CSM.js` (méthode privée non exportée `_getBreaks`),
 * dupliqué ici en pur pour rester testable sans caméra/scène. `mode` "practical"
 * mélange uniforme/logarithmique via `lambda` (0 = uniforme pur, 1 = log pur).
 */
export function computeCascadeSplits(
  cascades: number,
  near: number,
  far: number,
  mode: CascadeSplitMode = "practical",
  lambda = PRACTICAL_LAMBDA,
): number[] {
  if (cascades < 1) throw new Error("computeCascadeSplits : cascades doit être ≥ 1");
  if (mode === "uniform") return uniformSplits(cascades, near, far);
  if (mode === "logarithmic") return logarithmicSplits(cascades, near, far);
  const u = uniformSplits(cascades, near, far);
  const l = logarithmicSplits(cascades, near, far);
  return u.map((v, i) => v + (l[i] - v) * lambda);
}

// ---- Rayon de flou par cascade (approximation PCSS, calcul pur, testé) -----

export const PCSS_BASE_RADIUS = 2; // rayon de flou (texels) de la cascade la plus proche
export const PCSS_FAR_RADIUS_SCALE = 3; // multiplicateur atteint par la cascade la plus lointaine

/**
 * Rayon de flou d'ombre (`DirectionalLight.shadow.radius`) pour la cascade `index`
 * sur `count` : croît linéairement avec l'éloignement à la caméra pour élargir la
 * pénombre en profondeur (voir approximation PCSS en tête de fichier).
 */
export function computeCascadePcssRadius(
  index: number,
  count: number,
  baseRadius = PCSS_BASE_RADIUS,
  farScale = PCSS_FAR_RADIUS_SCALE,
): number {
  if (count <= 1) return baseRadius;
  const t = index / (count - 1);
  return baseRadius * (1 + t * (farScale - 1));
}

// ---- Cache de cascades : invalidation & cadence (calcul pur, testé) --------

export const CASCADE_CACHE_REFRESH_FRAMES = 6; // cadence de rafraîchissement hors mouvement du soleil
export const SUN_MOVE_THRESHOLD_RAD = 0.01; // angle mini de rotation du soleil → refresh forcé

/** Direction normalisée du soleil/lune (mêmes composantes que `Ambiance.keyLightDir`). */
export type SunDirection = readonly [number, number, number];

function angleBetween(a: SunDirection, b: SunDirection): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

/** Le soleil a-t-il assez tourné (angle > `thresholdRad`) pour justifier un refresh
 *  forcé du cache de cascades ? Les deux directions sont supposées normalisées. */
export function shouldInvalidateCascadeCache(
  prev: SunDirection,
  next: SunDirection,
  thresholdRad = SUN_MOVE_THRESHOLD_RAD,
): boolean {
  return angleBetween(prev, next) > thresholdRad;
}

/**
 * Cadence le rafraîchissement de la shadow map : le soleil est quasi statique entre
 * deux éditions de l'heure/ambiance, donc un rafraîchissement « normal » (suivi
 * caméra, contenu de scène modifié) est retardé jusqu'à la prochaine fenêtre de
 * `refreshEveryNFrames`, SAUF si le soleil a tourné (refresh forcé immédiat).
 */
export class CascadeShadowCache {
  private frame = 0;
  private lastRefreshFrame = -Infinity;
  private lastSunDir: SunDirection | null = null;

  constructor(
    private readonly refreshEveryNFrames = CASCADE_CACHE_REFRESH_FRAMES,
    private readonly sunMoveThresholdRad = SUN_MOVE_THRESHOLD_RAD,
  ) {}

  /**
   * `requested` : une raison normale de rafraîchir a été détectée en amont (cible
   * caméra a changé de texel, contenu de scène modifié). Renvoie si la shadow map
   * doit réellement être re-rendue cette frame.
   */
  shouldRefresh(requested: boolean, sunDirection: SunDirection): boolean {
    this.frame++;
    const sunMoved = this.lastSunDir !== null
      && shouldInvalidateCascadeCache(this.lastSunDir, sunDirection, this.sunMoveThresholdRad);
    this.lastSunDir = sunDirection;

    if (sunMoved) {
      this.lastRefreshFrame = this.frame;
      return true;
    }
    if (!requested) return false;
    if (this.frame - this.lastRefreshFrame < this.refreshEveryNFrames) return false;
    this.lastRefreshFrame = this.frame;
    return true;
  }
}

// ---- Plancher ambiant anti-ombre-noire (Pillar B LAAS) ---------------------

// Sous ce seuil, une teinte ambiante colorée s'écrase au noir après quantification 8
// bits — l'ombre perd toute chroma et paraît « trouée ». Valeur choisie sous le
// minimum des ambiances actuelles (nuit = 0.35, `ambiance.ts`) : n'affecte donc AUCUNE
// ambiance existante aujourd'hui, seulement un filet de sécurité pour l'avenir.
export const SHADOW_AMBIENT_FLOOR = 0.18;

/** Garantit une intensité ambiante minimale (règle anti-ombre-noire) — à appliquer
 *  après avoir fixé l'intensité normale de l'ambiance. */
export function clampAmbientFloor(intensity: number, floor = SHADOW_AMBIENT_FLOOR): number {
  return Math.max(intensity, floor);
}

// ---- Préréglages perf (?preset=low|high|ultra, e2e/helpers/harness.ts) ----

export type ShadowPreset = { cascades: number; shadowMapSize: number };

const SHADOW_PRESETS: Record<string, ShadowPreset> = {
  low: { cascades: 2, shadowMapSize: 1024 },
  high: { cascades: 4, shadowMapSize: 2048 },
  ultra: { cascades: 4, shadowMapSize: 4096 },
};
export const DEFAULT_SHADOW_PRESET: ShadowPreset = SHADOW_PRESETS.high;

/** Résout `?preset=` en réglages CSM — "high" par défaut si absent/inconnu (honnête :
 *  CSM+PCSS est plus lourd en WebGL, cf. plan/13-ombres.md § Contraintes). */
export function resolveShadowPreset(preset: string | null): ShadowPreset {
  if (preset && preset in SHADOW_PRESETS) return SHADOW_PRESETS[preset];
  return DEFAULT_SHADOW_PRESET;
}

// ---- Rig CSM (THREE-dépendant, câblé par cemetery.ts derrière un flag) -----

const CSM_MODE: CascadeSplitMode = "practical";
const CSM_LIGHT_NEAR = 1;
// Far du CSM borné à un rayon plausible de rendu net (au-delà, le fog mange la scène,
// cf. FAR/fog de cemetery.ts) — distinct du far (bien plus grand) de la caméra jeu.
const CSM_FAR = 120;
const CSM_LIGHT_MARGIN = 20; // marge (m) autour du frustum de chaque cascade (occludeurs hors champ)

/**
 * Rig CSM + cache de cascades, câblé sur le renderer du jeu (`cemetery.ts`) derrière
 * `CSM_SHADOWS_ENABLED`. Remplace la lumière-clé unique de `Lighting` par N
 * `DirectionalLight` (une par cascade, gérées par l'addon `CSM`), synchronisées sur la
 * même ambiance (couleur/intensité/direction) via `applyAmbiance`.
 */
export class CascadeShadowRig {
  private readonly csm: CSM;
  private readonly cache: CascadeShadowCache;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly patched = new WeakSet<THREE.Material>();

  constructor(
    camera: THREE.PerspectiveCamera,
    parent: THREE.Object3D,
    renderer: THREE.WebGLRenderer,
    preset: ShadowPreset = DEFAULT_SHADOW_PRESET,
  ) {
    this.renderer = renderer;
    this.csm = new CSM({
      camera,
      parent,
      cascades: preset.cascades,
      shadowMapSize: preset.shadowMapSize,
      maxFar: CSM_FAR,
      mode: "custom",
      customSplitsCallback: (cascades, near, far, target) => {
        target.length = 0;
        target.push(...computeCascadeSplits(cascades, near, far, CSM_MODE));
      },
      lightNear: CSM_LIGHT_NEAR,
      lightFar: CSM_FAR,
      lightMargin: CSM_LIGHT_MARGIN,
    });
    for (let i = 0; i < this.csm.lights.length; i++) {
      this.csm.lights[i].shadow.radius = computeCascadePcssRadius(i, this.csm.lights.length);
    }
    this.cache = new CascadeShadowCache();
    renderer.shadowMap.autoUpdate = false;
  }

  /** Applique la CSM aux matériaux déjà présents sous `root` (idempotent — un
   *  matériau déjà patché n'est jamais re-patché). À appeler après chargement de
   *  nouveau contenu (chunk streamé, tombe ajoutée). */
  setupMaterialsIn(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (this.patched.has(material)) continue;
        this.csm.setupMaterial(material);
        this.patched.add(material);
      }
    });
  }

  /** Couleur/intensité/direction suivent l'ambiance courante (voir `Lighting.apply`).
   *  `direction` pointe DU sol VERS le soleil (même convention que `keyLightDir`). */
  applyAmbiance(color: number, intensity: number, direction: SunDirection): void {
    this.csm.lightDirection.set(-direction[0], -direction[1], -direction[2]).normalize();
    for (const light of this.csm.lights) {
      light.color.setHex(color);
      light.intensity = intensity;
    }
    this.csm.updateFrustums();
  }

  /** À appeler chaque frame, avant `renderer.render`. `requested` reflète une raison
   *  normale de rafraîchir (cf. `CascadeShadowCache.shouldRefresh`). */
  update(requested: boolean): void {
    this.csm.update();
    const d = this.csm.lightDirection;
    if (this.cache.shouldRefresh(requested, [d.x, d.y, d.z])) {
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  dispose(): void {
    this.csm.dispose();
    this.csm.remove();
  }
}
