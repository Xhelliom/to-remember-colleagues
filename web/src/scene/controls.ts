import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

export const EYE_HEIGHT = 1.7;
/** Vitesse de rattrapage de la hauteur du sol (1/s) — au-dessus, ça tressaute. */
const GROUND_FOLLOW_RATE = 12;
const WALK_SPEED = 4.2;
const RUN_SPEED = 8.0;
const ACCELERATION = 8;
const DAMPING_RATE = 12;
const BOUND_MARGIN = 1.2;
const FREEFLIGHT_SPEED_MULT = 4;      // multiplicateur XZ en mode freeflight (DEV)
const FREEFLIGHT_VERT_SPEED = WALK_SPEED * 6; // vitesse verticale fixe (Espace/C)

type MoveState = { forward: boolean; backward: boolean; left: boolean; right: boolean; run: boolean };

/** Mappe un code touche (AZERTY + QWERTY + flèches) vers une direction de déplacement. */
function keyToMove(code: string): keyof MoveState | null {
  switch (code) {
    case "KeyW":
    case "KeyZ":
    case "ArrowUp":
      return "forward";
    case "KeyS":
    case "ArrowDown":
      return "backward";
    case "KeyA":
    case "KeyQ":
    case "ArrowLeft":
      return "left";
    case "KeyD":
    case "ArrowRight":
      return "right";
    case "ShiftLeft":
    case "ShiftRight":
      return "run";
    default:
      return null;
  }
}

/** Contrôles première personne : souris (PointerLock) + clavier, confinés à la parcelle. */
export class FirstPersonControls {
  readonly pointer: PointerLockControls;
  private readonly move: MoveState = { forward: false, backward: false, left: false, right: false, run: false };
  private readonly velocity = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private bound = 20;
  // Bornes rectangulaires (route du hub) ; null → bornes carrées ±bound (parcelle).
  private boundsRect: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  /** Hauteur du sol sous la caméra ; plate tant que `setGroundHeight` n'a pas été appelée. */
  private groundAt: (x: number, z: number) => number = () => 0;
  // DEV uniquement — caméra libre sans contraintes de sol ni de bounds.
  private freeflight = false;
  private freeUp = false;
  private freeDown = false;

  constructor(camera: THREE.Camera, dom: HTMLElement) {
    this.pointer = new PointerLockControls(camera, dom);
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("keyup", this.onKey);
  }

  get object() {
    return this.pointer.object;
  }

  get isLocked() {
    return this.pointer.isLocked;
  }

  onLockChange(cb: (locked: boolean) => void) {
    this.pointer.addEventListener("lock", () => cb(true));
    this.pointer.addEventListener("unlock", () => cb(false));
  }

  lock() {
    this.pointer.lock();
  }

  unlock() {
    this.pointer.unlock();
  }

  /** Active/désactive la caméra libre (DEV uniquement). */
  toggleFreeflight() {
    this.freeflight = !this.freeflight;
  }

  get isFreeflightMode() {
    return this.freeflight;
  }

  setBound(plotHalf: number) {
    this.bound = plotHalf - BOUND_MARGIN;
    this.boundsRect = null;
  }

  /** Confine le déplacement à un rectangle (route du hub, issue #5). */
  setBoundsRect(rect: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.boundsRect = rect;
  }

  placeAt(x: number, z: number) {
    this.object.position.set(x, this.groundAt(x, z) + EYE_HEIGHT, z);
    this.velocity.set(0, 0, 0);
  }

  /** Branche le relief : la caméra colle au sol au lieu de flotter à hauteur
   *  fixe. Sans cette source, tout reste plat (comportement d'origine). */
  setGroundHeight(fn: (x: number, z: number) => number) {
    this.groundAt = fn;
  }

  update(dt: number) {
    if (!this.pointer.isLocked) {
      this.velocity.set(0, 0, 0);
      return;
    }
    const isFree = import.meta.env.DEV && this.freeflight;
    const speed = (this.move.run ? RUN_SPEED : WALK_SPEED) * (isFree ? FREEFLIGHT_SPEED_MULT : 1);
    const damping = Math.exp(-DAMPING_RATE * dt);
    this.velocity.x *= damping;
    this.velocity.z *= damping;

    this.direction.z = Number(this.move.forward) - Number(this.move.backward);
    this.direction.x = Number(this.move.right) - Number(this.move.left);
    this.direction.normalize();

    if (this.move.forward || this.move.backward) this.velocity.z -= this.direction.z * speed * dt * ACCELERATION;
    if (this.move.left || this.move.right) this.velocity.x -= this.direction.x * speed * dt * ACCELERATION;

    this.pointer.moveRight(-this.velocity.x * dt);
    this.pointer.moveForward(-this.velocity.z * dt);

    const p = this.object.position;
    if (isFree) {
      const dy = (Number(this.freeUp) - Number(this.freeDown)) * FREEFLIGHT_VERT_SPEED * dt;
      p.y = Math.max(0.1, p.y + dy);
    } else {
      const r = this.boundsRect;
      if (r) {
        p.x = THREE.MathUtils.clamp(p.x, r.minX, r.maxX);
        p.z = THREE.MathUtils.clamp(p.z, r.minZ, r.maxZ);
      } else {
        p.x = THREE.MathUtils.clamp(p.x, -this.bound, this.bound);
        p.z = THREE.MathUtils.clamp(p.z, -this.bound, this.bound);
      }
      // Lissage vertical : le sol peut sauter d'un palier au chargement d'une
      // tranche, ou quand on franchit un talus — sans amortissement, la caméra
      // tressaute. La montée reste rapide pour ne jamais s'enfoncer longtemps.
      const target = this.groundAt(p.x, p.z) + EYE_HEIGHT;
      p.y += (target - p.y) * Math.min(1, GROUND_FOLLOW_RATE * dt);
    }
  }

  dispose() {
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("keyup", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    const action = keyToMove(e.code);
    if (action) this.move[action] = e.type === "keydown";
    if (import.meta.env.DEV) {
      if (e.code === "Space") this.freeUp = e.type === "keydown";
      if (e.code === "KeyC") this.freeDown = e.type === "keydown";
    }
  };
}
