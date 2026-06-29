import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import type { Colleague, CompanyDetail } from "./types.ts";
import { createGrave, seededRandom } from "./graves.ts";
import {
  getAmbiance,
  resolveSeasonKey,
  resolveTimeKey,
  type Ambiance,
  type SeasonSetting,
  type TimeSetting,
} from "./ambiance.ts";

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.2;
const RUN_SPEED = 8.0;
const FOCUS_RADIUS = 3.2;

export class Cemetery {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private clock = new THREE.Clock();

  // Éléments mis à jour selon l'ambiance.
  private skyMat: THREE.ShaderMaterial;
  private hemi = new THREE.HemisphereLight();
  private key = new THREE.DirectionalLight();
  private ambient = new THREE.AmbientLight();
  private celestial: THREE.Mesh;
  private celestialMat = new THREE.MeshBasicMaterial();
  private groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });

  private gravesGroup = new THREE.Group();
  private decorGroup = new THREE.Group();
  private particles?: THREE.Points;
  private particleData: { kind: string; velocities: Float32Array; bounds: number } | null = null;
  private flickerLights: THREE.PointLight[] = [];
  private bats: THREE.Mesh[] = [];

  private move = { forward: false, backward: false, left: false, right: false, run: false };
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();

  private detail: CompanyDetail | null = null;
  private ambiance: Ambiance;
  private timeSetting: TimeSetting = "auto";
  private seasonSetting: SeasonSetting = "auto";
  private plotHalf = 20;
  private running = false;

  private focusCb: (c: Colleague | null) => void = () => {};
  private lockCb: (locked: boolean) => void = () => {};
  private focused: Colleague | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, EYE_HEIGHT, 16);

    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);
    this.controls.addEventListener("lock", () => this.lockCb(true));
    this.controls.addEventListener("unlock", () => this.lockCb(false));

    // Dôme de ciel à dégradé vertical.
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x5b8fd6) },
        bottomColor: { value: new THREE.Color(0xbcd6f2) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        void main() {
          float h = normalize(vPos).y * 0.5 + 0.5;
          gl_FragColor = vec4(mix(bottomColor, topColor, clamp(h, 0.0, 1.0)), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), this.skyMat);
    this.scene.add(sky);

    this.scene.fog = new THREE.FogExp2(0xc7d6e6, 0.01);

    this.hemi.position.set(0, 50, 0);
    this.scene.add(this.hemi);
    this.scene.add(this.ambient);

    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 120;
    const sc = this.key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.celestial = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 24), this.celestialMat);
    this.scene.add(this.celestial);

    this.scene.add(this.gravesGroup);
    this.scene.add(this.decorGroup);

    this.buildStaticGround();

    // Ambiance initiale (heure + saison réelles).
    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);

    this.bindEvents();
    this.renderer.setAnimationLoop(this.loop);
  }

  // ---- API publique ----

  onFocusChange(cb: (c: Colleague | null) => void) {
    this.focusCb = cb;
  }

  onLockChange(cb: (locked: boolean) => void) {
    this.lockCb = cb;
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
    // Replace le visiteur à l'entrée.
    this.controls.object.position.set(0, EYE_HEIGHT, this.plotHalf - 3);
    this.velocity.set(0, 0, 0);
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

  // ---- Construction ----

  private buildStaticGround() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), this.groundMat);
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
    (this.skyMat.uniforms.topColor.value as THREE.Color).setHex(a.skyTop);
    (this.skyMat.uniforms.bottomColor.value as THREE.Color).setHex(a.skyBottom);

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(a.fogColor);
    fog.density = a.fogDensity;

    this.hemi.color.setHex(a.hemiSky);
    this.hemi.groundColor.setHex(a.hemiGround);
    this.hemi.intensity = a.hemiIntensity;

    this.ambient.color.setHex(a.ambientColor);
    this.ambient.intensity = a.ambientIntensity;

    this.key.color.setHex(a.keyLightColor);
    this.key.intensity = a.keyLightIntensity;
    const d = new THREE.Vector3(...a.keyLightDir).normalize().multiplyScalar(60);
    this.key.position.copy(d);
    this.key.target.position.set(0, 0, 0);

    this.groundMat.color.setHex(a.groundColor);

    this.celestialMat.color.setHex(a.celestialColor);
    this.celestial.visible = a.celestial !== "none";
    this.celestial.position.copy(d).multiplyScalar(1.2);

    this.rebuildDecor(a);
  }

  private layoutGraves() {
    this.gravesGroup.clear();
    if (!this.detail) return;
    const list = this.detail.colleagues;
    const perRow = Math.max(4, Math.ceil(Math.sqrt(list.length)));
    const spacingX = 3.2;
    const spacingZ = 3.6;
    const rows = Math.ceil(list.length / perRow);

    // Dimensionne la parcelle selon le nombre de tombes.
    this.plotHalf = Math.max(16, (Math.max(perRow, rows) * Math.max(spacingX, spacingZ)) / 2 + 5);

    const startX = -((perRow - 1) * spacingX) / 2;
    const startZ = -((rows - 1) * spacingZ) / 2 - 2;

    list.forEach((colleague, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const jitter = seededRandom(colleague.graveSeed + 7);
      const grave = createGrave(colleague, this.ambiance.graveColor, this.ambiance.scary);
      grave.position.set(
        startX + col * spacingX + (jitter() - 0.5) * 0.4,
        0,
        startZ + row * spacingZ + (jitter() - 0.5) * 0.4,
      );
      this.gravesGroup.add(grave);
    });

    this.rebuildDecor(this.ambiance);
  }

  private rebuildDecor(a: Ambiance) {
    // Vide la décoration précédente.
    this.disposeGroup(this.decorGroup);
    this.flickerLights = [];
    this.bats = [];

    this.buildFence(a);
    this.buildTrees(a);
    this.buildPath();
    if (a.scary) this.buildHalloweenProps();
    this.buildParticles(a);
  }

  private buildFence(a: Ambiance) {
    const half = this.plotHalf;
    const postMat = new THREE.MeshStandardMaterial({
      color: a.scary ? 0x1a1a1f : 0x2b2b30,
      roughness: 0.7,
      metalness: 0.4,
    });
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6);
    const railGeo = new THREE.BoxGeometry(1, 0.06, 0.06);
    const step = 1.4;
    const sides: Array<[number, number, number, number]> = [
      [-half, half, -half, -half],
      [-half, half, half, half],
      [-half, -half, -half, half],
      [half, half, -half, half],
    ];
    for (const [x1, x2, z1, z2] of sides) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const count = Math.floor(len / step);
      for (let i = 0; i <= count; i++) {
        const t = i / count;
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x1 + (x2 - x1) * t, 0.9, z1 + (z2 - z1) * t);
        post.castShadow = true;
        this.decorGroup.add(post);
      }
      const rail = new THREE.Mesh(railGeo.clone(), postMat);
      rail.scale.x = len;
      rail.position.set((x1 + x2) / 2, 1.4, (z1 + z2) / 2);
      if (Math.abs(z2 - z1) > Math.abs(x2 - x1)) rail.rotation.y = Math.PI / 2;
      this.decorGroup.add(rail);
    }
  }

  private buildTrees(a: Ambiance) {
    const rand = seededRandom(1234);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: a.foliageColor, roughness: 1 });
    const count = 10;
    for (let i = 0; i < count; i++) {
      const tree = new THREE.Group();
      const h = 2.5 + rand() * 2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 6), trunkMat);
      trunk.position.y = h / 2;
      trunk.castShadow = true;
      tree.add(trunk);
      if (!a.scary && a.seasonKey !== "winter") {
        const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + rand() * 0.6, 0), foliageMat);
        foliage.position.y = h + 0.4;
        foliage.castShadow = true;
        tree.add(foliage);
      } else {
        // Branches nues / arbre mort.
        for (let b = 0; b < 4; b++) {
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 1.2, 5), trunkMat);
          branch.position.y = h * 0.8;
          branch.rotation.z = (rand() - 0.5) * 1.6;
          branch.rotation.x = (rand() - 0.5) * 1.6;
          tree.add(branch);
        }
      }
      // Place les arbres en périphérie, hors des rangées de tombes.
      const angle = rand() * Math.PI * 2;
      const dist = this.plotHalf - 1.5 - rand() * 2;
      tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      this.decorGroup.add(tree);
    }
  }

  private buildPath() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 1 });
    const path = new THREE.Mesh(new THREE.PlaneGeometry(2.2, this.plotHalf * 2), mat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(this.plotHalf - 2.2, 0.02, 0);
    path.rotation.z = Math.PI / 2;
    path.receiveShadow = true;
    this.decorGroup.add(path);
  }

  private buildHalloweenProps() {
    const rand = seededRandom(666);
    // Citrouilles lumineuses (jack-o'-lanterns).
    const pumpkinMat = new THREE.MeshStandardMaterial({
      color: 0xd2691e,
      emissive: 0xff7518,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    for (let i = 0; i < 7; i++) {
      const pumpkin = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), pumpkinMat);
      pumpkin.scale.y = 0.8;
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (this.plotHalf - 4);
      pumpkin.position.set(Math.cos(angle) * dist, 0.35, Math.sin(angle) * dist);
      this.decorGroup.add(pumpkin);

      const light = new THREE.PointLight(0xff7518, 2.2, 9, 2);
      light.position.copy(pumpkin.position).add(new THREE.Vector3(0, 0.4, 0));
      light.userData.base = 2.2;
      light.userData.phase = rand() * Math.PI * 2;
      this.decorGroup.add(light);
      this.flickerLights.push(light);
    }

    // Chauves-souris (triangles animés qui tournoient).
    const batMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0f, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([-0.4, 0, 0, 0, 0.12, 0, 0.4, 0, 0], 3),
      );
      const bat = new THREE.Mesh(geo, batMat);
      bat.userData.radius = 4 + rand() * 8;
      bat.userData.speed = 0.4 + rand() * 0.6;
      bat.userData.phase = rand() * Math.PI * 2;
      bat.userData.height = 5 + rand() * 4;
      this.decorGroup.add(bat);
      this.bats.push(bat);
    }
  }

  private buildParticles(a: Ambiance) {
    if (a.particles === "none") {
      this.particles = undefined;
      this.particleData = null;
      return;
    }
    const count = a.particles === "snow" ? 1200 : a.particles === "embers" ? 500 : 700;
    const bounds = this.plotHalf + 6;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * bounds * 2;
      positions[i * 3 + 1] = Math.random() * 24;
      positions[i * 3 + 2] = (Math.random() - 0.5) * bounds * 2;
      velocities[i * 3] = (Math.random() - 0.5) * 0.4;
      velocities[i * 3 + 1] = -0.2 - Math.random() * 0.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const colorMap: Record<string, number> = {
      snow: 0xffffff,
      leaves: 0xc06a2a,
      pollen: 0xeae28a,
      embers: 0xff8a3c,
    };
    const mat = new THREE.PointsMaterial({
      color: colorMap[a.particles] ?? 0xffffff,
      size: a.particles === "snow" ? 0.18 : a.particles === "embers" ? 0.12 : 0.22,
      transparent: true,
      opacity: a.particles === "pollen" ? 0.6 : 0.85,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particleData = { kind: a.particles, velocities, bounds };
    this.decorGroup.add(this.particles);
  }

  // ---- Boucle d'animation ----

  private loop = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.running) {
      this.updateMovement(dt);
      this.updateFocus();
    }
    this.updateParticles(dt);
    this.updateHalloween(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private updateMovement(dt: number) {
    if (!this.controls.isLocked) {
      this.velocity.set(0, 0, 0);
      return;
    }
    const speed = this.move.run ? RUN_SPEED : WALK_SPEED;
    const damping = Math.exp(-12 * dt);
    this.velocity.x *= damping;
    this.velocity.z *= damping;

    this.direction.z = Number(this.move.forward) - Number(this.move.backward);
    this.direction.x = Number(this.move.right) - Number(this.move.left);
    this.direction.normalize();

    if (this.move.forward || this.move.backward) this.velocity.z -= this.direction.z * speed * dt * 8;
    if (this.move.left || this.move.right) this.velocity.x -= this.direction.x * speed * dt * 8;

    this.controls.moveRight(-this.velocity.x * dt);
    this.controls.moveForward(-this.velocity.z * dt);

    // Maintien dans la parcelle.
    const p = this.controls.object.position;
    const lim = this.plotHalf - 1.2;
    p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
    p.z = THREE.MathUtils.clamp(p.z, -lim, lim);
    p.y = EYE_HEIGHT;
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

  private updateParticles(dt: number) {
    if (!this.particles || !this.particleData) return;
    const { kind, velocities, bounds } = this.particleData;
    const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = this.clock.elapsedTime;
    for (let i = 0; i < arr.length; i += 3) {
      if (kind === "embers") {
        arr[i + 1] += (0.6 + velocities[i + 1] * -0.4) * dt;
        arr[i] += Math.sin(t + i) * 0.01;
      } else {
        arr[i] += velocities[i] * dt + Math.sin(t + i) * (kind === "leaves" ? 0.02 : 0.005);
        arr[i + 1] += velocities[i + 1] * dt;
        arr[i + 2] += velocities[i + 2] * dt;
      }
      if (arr[i + 1] < 0 || arr[i + 1] > 26) {
        arr[i] = (Math.random() - 0.5) * bounds * 2;
        arr[i + 1] = kind === "embers" ? 0 : 24;
        arr[i + 2] = (Math.random() - 0.5) * bounds * 2;
      }
    }
    pos.needsUpdate = true;
  }

  private updateHalloween(dt: number) {
    const t = this.clock.elapsedTime;
    for (const light of this.flickerLights) {
      const base = light.userData.base as number;
      light.intensity = base * (0.7 + Math.sin(t * 12 + (light.userData.phase as number)) * 0.15 + Math.random() * 0.15);
    }
    for (const bat of this.bats) {
      const r = bat.userData.radius as number;
      const s = bat.userData.speed as number;
      const phase = bat.userData.phase as number;
      const angle = t * s + phase;
      bat.position.set(Math.cos(angle) * r, (bat.userData.height as number) + Math.sin(t * 2 + phase), Math.sin(angle) * r);
      bat.rotation.y = -angle;
      bat.scale.y = 1 + Math.sin(t * 18 + phase) * 0.6; // battement d'ailes
    }
  }

  // ---- Événements ----

  private bindEvents() {
    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("keyup", this.onKey);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onKey = (e: KeyboardEvent) => {
    const down = e.type === "keydown";
    switch (e.code) {
      case "KeyW":
      case "KeyZ":
      case "ArrowUp":
        this.move.forward = down;
        break;
      case "KeyS":
      case "ArrowDown":
        this.move.backward = down;
        break;
      case "KeyA":
      case "KeyQ":
      case "ArrowLeft":
        this.move.left = down;
        break;
      case "KeyD":
      case "ArrowRight":
        this.move.right = down;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.move.run = down;
        break;
    }
  };

  private disposeGroup(group: THREE.Group) {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    group.clear();
  }
}
