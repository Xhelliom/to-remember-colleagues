// Câblage optionnel du rig CSM (mission 13, `scene/shadows.ts`) sur le renderer du
// jeu — extrait de `cemetery.ts` pour rester sous la limite de 500 lignes (CLAUDE.md).
//
// Défaut inchangé : `CSM_SHADOWS_ENABLED = false` ⇒ ce module est un no-op complet
// (le rig n'est jamais construit) et `cemetery.ts` retombe sur son unique passe
// `renderer.shadowMap.needsUpdate` (comportement actuel, `Lighting.key`).
import * as THREE from "three";
import { CascadeShadowRig, resolveShadowPreset, type SunDirection } from "./shadows.ts";

// Activation derrière flag — voir plan/13-ombres.md. Bascule à valider visuellement
// avant d'être un jour mise à `true` par défaut.
export const CSM_SHADOWS_ENABLED = false;

/**
 * Construit (ou non, selon le flag) le rig CSM et expose les points d'intégration
 * utilisés par la boucle de `Cemetery` : ambiance, rafraîchissement de la shadow
 * map, matériaux neufs. Quand le rig est actif, désactive la lumière-clé unique
 * (`keyLight.castShadow`) pour ne pas doubler les ombres.
 */
export class ShadowIntegration {
  private readonly rig: CascadeShadowRig | null;

  constructor(
    camera: THREE.PerspectiveCamera,
    parent: THREE.Object3D,
    private readonly renderer: THREE.WebGLRenderer,
    keyLight: THREE.DirectionalLight,
  ) {
    if (!CSM_SHADOWS_ENABLED) {
      this.rig = null;
      return;
    }
    const preset = resolveShadowPreset(new URLSearchParams(window.location.search).get("preset"));
    this.rig = new CascadeShadowRig(camera, parent, renderer, preset);
    keyLight.castShadow = false;
  }

  get active(): boolean {
    return this.rig !== null;
  }

  applyAmbiance(color: number, intensity: number, direction: SunDirection): void {
    this.rig?.applyAmbiance(color, intensity, direction);
  }

  /**
   * À appeler chaque frame après `Lighting.followCamera`. `requested` reflète une
   * raison normale de rafraîchir (cible caméra a changé de texel, scène modifiée) ;
   * sans rig actif, reproduit le comportement historique (`needsUpdate` direct).
   */
  tick(requested: boolean, scene: THREE.Object3D): void {
    if (this.rig) {
      if (requested) this.rig.setupMaterialsIn(scene);
      this.rig.update(requested);
      return;
    }
    if (requested) this.renderer.shadowMap.needsUpdate = true;
  }
}
