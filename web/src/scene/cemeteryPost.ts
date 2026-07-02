// Pipeline de post-traitement du cimetière (issue #14, activation en jeu) :
// auto-exposition + grade filmique par heure + brume de hauteur, regroupés dans
// un EffectComposer. Extrait de cemetery.ts pour tenir sous la limite de 500
// lignes. Activé via `?post=1` ; sinon Cemetery rend en renderer.render() direct.
import type * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { getFilmGrade, type TimeKey } from "../ambiance.ts";
import { AutoExposurePass } from "./post/autoExposure.ts";
import { applyFilmGrade, createGoldenGradePass } from "./post/grade.ts";
import { createFogRenderTarget, GroundFogPass } from "./post/groundFog.ts";

/** Compose le rendu du cimetière avec auto-exposition, grade par heure et brume. */
export class CemeteryPost {
  private readonly composer: EffectComposer;
  private readonly grade: ShaderPass;

  /** Construit le pipeline si `?post=1`, sinon `null` (rendu direct). Dimensionné d'emblée. */
  static create(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): CemeteryPost | null {
    if (new URLSearchParams(window.location.search).get("post") !== "1") return null;
    const post = new CemeteryPost(renderer, scene, camera);
    post.setSize(window.innerWidth, window.innerHeight);
    return post;
  }

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // Le buffer porte une depthTexture : la brume reconstruit la position monde par profondeur.
    this.composer = new EffectComposer(renderer, createFogRenderTarget(renderer));
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new AutoExposurePass());
    this.grade = createGoldenGradePass();
    this.composer.addPass(this.grade);
    this.composer.addPass(new GroundFogPass(camera));
  }

  /** Ajuste le grade filmique à l'heure courante (dawn/day/dusk/night). */
  setGrade(timeKey: TimeKey) {
    applyFilmGrade(this.grade, getFilmGrade(timeKey));
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
