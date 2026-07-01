import * as THREE from "three";
import type { Colleague, Company, CompanyDetail } from "./types.ts";
import { buildWorld } from "./world.ts";
import { Presence, type PeerState } from "./net.ts";
import { makeAvatar, showEmote, tickEmote, type Avatar } from "./avatars.ts";
import { applyWeather, getAmbiance, resolveSeasonKey, resolveTimeKey, type Ambiance, type SeasonSetting, type TimeSetting, type WeatherKey } from "./ambiance.ts";
import { createSky, type Sky } from "./scene/sky.ts";
import { HdriSky } from "./scene/hdriSky.ts";
import { Lighting } from "./scene/lighting.ts";
import { Decor } from "./scene/decor.ts";
import { CHUNK_LOAD_RADIUS } from "./chunkStreaming.ts";
import { WorldStreamer } from "./scene/worldStreamer.ts";
import { disposeObject } from "./scene/disposeObject.ts";
import { FirstPersonControls, EYE_HEIGHT } from "./scene/controls.ts";

const FOV = 70;
const NEAR = 0.1;
const FAR = 400;
const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.05;
const FOCUS_RADIUS = 3.2;
const GRASS_LOD_RADIUS = 30; // en dessous : rendu complet
const GRASS_LOD_MED = 50;    // en dessous : rendu réduit ; au-delà : zéro
const GRASS_LOD_FAR = 400;   // instances pour les parcelles en LOD intermédiaire
const VEG_VISIBLE_MARGIN = 1.5; // végétation visible jusqu'à +50 % du rayon de chargement d'un chunk
const VEG_VISIBLE_RADIUS = CHUNK_LOAD_RADIUS * VEG_VISIBLE_MARGIN;
const GROUND_PAD = 60; // débord du sol autour des bornes du monde
const PARTICLE_HALF = 60; // demi-étendue des particules d'ambiance autour du spawn
const PEER_SMOOTH_RATE = 10; // lissage exponentiel de l'interpolation des pairs
// Distribution pondérée de la météo : beau temps 3× plus fréquent.
const WEATHER_OPTIONS: WeatherKey[] = ["clear", "clear", "clear", "brumeux", "orageux"];
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
  private readonly hdriSky: HdriSky;
  private readonly lighting = new Lighting();
  private readonly decor = new Decor();
  private readonly controls: FirstPersonControls;
  private readonly groundMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  private readonly ground: THREE.Mesh;
  private readonly gravesGroup = new THREE.Group();
  private readonly grassGroup = new THREE.Group();
  private readonly groundPlanesGroup = new THREE.Group();
  private readonly vegetationGroup = new THREE.Group();
  private readonly worldGroup = new THREE.Group();
  private readonly peersGroup = new THREE.Group();
  /** Charge/décharge les chunks des cimetières à l'approche (#5). */
  private readonly streamer = new WorldStreamer(
    {
      gravesGroup: this.gravesGroup, grassGroup: this.grassGroup, groundPlanesGroup: this.groundPlanesGroup,
      vegetationGroup: this.vegetationGroup, worldGroup: this.worldGroup,
    },
    () => this.ambiance,
  );

  private ambiance: Ambiance;
  private timeSetting: TimeSetting = "auto";
  private seasonSetting: SeasonSetting = "auto";
  private running = false;
  // DEV : prochain unlock ne montre pas le lockPrompt (Tab silencieux).
  private silentNextUnlock = false;
  private freeflightCb: ((active: boolean) => void) | null = null;

  // Météo dynamique (#8) : changement automatique toutes les 5–15 min.
  private weather: WeatherKey = "clear";
  private weatherChangeAt = 0;
  private ambianceRefreshAt = 0;
  private maintainCb: (c: Colleague) => void = () => {};

  private focusCb: (c: Colleague | null) => void = () => {};
  private focused: Colleague | null = null;

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
    this.hdriSky = new HdriSky(this.renderer);
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
    this.streamer.onNearestCemetery(cb);
  }

  onVisitorCount(cb: (n: number) => void) {
    this.countCb = cb;
  }

  /** Appelé quand l'utilisateur appuie sur R près d'une tombe (issue #8). */
  onMaintainRequest(cb: (c: Colleague) => void) {
    this.maintainCb = cb;
  }

  setColleagueLoader(loader: ColleagueLoader) {
    this.streamer.setLoader(loader);
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
    this.streamer.enter(world.slots);
    this.worldGroup.add(world.group);
    this.resizeGround(world.bounds);
    this.controls.setBoundsRect(world.bounds);

    const spawn = spawnCompanyId ? world.slots.find((s) => s.id === spawnCompanyId)?.entrance : undefined;
    const start = spawn ?? world.start;
    this.controls.placeAt(start.x, start.z);

    this.decor.build(this.ambiance, PARTICLE_HALF, { structures: false });
    this.connectRoom(WORLD_ROOM);
    this.streamer.update({ x: start.x, z: start.z }); // charge ce qui est déjà à portée du spawn
  }

  /** Ajoute un collègue au cimetière où l'on se tient et reconstruit ses tombes. */
  addColleague(companyId: string, colleague: Colleague) {
    this.streamer.addColleague(companyId, colleague);
  }

  updateColleague(colleague: Colleague) {
    this.streamer.updateColleague(colleague);
  }

  /** Place la caméra à proximité d'une tombe donnée (issue #18 : lien de partage). */
  highlightGrave(id: string) {
    const grave = this.gravesGroup.children.find(
      (g) => (g.userData.colleague as Colleague | undefined)?.id === id,
    );
    if (grave) this.controls.placeAt(grave.position.x, grave.position.z + 2);
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
    if (graveColorChanged) this.streamer.rebuildAllLoadedGraves();
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
    const effective = applyWeather(a, this.weather);
    this.sky.setColors(effective.skyTop, effective.skyBottom);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(effective.fogColor);
    fog.density = effective.fogDensity;
    this.lighting.apply(effective);
    this.groundMat.color.setHex(effective.groundColor);
    // La forêt/les arches sont portées par world.ts ; ici, seulement les particules.
    this.decor.build(effective, PARTICLE_HALF, { structures: false });
    void this.applyHdriSky(effective);
  }

  /** Charge (async) le ciel HDR de l'ambiance et bascule le dôme shader en
   *  secours quand aucun HDR n'est prévu (nuit, Halloween). */
  private async applyHdriSky(a: Ambiance) {
    const used = await this.hdriSky.apply(this.scene, a.timeKey, a.scary);
    if (a !== this.ambiance) return; // l'ambiance a changé entre-temps
    this.sky.mesh.visible = !used;
  }

  clearWorld() {
    disposeObject(this.worldGroup);
    this.worldGroup.clear();
    disposeObject(this.gravesGroup);
    this.gravesGroup.clear();
    this.streamer.clear();
    this.grassGroup.clear();
    this.vegetationGroup.clear();
    disposeObject(this.groundPlanesGroup);
    this.groundPlanesGroup.clear();
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

  // ---- Météo & ambiance auto (#8) ----

  private maybeRefreshAmbiance() {
    const now = performance.now();
    if (now >= this.weatherChangeAt) {
      this.weather = WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)];
      this.weatherChangeAt = now + (5 + Math.random() * 10) * 60_000;
      this.applyAmbiance(this.ambiance);
    }
    if (now >= this.ambianceRefreshAt) {
      const next = this.resolveAmbiance();
      const graveColorChanged = next.graveColor !== this.ambiance.graveColor;
      this.ambiance = next;
      this.applyAmbiance(next);
      // Reconstruit les tombes chargées si la couleur de pierre change.
      if (graveColorChanged) this.streamer.rebuildAllLoadedGraves();
      this.ambianceRefreshAt = now + 60_000;
    }
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
      this.streamer.update({ x: this.camera.position.x, z: this.camera.position.z });
      this.publishPresence();
    }
    this.updatePeers(dt);
    this.decor.update(dt, this.clock.elapsedTime);
    this.maybeRefreshAmbiance();
    const t = this.clock.elapsedTime;
    const cam = this.camera.position;
    for (const chunk of this.streamer.loadedChunks.values()) {
      const field = chunk.grass;
      if (field) {
        field.update(t);
        // Distance à la TRANCHE (− halfLength), pas à son centre : un chunk long
        // reste « proche » quand on se tient à son extrémité (sinon herbe à 0).
        const d = Math.max(0, Math.hypot(field.center.x - cam.x, field.center.z - cam.z) - field.halfLength);
        field.mesh.count = d < GRASS_LOD_RADIUS ? field.bladeCount : d < GRASS_LOD_MED ? Math.min(field.bladeCount, GRASS_LOD_FAR) : 0;
      }
      const veg = chunk.veg;
      if (veg) {
        const dv = Math.max(0, Math.hypot(veg.center.x - cam.x, veg.center.z - cam.z) - veg.halfLength);
        const visible = dv < VEG_VISIBLE_RADIUS;
        for (const m of veg.meshes) m.count = visible ? (m.userData.maxCount as number) : 0;
      }
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
    if (e.code === "KeyR" && this.focused) this.maintainCb(this.focused); // entretien (#8)
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
