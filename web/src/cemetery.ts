import * as THREE from "three";
import type { Colleague, Company, CompanyDetail } from "./types.ts";
import { createGrave } from "./graves.ts";
import { graveAxes } from "./graveAxes.ts";
import { cemeteryLayout } from "./procedural.ts";
import { buildWorld, type WorldSlotWithCompany } from "./world.ts";
import { Presence, type PeerState } from "./net.ts";
import { makeAvatar, showEmote, tickEmote, type Avatar } from "./avatars.ts";
import { getAmbiance, resolveSeasonKey, resolveTimeKey, type Ambiance, type SeasonSetting, type TimeSetting } from "./ambiance.ts";
import { createSky, type Sky } from "./scene/sky.ts";
import { Lighting } from "./scene/lighting.ts";
import { Decor } from "./scene/decor.ts";
import { buildGroundMaterial } from "./scene/grass.ts";
import { GrassField, shouldHaveGrass, MAX_BLADES } from "./scene/grassField.ts";
import { TerrainChunk } from "./scene/terrain.ts";
import { VegetationInstances } from "./scene/vegetation.ts";
import { FirstPersonControls, EYE_HEIGHT } from "./scene/controls.ts";

const FOV = 70;
const NEAR = 0.1;
const FAR = 400;
const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.05;
const FOCUS_RADIUS = 3.2;
const LOAD_RADIUS = 24; // marge d'approche au-delà de la parcelle pour charger « à vue »
const GRASS_LOD_RADIUS = 30; // en dessous : rendu complet ; au-delà : réduit
const GRASS_LOD_FAR = 1_000; // instances pour les parcelles éloignées
const NEAR_MARGIN = 3; // tolérance pour se considérer « à » un cimetière (HUD, ajout)
const GROUND_PAD = 60; // débord du sol autour des bornes du monde
const PARTICLE_HALF = 60; // demi-étendue des particules d'ambiance autour du spawn
const PEER_SMOOTH_RATE = 10; // lissage exponentiel de l'interpolation des pairs
const WORLD_ROOM = "world"; // salon de présence unique du monde continu (#4)

/** Pair distant : son avatar et la cible vers laquelle on interpole. */
type Peer = { avatar: Avatar; tx: number; ty: number; tz: number; try_: number };

/** Charge les tombes d'un cimetière à la demande (injecté par main.ts). */
type ColleagueLoader = (companyId: string) => Promise<CompanyDetail>;

