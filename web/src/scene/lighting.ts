import * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";
import { clampAmbientFloor, type SunDirection } from "./shadows.ts";

const SHADOW_MAP_SIZE = 2048;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 120;
const SHADOW_EXTENT = 40;
const SHADOW_BIAS = -0.0002;
const SHADOW_NORMAL_BIAS = 0.03;
// Taille d'un texel de la shadow map (m) : la cible doit se caler sur cette
// grille quand elle suit la caméra, sinon l'ombre scintille (chaque pas
// infra-texel change légèrement quel texel couvre quelle surface).
const SHADOW_TEXEL_SIZE = (2 * SHADOW_EXTENT) / SHADOW_MAP_SIZE;
const KEY_LIGHT_DISTANCE = 60;
const CELESTIAL_DISTANCE_FACTOR = 1.2;
const CELESTIAL_RADIUS = 4;
const CELESTIAL_SEGMENTS = 24;

function snapToTexel(v: number): number {
  return Math.round(v / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE;
}

/** Regroupe les lumières de la scène et leur mise à jour selon l'ambiance. */
export class Lighting {
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly ambient = new THREE.AmbientLight();
  readonly celestial: THREE.Mesh;
  private readonly celestialMat = new THREE.MeshBasicMaterial();
  /** Direction courante du soleil/lune (normalisée), pour repositionner la
   *  cible d'ombre à chaque frame sans revenir chercher l'ambiance. */
  private readonly direction = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.hemi.position.set(0, 50, 0);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.key.shadow.camera.near = SHADOW_NEAR;
    this.key.shadow.camera.far = SHADOW_FAR;
    this.key.shadow.bias = SHADOW_BIAS;
    this.key.shadow.normalBias = SHADOW_NORMAL_BIAS;
    const cam = this.key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;

    this.celestial = new THREE.Mesh(
      new THREE.SphereGeometry(CELESTIAL_RADIUS, CELESTIAL_SEGMENTS, CELESTIAL_SEGMENTS),
      this.celestialMat,
    );
  }

  addTo(scene: THREE.Scene) {
    scene.add(this.hemi, this.ambient, this.key, this.key.target, this.celestial);
  }

  /** Direction courante du soleil/lune, DU sol VERS l'astre (voir `Ambiance.keyLightDir`) —
   *  consommée par le rig CSM optionnel (`scene/shadows.ts`, mission 13). */
  get sunDirection(): SunDirection {
    return [this.direction.x, this.direction.y, this.direction.z];
  }

  apply(a: Ambiance) {
    this.hemi.color.setHex(a.hemiSky);
    this.hemi.groundColor.setHex(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity;

    this.ambient.color.setHex(a.ambientColor);
    // Plancher anti-ombre-noire (Pillar B LAAS, mission 13/shadows.ts) : n'affecte
    // aucune ambiance existante (toutes ≥ 0.3), filet de sécurité pour l'avenir.
    this.ambient.intensity = clampAmbientFloor(a.ambientIntensity);

    this.direction.set(...a.keyLightDir).normalize();
    const dir = this.direction.clone().multiplyScalar(KEY_LIGHT_DISTANCE);
    this.key.color.setHex(a.keyLightColor);
    this.key.intensity = a.keyLightIntensity;
    this.key.position.copy(dir).add(this.key.target.position);

    this.celestialMat.color.setHex(a.celestialColor);
    this.celestial.visible = a.celestial !== "none";
    this.celestial.position.copy(dir).multiplyScalar(CELESTIAL_DISTANCE_FACTOR);
  }

  /**
   * Recentre la cible d'ombre (et la lumière, à distance/direction fixe) sur
   * la position XZ de la caméra, calée sur la grille de texels de la shadow
   * map pour ne pas scintiller. Renvoie `true` si la cellule a changé (pour
   * ne déclencher un recalcul de la shadow map — `autoUpdate = false` côté
   * renderer — que lorsque c'est nécessaire).
   */
  followCamera(camX: number, camZ: number): boolean {
    const x = snapToTexel(camX);
    const z = snapToTexel(camZ);
    if (x === this.key.target.position.x && z === this.key.target.position.z) return false;
    this.key.target.position.set(x, 0, z);
    this.key.position.copy(this.direction).multiplyScalar(KEY_LIGHT_DISTANCE).add(this.key.target.position);
    return true;
  }
}
