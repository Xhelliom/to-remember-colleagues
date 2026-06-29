import * as THREE from "three";
import type { Colleague, CompanyDetail } from "./types.ts";
import { createGrave, seededRandom } from "./graves.ts";
import { getAmbiance, resolveSeasonKey, resolveTimeKey, type Ambiance, type SeasonSetting, type TimeSetting } from "./ambiance.ts";
import { createSky, type Sky } from "./scene/sky.ts";
import { Lighting } from "./scene/lighting.ts";
import { Decor } from "./scene/decor.ts";
import { FirstPersonControls } from "./scene/controls.ts";

const FOV = 70;
const NEAR = 0.1;
const FAR = 400;
const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.05;
const FOCUS_RADIUS = 3.2;
const GROUND_RADIUS = 160;
const GROUND_SEGMENTS = 64;
const GRAVE_SPACING_X = 3.2;
const GRAVE_SPACING_Z = 3.6;
const MIN_ROW_LENGTH = 4;
const MIN_PLOT_HALF = 16;
const PLOT_MARGIN = 5;
const ENTRANCE_OFFSET = 3;
const GRAVE_JITTER = 0.4;

/** Orchestrateur de la scène 3D : assemble ciel, lumières, décor, contrôles et tombes. */
export class Cemetery {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();

  private readonly sky: Sky;
  private readonly lighting = new Lighting();
  private readonly decor = new Decor();
  private readonly controls: FirstPersonControls;
  private readonly groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  private readonly gravesGroup = new THREE.Group();

  private detail: CompanyDetail | null = null;
  private ambiance: Ambiance;
  private timeSetting: TimeSetting = "auto";
  private seasonSetting: SeasonSetting = "auto";
  private plotHalf = MIN_PLOT_HALF;
  private running = false;

  private focusCb: (c: Colleague | null) => void = () => {};
  private focused: Colleague | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, NEAR, FAR);

    this.sky = createSky();
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.FogExp2(0xc7d6e6, 0.01);
    this.lighting.addTo(this.scene);
    this.scene.add(this.gravesGroup, this.decor.group);
    this.buildGround();

    this.controls = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);
    this.controls.placeAt(0, this.plotHalf - ENTRANCE_OFFSET);

    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);

    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(this.loop);
  }

  onFocusChange(cb: (c: Colleague | null) => void) {
    this.focusCb = cb;
  }

  onLockChange(cb: (locked: boolean) => void) {
    this.controls.onLockChange(cb);
  }

  requestLock() {
    this.controls.lock();
  }

  unlock() {
    this.controls.unlock();
  }

  get isLocked() {
    return this.controls.isLocked;
  }

  setActive(active: boolean) {
    this.running = active;
  }

  setCemetery(detail: CompanyDetail) {
    this.detail = detail;
    this.layoutGraves();
    this.controls.placeAt(0, this.plotHalf - ENTRANCE_OFFSET);
  }

  addColleague(colleague: Colleague) {
    if (!this.detail) return;
    this.detail.colleagues.push(colleague);
    this.layoutGraves();
  }

  setAmbianceSettings(time: TimeSetting, season: SeasonSetting) {
    this.timeSetting = time;
    this.seasonSetting = season;
    const next = this.resolveAmbiance();
    const scaryChanged = next.scary !== this.ambiance.scary;
    this.ambiance = next;
    this.applyAmbiance(next);
    if (scaryChanged) this.layoutGraves();
  }

  private buildGround() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_RADIUS, GROUND_SEGMENTS), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private resolveAmbiance(): Ambiance {
    const now = new Date();
    const timeKey = resolveTimeKey(this.timeSetting, now.getHours());
    const seasonKey = resolveSeasonKey(this.seasonSetting, now.getMonth() + 1, now.getDate());
    return getAmbiance(timeKey, seasonKey);
  }

  private applyAmbiance(a: Ambiance) {
    this.sky.setColors(a.skyTop, a.skyBottom);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(a.fogColor);
    fog.density = a.fogDensity;
    this.lighting.apply(a);
    this.groundMat.color.setHex(a.groundColor);
    this.decor.build(a, this.plotHalf);
  }

  private layoutGraves() {
    this.gravesGroup.clear();
    if (!this.detail) return;
    const list = this.detail.colleagues;
    const perRow = Math.max(MIN_ROW_LENGTH, Math.ceil(Math.sqrt(list.length)));
    const rows = Math.ceil(list.length / perRow);

    this.plotHalf = Math.max(
      MIN_PLOT_HALF,
      (Math.max(perRow, rows) * Math.max(GRAVE_SPACING_X, GRAVE_SPACING_Z)) / 2 + PLOT_MARGIN,
    );
    this.controls.setBound(this.plotHalf);

    const startX = -((perRow - 1) * GRAVE_SPACING_X) / 2;
    const startZ = -((rows - 1) * GRAVE_SPACING_Z) / 2 - 2;
    list.forEach((colleague, i) => {
      const jitter = seededRandom(colleague.graveSeed + 7);
      const grave = createGrave(colleague, this.ambiance.graveColor, this.ambiance.scary);
      grave.position.set(
        startX + (i % perRow) * GRAVE_SPACING_X + (jitter() - 0.5) * GRAVE_JITTER,
        0,
        startZ + Math.floor(i / perRow) * GRAVE_SPACING_Z + (jitter() - 0.5) * GRAVE_JITTER,
      );
      this.gravesGroup.add(grave);
    });

    this.decor.build(this.ambiance, this.plotHalf);
  }

  private updateFocus() {
    const cam = this.camera.position;
    let nearest: Colleague | null = null;
    let best = FOCUS_RADIUS;
    for (const grave of this.gravesGroup.children) {
      const d = Math.hypot(grave.position.x - cam.x, grave.position.z - cam.z);
      if (d < best) {
        best = d;
        nearest = (grave.userData.colleague as Colleague) ?? null;
      }
    }
    if (nearest !== this.focused) {
      this.focused = nearest;
      this.focusCb(nearest);
    }
  }

  private loop = () => {
    const dt = Math.min(this.clock.getDelta(), MAX_DELTA);
    if (this.running) {
      this.controls.update(dt);
      this.updateFocus();
    }
    this.decor.update(dt, this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