/** Orchestrateur de la scène 3D : assemble ciel, lumières, décor, contrôles, et
 *  le MONDE continu — une allée sinueuse bordée de cimetières chargés « à vue »
 *  (évolution de l'issue #5) avec la présence des autres visiteurs (#4). */
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
  private readonly ground: THREE.Mesh;
  private readonly gravesGroup = new THREE.Group();
  private readonly grassGroup = new THREE.Group();
  private readonly groundPlanesGroup = new THREE.Group();
  private readonly grassFields: GrassField[] = [];
  private readonly terrains = new Map<string, TerrainChunk>();
  private readonly vegetations: VegetationInstances[] = [];
  private readonly vegetationGroup = new THREE.Group();
  private readonly worldGroup = new THREE.Group();
  private readonly peersGroup = new THREE.Group();

  private ambiance: Ambiance;
  private timeSetting: TimeSetting = "auto";
  private seasonSetting: SeasonSetting = "auto";
  private running = false;
  // DEV : prochain unlock ne montre pas le lockPrompt (Tab silencieux).
  private silentNextUnlock = false;
  private freeflightCb: ((active: boolean) => void) | null = null;

  private focusCb: (c: Colleague | null) => void = () => {};
  private focused: Colleague | null = null;

  // Monde continu + chargement « à vue ».
  private slots: WorldSlotWithCompany[] = [];
  private loader: ColleagueLoader = async () => ({ company: {} as CompanyDetail["company"], colleagues: [] });
  private readonly loaded = new Map<string, Colleague[]>(); // tombes déjà construites
  private readonly requested = new Set<string>(); // déjà chargé ou en cours (anti-spam)
  private nearestId: string | null = null;
  private nearestCb: (c: Company | null) => void = () => {};

  // Présence multijoueur (#4).
  private readonly presence = new Presence();
  private readonly peers = new Map<string, Peer>();
  private visitorName = "Visiteur";
  private currentRoom: string | null = null;
  private countCb: (n: number) => void = () => {};

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
    this.scene.add(this.gravesGroup, this.grassGroup, this.groundPlanesGroup, this.decor.group, this.worldGroup, this.peersGroup, this.vegetationGroup);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.controls = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);
    this.controls.placeAt(0, 0);

    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onActionKey);
    this.renderer.setAnimationLoop(this.loop);
  }

  onFocusChange(cb: (c: Colleague | null) => void) {
    this.focusCb = cb;
  }

  /** Notifié quand le mode freeflight change (DEV uniquement). */
  onFreeflightChange(cb: (active: boolean) => void) {
    this.freeflightCb = cb;
  }

  onLockChange(cb: (locked: boolean, silent?: boolean) => void) {
    this.controls.pointer.addEventListener("lock",   () => cb(true));
    this.controls.pointer.addEventListener("unlock", () => {
      const silent = this.silentNextUnlock;
      this.silentNextUnlock = false;
      cb(false, silent);
    });
  }

  /** Cimetière le plus proche (où l'on se tient) ou null si l'on est sur la route. */
  onNearestCemetery(cb: (c: Company | null) => void) {
    this.nearestCb = cb;
  }

  onVisitorCount(cb: (n: number) => void) {
    this.countCb = cb;
  }

  setColleagueLoader(loader: ColleagueLoader) {
    this.loader = loader;
  }

  setVisitorName(name: string) {
    this.visitorName = name;
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

  /**
   * Entre dans le monde continu : route sinueuse + arches des cimetières.
   * `spawnCompanyId` permet de réapparaître directement à l'entrée d'un
   * cimetière (voyage rapide depuis le menu = futur spawn par chunk, #5).
   */
  enterWorld(companies: Company[], spawnCompanyId?: string) {
    this.clearWorld();
    const world = buildWorld(companies, this.ambiance);
    this.slots = world.slots;
    this.worldGroup.add(world.group);
    this.resizeGround(world.bounds);
    this.controls.setBoundsRect(world.bounds);

    const spawn = spawnCompanyId ? this.slots.find((s) => s.id === spawnCompanyId)?.entrance : undefined;
    const start = spawn ?? world.start;
    this.controls.placeAt(start.x, start.z);

    this.decor.build(this.ambiance, PARTICLE_HALF, { structures: false });
    this.connectRoom(WORLD_ROOM);
    this.updateStreaming(); // charge ce qui est déjà à portée du spawn
  }

  /** Ajoute un collègue au cimetière où l'on se tient et reconstruit ses tombes. */
  addColleague(companyId: string, colleague: Colleague) {
    const list = this.loaded.get(companyId);
    if (!list) return; // pas encore chargé : apparaîtra à l'approche
    list.push(colleague);
    const slot = this.slots.find((s) => s.id === companyId);
    if (slot) this.buildCemeteryGraves(slot, list);
  }

  setAmbianceSettings(time: TimeSetting, season: SeasonSetting) {
    this.timeSetting = time;
    this.seasonSetting = season;
    const next = this.resolveAmbiance();
    // La teinte de base des pierres dépend de la saison → on reconstruit les
    // tombes chargées quand elle change (les 3 axes #25 sont recalculés au passage).
    const graveColorChanged = next.graveColor !== this.ambiance.graveColor;
    this.ambiance = next;
    this.applyAmbiance(next);
    if (graveColorChanged) {
      for (const slot of this.slots) {
        const list = this.loaded.get(slot.id);
        if (list) this.buildCemeteryGraves(slot, list);
      }
    }
  }

  /** Quitte tout salon de présence (retour menu / déconnexion, issue #4). */
  leavePresence() {
    this.presence.disconnect();
    this.currentRoom = null;
    this.clearPeers();
    this.countCb(0);
  }

  /** Joue une emote, relayée aux autres visiteurs (issue #4). */
  emote(name: string) {
    this.presence.emote(name);
  }

  private resizeGround(b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.ground.geometry.dispose();
    this.ground.geometry = new THREE.PlaneGeometry(b.maxX - b.minX + GROUND_PAD * 2, b.maxZ - b.minZ + GROUND_PAD * 2);
    this.ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
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
    // La forêt/les arches sont portées par world.ts ; ici, seulement les particules.
    this.decor.build(a, PARTICLE_HALF, { structures: false });
  }

  // ---- Monde continu : chargement « à vue » ----

  private updateStreaming() {
    const cam = this.camera.position;
    let nearestId: string | null = null;
    let best = Infinity;
    for (const slot of this.slots) {
      const d = Math.hypot(slot.plotCenter.x - cam.x, slot.plotCenter.z - cam.z);
      if (d < slot.plotHalf + LOAD_RADIUS && !this.requested.has(slot.id)) {
        void this.loadCemetery(slot);
      }
      if (d < slot.plotHalf + NEAR_MARGIN && d < best) {
        best = d;
        nearestId = slot.id;
      }
    }
    if (nearestId !== this.nearestId) {
      this.nearestId = nearestId;
      this.nearestCb(nearestId ? this.slots.find((s) => s.id === nearestId)!.company : null);
    }
  }

  private async loadCemetery(slot: WorldSlotWithCompany) {
    this.requested.add(slot.id); // une seule tentative par session (anti-spam au survol)
    try {
      // Le terrain est construit en premier : herbe et tombes s'y calent.
      const mat = buildGroundMaterial(slot.id, slot.company.karma, this.ambiance.seasonKey, slot.plotHalf);
      const terrain = new TerrainChunk(slot.id, slot.plotHalf, slot.plotCenter, mat);

      const [detail, grassField, veg] = await Promise.all([
        this.loader(slot.id),
        shouldHaveGrass(slot.company.karma, this.ambiance.seasonKey)
          ? GrassField.create(slot.id, slot.company.karma, slot.plotHalf, slot.plotCenter, slot.rotY, terrain)
          : Promise.resolve(null),
        VegetationInstances.create(slot.id, slot.plotHalf, slot.plotCenter, slot.rotY, terrain),
      ]);
      if (!this.slots.includes(slot)) {
        if (grassField) grassField.dispose();
        if (veg) veg.dispose();
        terrain.dispose();
        return; // on a quitté le monde entre-temps
      }
      this.terrains.set(slot.id, terrain);
      this.groundPlanesGroup.add(terrain.mesh);
      this.loaded.set(slot.id, detail.colleagues);
      this.buildCemeteryGraves(slot, detail.colleagues);
      if (grassField) {
        this.grassGroup.add(grassField.mesh);
        this.grassFields.push(grassField);
      }
      if (veg) {
        for (const m of veg.meshes) this.vegetationGroup.add(m);
        this.vegetations.push(veg);
      }
    } catch {
      // ponytail: pas de backoff ; le cimetière reste vide jusqu'au prochain enterWorld.
    }
  }

  private buildCemeteryGraves(slot: WorldSlotWithCompany, colleagues: Colleague[]) {
    this.removeCemeteryGraves(slot.id);
    const layout = cemeteryLayout(slot.id, colleagues.length);
    const terrain = this.terrains.get(slot.id);
    const now = Date.now();
    const cos = Math.cos(slot.rotY);
    const sin = Math.sin(slot.rotY);
    colleagues.forEach((colleague, i) => {
      const place = layout.placements[i];
      const grave = createGrave(colleague, this.ambiance.graveColor, graveAxes(colleague, now));
      const wx = slot.plotCenter.x + place.x * cos + place.z * sin;
      const wz = slot.plotCenter.z - place.x * sin + place.z * cos;
      grave.position.set(wx, terrain ? terrain.getHeightAt(wx, wz) : 0, wz);
      grave.rotation.y += place.rotY + slot.rotY;
      grave.userData.companyId = slot.id;
      this.gravesGroup.add(grave);
    });
  }

  private removeCemeteryGraves(id: string) {
    const stale = this.gravesGroup.children.filter((g) => g.userData.companyId === id);
    for (const g of stale) {
      this.gravesGroup.remove(g);
      disposeObject(g);
    }
  }

  private clearWorld() {
    disposeObject(this.worldGroup);
    this.worldGroup.clear();
    disposeObject(this.gravesGroup);
    this.gravesGroup.clear();
    for (const field of this.grassFields) field.dispose();
    this.grassFields.length = 0;
    this.grassGroup.clear();
    for (const v of this.vegetations) v.dispose();
    this.vegetations.length = 0;
    this.vegetationGroup.clear();
    for (const t of this.terrains.values()) t.dispose();
    this.terrains.clear();
    disposeObject(this.groundPlanesGroup);
    this.groundPlanesGroup.clear();
    this.slots = [];
    this.loaded.clear();
    this.requested.clear();
    this.nearestId = null;
    this.focused = null;
  }

  // ---- Présence multijoueur (#4) ----

  private connectRoom(room: string) {
    if (room === this.currentRoom) return;
    this.currentRoom = room;
    this.clearPeers();
    this.presence.connect(room, this.visitorName, {
      onPeerState: (p) => this.upsertPeer(p),
      onPeerLeave: (id) => this.removePeer(id),
      onEmote: (id, emote) => {
        const peer = this.peers.get(id);
        if (peer) showEmote(peer.avatar, emote, performance.now());
      },
      onCount: (n) => this.countCb(n),
    });
  }

  private upsertPeer(p: PeerState) {
    let peer = this.peers.get(p.id);
    if (!peer) {
      const avatar = makeAvatar(p.name);
      avatar.group.position.set(p.x, p.y, p.z);
      avatar.group.rotation.y = p.ry;
      this.peersGroup.add(avatar.group);
      peer = { avatar, tx: p.x, ty: p.y, tz: p.z, try_: p.ry };
      this.peers.set(p.id, peer);
    }
    peer.tx = p.x;
    peer.ty = p.y;
    peer.tz = p.z;
    peer.try_ = p.ry;
  }

  private removePeer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peersGroup.remove(peer.avatar.group);
    disposeObject(peer.avatar.group);
    this.peers.delete(id);
  }

  private clearPeers() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  // ---- Boucle ----

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

  /** Publie notre position aux pairs (cadence limitée côté Presence). */
  private publishPresence() {
    if (!this.currentRoom) return;
    const p = this.controls.object.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.presence.setState(p.x, p.y, p.z, Math.atan2(dir.x, dir.z));
  }

  /** Interpole les avatars distants vers leur dernière position connue (issue #4). */
  private updatePeers(dt: number) {
    const now = performance.now();
    const k = 1 - Math.exp(-PEER_SMOOTH_RATE * dt);
    for (const peer of this.peers.values()) {
      const g = peer.avatar.group;
      g.position.x += (peer.tx - g.position.x) * k;
      g.position.y += (peer.ty - g.position.y) * k;
      g.position.z += (peer.tz - g.position.z) * k;
      let d = peer.try_ - g.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // plus court chemin angulaire
      g.rotation.y += d * k;
      tickEmote(peer.avatar, now);
    }
  }

  private loop = () => {
    const dt = Math.min(this.clock.getDelta(), MAX_DELTA);
    if (this.running) {
      this.controls.update(dt);
      this.updateFocus();
      this.updateStreaming();
      this.publishPresence();
    }
    this.updatePeers(dt);
    this.decor.update(dt, this.clock.elapsedTime);
    const t = this.clock.elapsedTime;
    const cam = this.camera.position;
    for (const field of this.grassFields) {
      field.update(t);
      const d = Math.hypot(field.center.x - cam.x, field.center.z - cam.z);
      field.mesh.count = d < GRASS_LOD_RADIUS ? MAX_BLADES : GRASS_LOD_FAR;
    }
    for (const v of this.vegetations) {
      const dv = Math.hypot(v.center.x - cam.x, v.center.z - cam.z);
      const visible = dv < LOAD_RADIUS * 1.5;
      for (const m of v.meshes) m.count = visible ? (m.userData.maxCount as number) : 0;
    }
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onActionKey = (e: KeyboardEvent) => {
    if (e.type !== "keydown" || !this.controls.isLocked) return;
    if (e.code === "KeyF") this.emote("wave"); // emote « saluer » synchronisée (#4)
    if (import.meta.env.DEV) {
      if (e.code === "F2") {
        // Toggle freeflight : caméra libre sans contraintes de sol ni de bounds.
        this.controls.toggleFreeflight();
        this.freeflightCb?.(this.controls.isFreeflightMode);
        e.preventDefault();
      }
      if (e.code === "Tab") {
        // Déverrouille la souris sans afficher le lockPrompt ; clic canvas re-lock.
        e.preventDefault();
        this.silentNextUnlock = true;
        this.controls.unlock();
        const relock = () => {
          if (!this.controls.isLocked) this.controls.lock();
          this.renderer.domElement.removeEventListener("click", relock);
        };
        this.renderer.domElement.addEventListener("click", relock);
      }
    }
  };
}

/** Libère géométries ET matériaux/textures d'un objet (sans vider le groupe). */
function disposeObject(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      // splatTex est une DataTexture hors du circuit standard de dispose
      const splatTex = m.userData?.splatTex as THREE.DataTexture | undefined;
      if (splatTex) splatTex.dispose();
      m.dispose();
    }
  });
}
