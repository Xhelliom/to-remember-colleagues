import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

export const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.2;
const RUN_SPEED = 8.0;
const ACCELERATION = 8;
const DAMPING_RATE = 12;
const BOUND_MARGIN = 1.2;

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

  setBound(plotHalf: number) {
    this.bound = plotHalf - BOUND_MARGIN;
  }

  placeAt(x: number, z: number) {
    this.object.position.set(x, EYE_HEIGHT, z);
    this.velocity.set(0, 0, 0);
  }

  update(dt: number) {
    if (!this.pointer.isLocked) {
      this.velocity.set(0, 0, 0);
      return;
    }
    const speed = this.move.run ? RUN_SPEED : WALK_SPEED;
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
    p.x = THREE.MathUtils.clamp(p.x, -this.bound, this.bound);
    p.z = THREE.MathUtils.clamp(p.z, -this.bound, this.bound);
    p.y = EYE_HEIGHT;
  }

  dispose() {
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("keyup", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    const action = keyToMove(e.code);
    if (action) this.move[action] = e.type === "keydown";
  };
}
