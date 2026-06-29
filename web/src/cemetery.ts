import * as THREE from "three";
import type { Colleague, Company, CompanyDetail } from "./types.ts";
import { createGrave } from "./graves.ts";
import { graveAxes } from "./graveAxes.ts";
import { cemeteryLayout } from "./procedural.ts";
import { buildHub, type Portal } from "./hub.ts";
import { Presence, type PeerState } from "./net.ts";
import { makeAvatar, showEmote, tickEmote, type Avatar } from "./avatars.ts";
import { applyKarmaTheme, getAmbiance, resolveSeasonKey, resolveTimeKey, type Ambiance, type SeasonSetting, type TimeSetting } from "./ambiance.ts";
import { createSky, type Sky } from "./scene/sky.ts";
import { Lighting } from "./scene/lighting.ts";
import { Decor } from "./scene/decor.ts";
import { FirstPersonControls, EYE_HEIGHT } from "./scene/controls.ts";

const FOV = 70;
const NEAR = 0.1;
const FAR = 400;
const MAX_PIXEL_RATIO = 2;
const MAX_DELTA = 0.05;
const FOCUS_RADIUS = 3.2;
const PORTAL_RADIUS = 3.8;
const GROUND_RADIUS = 160;
const GROUND_SEGMENTS = 64;
const MIN_PLOT_HALF = 16;
const ENTRANCE_OFFSET = 3;
const PEER_SMOOTH_RATE = 10; // lissage exponentiel de l'interpolation des pairs

type Mode = "cemetery" | "hub";

/** Pair distant : son avatar et la cible vers laquelle on interpole. */
type Peer = { avatar: Avatar; tx: number; ty: number; tz: number; try_: number };

