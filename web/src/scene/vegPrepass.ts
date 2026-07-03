// Prepass profondeur pour la végétation alpha-testée (herbe grassField.ts,
// cartes de feuillage trees/foliageCards.ts) — mission 12. Référence de
// concept LAAS `render/VegPrepass.ts` : rasteriser la MÊME géométrie en
// depth-only d'abord (aucune couleur), puis la passe couleur en
// `depthFunc=EQUAL` — le shading complet (PBR + atlas + vent) ne s'exécute
// plus qu'UNE fois par pixel visible, au lieu de 2-8× à cause de l'overdraw
// des brins/cartes superposés.
//
// ⚠️ Correctness (contrainte de la mission) : un fragment écrit en profondeur
// mais discardé en couleur perce un trou vers le ciel. Le jumeau depth-only
// DOIT donc discarder EXACTEMENT les mêmes fragments que la passe couleur —
// même déplacement de vent (position, cf. wind.ts) et même `map`/`alphaTest`
// (mask). Voir `alphaTestDiscards` ci-dessous pour le contrat testé.
//
// Flag additif `?prepass=1` (défaut désactivé — comportement actuel inchangé
// tant qu'il n'est pas explicitement demandé, cf. plan/README.md § conventions).
import * as THREE from "three";
import { applyWind, type WindPool } from "./wind.ts";

/** Nom du paramètre d'URL du flag A/B (voir `isPrepassEnabled`). */
export const PREPASS_QUERY_PARAM = "prepass";

/** `renderOrder` du jumeau depth-only : strictement avant le reste de la scène
 *  (opaque, tri croissant par `renderOrder`) — la passe couleur doit trouver
 *  la profondeur déjà écrite pour que son `depthFunc=EQUAL` matche. */
const PREPASS_RENDER_ORDER = -1;

/**
 * Lit `?prepass=1` dans l'URL — absent/`0`/toute autre valeur ⇒ `false`
 * (comportement actuel inchangé). `search` optionnel pour les tests
 * unitaires (pas de `window` en environnement Node/Vitest) ; en dehors d'un
 * navigateur (pas de `window`), renvoie toujours `false`.
 */
export function isPrepassEnabled(search?: string): boolean {
  const raw = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(raw).get(PREPASS_QUERY_PARAM) === "1";
}

/**
 * Décision de discard d'un fragment alpha-testé — reproduit EXACTEMENT la
 * formule du chunk Three.js `alphatest_fragment.glsl.js` (`USE_ALPHATEST`
 * n'est défini que si `alphaTest > 0`, cf. `WebGLPrograms.js:HAS_ALPHATEST`) :
 * tant que la passe couleur et son jumeau depth-only reçoivent le même
 * `alphaTest`, ils prennent la même décision pour le même échantillon
 * d'alpha — c'est le contrat testé par `vegPrepass.test.ts`.
 */
export function alphaTestDiscards(alpha: number, alphaTest: number): boolean {
  return alphaTest > 0 && alpha < alphaTest;
}

export interface DepthTwinOptions {
  /** Pool de vent (herbe/arbre) — DOIT être le même que celui de la passe
   *  couleur : c'est lui qui fixe le déplacement de vertex (position). */
  readonly pool: WindPool;
  /** Même rôle que `applyWind`'s `seedOffset` — décorréler deux InstancedMesh
   *  distincts qui partageraient sinon les mêmes graines d'instance. */
  readonly seedOffset?: number;
  /** Carte couleur (canal alpha = mask) — `null`/absent pour une géométrie
   *  opaque sans discard (ex. l'herbe, cf. grassField.ts). */
  readonly map?: THREE.Texture | null;
  /** Même valeur que le matériau couleur ; 0/absent ⇒ aucun discard. */
  readonly alphaTest?: number;
}

/**
 * Matériau depth-only jumeau d'un matériau couleur alpha-testé : même
 * déplacement de vent (position, injecté comme `applyWind` le fait pour la
 * passe couleur) et même `map`/`alphaTest` (mask) — garantit l'équivalence
 * pixel exacte requise entre `?prepass=0` et `?prepass=1`. `colorWrite=false`
 * par sécurité : le prepass ne doit jamais laisser de couleur visible si la
 * passe couleur qui suit ne recouvre pas exactement le même pixel (précision
 * flottante du test `depthFunc=EQUAL`) — un trou vers l'arrière-plan est
 * anodin, un aplat gris de `MeshDepthMaterial` ne l'est pas.
 */
export function buildDepthTwinMaterial(opts: DepthTwinOptions): THREE.MeshDepthMaterial {
  const base = new THREE.MeshDepthMaterial({
    depthPacking: THREE.BasicDepthPacking,
    map: opts.map ?? null,
    alphaTest: opts.alphaTest ?? 0,
  });
  base.colorWrite = false;
  // applyWind clone() le matériau source en conservant son constructeur
  // (Material.clone → new this.constructor().copy(this)) : le résultat reste
  // un MeshDepthMaterial, cast nécessaire car applyWind est typé générique.
  return applyWind(base, { pool: opts.pool, seedOffset: opts.seedOffset }) as THREE.MeshDepthMaterial;
}

/** Bascule la passe couleur en `depthFunc=EQUAL` (le prepass a déjà écrit la
 *  profondeur finale) et désactive son écriture de profondeur (redondante) —
 *  additif pur, n'altère aucune autre propriété du matériau. */
function configureColorPassForPrepass(material: THREE.Material): void {
  material.depthFunc = THREE.EqualDepth;
  material.depthWrite = false;
}

/**
 * Attache `depthMesh` comme ENFANT de `colorMesh` : il hérite de sa matrice
 * monde et traverse la même scène sans qu'aucun appelant (cemetery.ts,
 * vegetation.ts, treeBuilder.ts…) n'ait besoin d'être modifié — hors
 * partition de cette mission, cf. plan/12-depth-prepass.md. `renderOrder`
 * négatif garantit le rendu du prepass AVANT la passe couleur.
 */
export function attachDepthPrepass(colorMesh: THREE.Mesh, depthMesh: THREE.Mesh): void {
  depthMesh.renderOrder = PREPASS_RENDER_ORDER;
  depthMesh.frustumCulled = colorMesh.frustumCulled;
  colorMesh.add(depthMesh);
  configureColorPassForPrepass(colorMesh.material as THREE.Material);
}
