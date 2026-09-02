// Particules météo de la scène (neige, feuilles, pollen, braises, pluie) —
// nuage de points recyclé en boucle autour du joueur.
//
// Ce module portait aussi une enceinte, des arbres, une allée et des props
// Halloween : du code mort, les deux seuls appels passant `structures: false`.
// L'enceinte réelle vit dans scene/fence.ts, les arbres dans scene/trees/.
import * as THREE from "three";
import type { Ambiance, ParticleKind } from "../ambiance.ts";

const PARTICLE_CEILING = 26;
const PARTICLE_SPAWN_HEIGHT = 24;

const PARTICLE_COLORS: Record<Exclude<ParticleKind, "none">, number> = {
  snow: 0xffffff,
  leaves: 0xc06a2a,
  pollen: 0xeae28a,
  embers: 0xff8a3c,
  rain: 0x9ab8d0,
};

type ParticleState = { kind: ParticleKind; velocities: Float32Array; bounds: number };

/** Nuage de particules météo, reconstruit à chaque changement d'ambiance. */
export class WeatherParticles {
  readonly group = new THREE.Group();
  private particles: THREE.Points | null = null;
  private particleState: ParticleState | null = null;

  /** Reconstruit les particules pour une ambiance et un rayon d'émission donnés. */
  build(a: Ambiance, halfExtent: number) {
    this.clear();
    this.buildParticles(a, halfExtent);
  }

  update(dt: number, elapsed: number) {
    this.updateParticles(dt, elapsed);
  }

  private clear() {
    if (this.particles) {
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    this.group.clear();
    this.particles = null;
    this.particleState = null;
  }

  private buildParticles(a: Ambiance, half: number) {
    if (a.particles === "none") return;
    const count = a.particles === "snow" ? 1200 : a.particles === "embers" ? 500 : 700;
    const bounds = half + 6;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * bounds * 2;
      positions[i * 3 + 1] = Math.random() * PARTICLE_SPAWN_HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * bounds * 2;
      velocities[i * 3] = (Math.random() - 0.5) * 0.4;
      velocities[i * 3 + 1] = -0.2 - Math.random() * 0.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: PARTICLE_COLORS[a.particles],
      size: a.particles === "snow" ? 0.18 : a.particles === "embers" ? 0.12 : 0.22,
      transparent: true,
      opacity: a.particles === "pollen" ? 0.6 : 0.85,
      depthWrite: false,
    });
    this.particles = new THREE.Points(geo, mat);
    this.particleState = { kind: a.particles, velocities, bounds };
    this.group.add(this.particles);
  }

  private updateParticles(dt: number, t: number) {
    if (!this.particles || !this.particleState) return;
    const { kind, velocities, bounds } = this.particleState;
    const pos = this.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      if (kind === "embers") {
        arr[i + 1] += (0.6 + velocities[i + 1] * -0.4) * dt;
        arr[i] += Math.sin(t + i) * 0.01;
      } else {
        arr[i] += velocities[i] * dt + Math.sin(t + i) * (kind === "leaves" ? 0.02 : 0.005);
        arr[i + 1] += velocities[i + 1] * dt;
        arr[i + 2] += velocities[i + 2] * dt;
      }
      if (arr[i + 1] < 0 || arr[i + 1] > PARTICLE_CEILING) {
        arr[i] = (Math.random() - 0.5) * bounds * 2;
        arr[i + 1] = kind === "embers" ? 0 : PARTICLE_SPAWN_HEIGHT;
        arr[i + 2] = (Math.random() - 0.5) * bounds * 2;
      }
    }
    pos.needsUpdate = true;
  }
}