/** Orchestrateur de la scène 3D : assemble ciel, lumières, décor, contrôles, tombes,
 *  le hub de cimetières (#5) et la présence des autres visiteurs (#4). */
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
  private readonly hubGroup = new THREE.Group();
  private readonly peersGroup = new THREE.Group();

  private mode: Mode = "cemetery";
  private detail: CompanyDetail | null = null;
  private ambiance: Ambiance;
  private timeSetting: TimeSetting = "auto";
  private seasonSetting: SeasonSetting = "auto";
  /** Karma du cimetière courant, pour le thème Paradis/Enfer (issue #3). */
  private karma = 0;
  private plotHalf = MIN_PLOT_HALF;
  private running = false;

  private focusCb: (c: Colleague | null) => void = () => {};
  private focused: Colleague | null = null;

  // Hub (#5).
  private portals: Portal[] = [];
  private nearPortal: Portal | null = null;
  private portalCb: (p: Portal | null) => void = () => {};
  private enterPortalCb: (company: Company) => void = () => {};

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
    this.scene.add(this.gravesGroup, this.decor.group, this.hubGroup, this.peersGroup);
    this.buildGround();

    this.controls = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.scene.add(this.controls.object);
    this.controls.placeAt(0, this.plotHalf - ENTRANCE_OFFSET);

    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("keydown", this.onActionKey);
    this.renderer.setAnimationLoop(this.loop);
  }

  onFocusChange(cb: (c: Colleague | null) => void) {
    this.focusCb = cb;
  }

  onLockChange(cb: (locked: boolean) => void) {
    this.controls.onLockChange(cb);
  }

  onPortalChange(cb: (p: Portal | null) => void) {
    this.portalCb = cb;
  }

  onEnterPortal(cb: (company: Company) => void) {
    this.enterPortalCb = cb;
  }

  onVisitorCount(cb: (n: number) => void) {
    this.countCb = cb;
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

  setCemetery(detail: CompanyDetail) {
    this.mode = "cemetery";
    this.clearHub();
    this.detail = detail;
    this.karma = detail.karma;
    // Recalcule l'ambiance avec le thème karma avant de construire les tombes.
    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);
    this.layoutGraves(); // reconstruit tombes + décor avec le bon plotHalf
    this.controls.setBound(this.plotHalf);
    this.controls.placeAt(0, this.plotHalf - ENTRANCE_OFFSET);
    this.connectRoom(`cem:${detail.company.id}`);
  }

  /** Entre dans le hub : route + portails de tous les cimetières (issue #5). */
  enterHub(companies: Company[]) {
    this.mode = "hub";
    this.karma = 0;
    this.detail = null;
    this.gravesGroup.clear();
    this.clearHub();

    const hub = buildHub(companies);
    this.portals = hub.portals;
    this.hubGroup.add(hub.group);
    this.plotHalf = Math.max(hub.bounds.maxX - hub.bounds.minX, hub.bounds.maxZ - hub.bounds.minZ);
    this.controls.setBoundsRect(hub.bounds);
    this.controls.placeAt(hub.start.x, hub.start.z);
    // Rafraîchit l'ambiance (sans thème karma dans le hub).
    this.ambiance = this.resolveAmbiance();
    this.applyAmbiance(this.ambiance);
    this.connectRoom("hub");
  }

  addColleague(colleague: Colleague) {
    if (!this.detail) return;
    this.detail.colleagues.push(colleague);
    this.layoutGraves();
  }

  updateColleague(colleague: Colleague) {
    if (!this.detail) return;
    const idx = this.detail.colleagues.findIndex((c) => c.id === colleague.id);
    if (idx >= 0) this.detail.colleagues[idx] = colleague;
    this.layoutGraves();
  }

  setAmbianceSettings(time: TimeSetting, season: SeasonSetting) {
    this.timeSetting = time;
    this.seasonSetting = season;
    const next = this.resolveAmbiance();
    // La teinte de base des pierres dépend de la saison → on reconstruit les
    // tombes quand elle change (les 3 axes #25 sont recalculés au passage).
    const graveColorChanged = next.graveColor !== this.ambiance.graveColor;
    this.ambiance = next;
    this.applyAmbiance(next);
    if (graveColorChanged && this.mode === "cemetery") this.layoutGraves();
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
    const base = getAmbiance(timeKey, seasonKey);
    // Thème karma uniquement en mode cimetière (issue #3).
    return this.mode === "cemetery" ? applyKarmaTheme(base, this.karma) : base;
  }

  private applyAmbiance(a: Ambiance) {
    this.sky.setColors(a.skyTop, a.skyBottom);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(a.fogColor);
    fog.density = a.fogDensity;
    this.lighting.apply(a);
    this.groundMat.color.setHex(a.groundColor);
    // Enceinte/arbres seulement en cimetière ; le hub ne garde que les particules.
    this.decor.build(a, this.plotHalf, { structures: this.mode === "cemetery" });
  }

  private layoutGraves() {
    this.gravesGroup.clear();
    if (!this.detail) return;
    const list = this.detail.colleagues;

    // Plan procédural déterministe, seedé sur l'id de l'organisation (issue #5).
    const layout = cemeteryLayout(this.detail.company.id, list.length);
    this.plotHalf = layout.plotHalf;
    this.controls.setBound(this.plotHalf);
    const now = Date.now();

    list.forEach((colleague, i) => {
      const place = layout.placements[i];
      // Combine les 3 axes visuels indépendants de la tombe (issue #25).
      const grave = createGrave(colleague, this.ambiance.graveColor, graveAxes(colleague, now));
      grave.position.set(place.x, 0, place.z);
      grave.rotation.y += place.rotY;
      this.gravesGroup.add(grave);
    });

    this.decor.build(this.ambiance, this.plotHalf);
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
    disposeGroup(peer.avatar.group);
    this.peers.delete(id);
  }

  private clearPeers() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }

  private clearHub() {
    disposeGroup(this.hubGroup);
    this.portals = [];
    this.setPortal(null);
  }

  // ---- Boucle ----

  private updateFocus() {
    if (this.mode === "hub") {
      this.updatePortalFocus();
      return;
    }
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

  private updatePortalFocus() {
    const cam = this.camera.position;
    let nearest: Portal | null = null;
    let best = PORTAL_RADIUS;
    for (const portal of this.portals) {
      const d = Math.hypot(portal.x - cam.x, portal.z - cam.z);
      if (d < best) {
        best = d;
        nearest = portal;
      }
    }
    this.setPortal(nearest);
  }

  private setPortal(p: Portal | null) {
    if (p !== this.nearPortal) {
      this.nearPortal = p;
      this.portalCb(p);
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
      this.publishPresence();
    }
    this.updatePeers(dt);
    this.decor.update(dt, this.clock.elapsedTime);
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private onActionKey = (e: KeyboardEvent) => {
    if (e.type !== "keydown" || !this.controls.isLocked) return;
    if (e.code === "KeyE" && this.mode === "hub" && this.nearPortal) {
      this.enterPortalCb(this.nearPortal.company); // entrer dans un cimetière (#5)
    } else if (e.code === "KeyF") {
      this.emote("wave"); // emote « saluer » synchronisée (#4)
    }
  };
}

/** Libère géométries ET matériaux/textures d'un groupe avant de le vider. */
function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
  group.clear();
}
