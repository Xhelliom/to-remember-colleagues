import * as THREE from "three";
import type { Ambiance } from "../ambiance.ts";

const SHADOW_MAP_SIZE = 2048;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 120;
const SHADOW_EXTENT = 40;
const KEY_LIGHT_DISTANCE = 60;
const CELESTIAL_DISTANCE_FACTOR = 1.2;
const CELESTIAL_RADIUS = 4;
const CELESTIAL_SEGMENTS = 24;

/** Regroupe les lumières de la scène et leur mise à jour selon l'ambiance. */
export class Lighting {
  readonly hemi = new THREE.HemisphereLight();
  readonly key = new THREE.DirectionalLight();
  readonly ambient = new THREE.AmbientLight();
  readonly celestial: THREE.Mesh;
  private readonly celestialMat = new THREE.MeshBasicMaterial();

  constructor() {
    this.hemi.position.set(0, 50, 0);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.key.shadow.camera.near = SHADOW_NEAR;
    this.key.shadow.camera.far = SHADOW_FAR;
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

  apply(a: Ambiance) {
    this.hemi.color.setHex(a.hemiSky);
    this.hemi.groundColor.setHex(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity;

    this.ambient.color.setHex(a.ambientColor);
    this.ambient.intensity = a.ambientIntensity;

    const dir = new THREE.Vector3(...a.keyLightDir).normalize().multiplyScalar(KEY_LIGHT_DISTANCE);
    this.key.color.setHex(a.keyLightColor);
    this.key.intensity = a.keyLightIntensity;
    this.key.position.copy(dir);
    this.key.target.position.set(0, 0, 0);

    this.celestialMat.color.setHex(a.celestialColor);
    this.celestial.visible = a.celestial !== "none";
    this.celestial.position.copy(dir).multiplyScalar(CELESTIAL_DISTANCE_FACTOR);
  }
}
