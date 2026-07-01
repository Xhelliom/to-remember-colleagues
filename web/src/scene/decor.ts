import * as THREE from "three";
import type { Ambiance, ParticleKind } from "../ambiance.ts";
import { seededRandom } from "../graves.ts";

const FENCE_POST_STEP = 1.4;
const FENCE_POST_HEIGHT = 1.8;
const FENCE_RAIL_HEIGHT = 1.4;
const TREE_COUNT = 10;
const PUMPKIN_COUNT = 7;
const BAT_COUNT = 8;
const PARTICLE_CEILING = 26;
const PARTICLE_SPAWN_HEIGHT = 24;
const FLICKER_SPEED = 12;
const BAT_FLAP_SPEED = 18;

const PARTICLE_COLORS: Record<Exclude<ParticleKind, "none">, number> = {
  snow: 0xffffff,
  leaves: 0xc06a2a,
  pollen: 0xeae28a,
  embers: 0xff8a3c,
  rain: 0x9ab8d0,
};

type ParticleState = { kind: ParticleKind; velocities: Float32Array; bounds: number };

/** Décor du cimetière : enceinte, arbres, allée, accessoires Halloween et particules. */
export class Decor {
  readonly group = new THREE.Group();
  private particles: THREE.Points | null = null;
  private particleState: ParticleState | null = null;
  private flickerLights: THREE.PointLight[] = [];
  private bats: THREE.Mesh[] = [];

  /**
   * Reconstruit le décor pour une ambiance et une taille de parcelle données.
   * `structures: false` ne pose que les particules (utilisé par le hub, qui n'a
   * ni enceinte ni allée de cimetière).
   */
  build(a: Ambiance, plotHalf: number, { structures = true }: { structures?: boolean } = {}) {
    this.clear();
    if (structures) {
      this.buildFence(a, plotHalf);
      this.buildTrees(a, plotHalf);
      this.buildPath(plotHalf);
      if (a.scary) this.buildHalloweenProps(plotHalf);
    }
    this.buildParticles(a, plotHalf);
  }

  update(dt: number, elapsed: number) {
    this.updateParticles(dt, elapsed);
    this.updateHalloween(elapsed);
  }

  private clear() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.group.clear();
    this.particles = null;
    this.particleState = null;
    this.flickerLights = [];
    this.bats = [];
  }

  private buildFence(a: Ambiance, half: number) {
    this.group.add(makeFence(half, a.scary));
  }

  private buildTrees(a: Ambiance, half: number) {
    const rand = seededRandom(1234);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: a.foliageColor, roughness: 1 });
    const bare = a.scary || a.seasonKey === "winter";
    for (let i = 0; i < TREE_COUNT; i++) {
      const tree = makeTree(trunkMat, foliageMat, bare, rand);
      const angle = rand() * Math.PI * 2;
      const dist = half - 1.5 - rand() * 2;
      tree.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      this.group.add(tree);
    }
  }

  private buildPath(half: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 1 });
    const path = new THREE.Mesh(new THREE.PlaneGeometry(2.2, half * 2), mat);
    path.rotation.x = -Math.PI / 2;
    path.rotation.z = Math.PI / 2;
    path.position.set(half - 2.2, 0.02, 0);
    path.receiveShadow = true;
    this.group.add(path);
  }

  private buildHalloweenProps(half: number) {
    const rand = seededRandom(666);
    const pumpkinMat = new THREE.MeshStandardMaterial({
      color: 0xd2691e,
      emissive: 0xff7518,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    for (let i = 0; i < PUMPKIN_COUNT; i++) {
      const pumpkin = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), pumpkinMat);
      pumpkin.scale.y = 0.8;
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (half - 4);
      pumpkin.position.set(Math.cos(angle) * dist, 0.35, Math.sin(angle) * dist);
      this.group.add(pumpkin);

      const light = new THREE.PointLight(0xff7518, 2.2, 9, 2);
      light.position.copy(pumpkin.position).add(new THREE.Vector3(0, 0.4, 0));
      light.userData.base = 2.2;
      light.userData.phase = rand() * Math.PI * 2;
      this.group.add(light);
      this.flickerLights.push(light);
    }

    const batMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0f, side: THREE.DoubleSide });
    for (let i = 0; i < BAT_COUNT; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.4, 0, 0, 0, 0.12, 0, 0.4, 0, 0], 3));
      const bat = new THREE.Mesh(geo, batMat);
      bat.userData.radius = 4 + rand() * 8;
      bat.userData.speed = 0.4 + rand() * 0.6;
      bat.userData.phase = rand() * Math.PI * 2;
      bat.userData.height = 5 + rand() * 4;
      this.group.add(bat);
      this.bats.push(bat);
    }
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

  private updateHalloween(t: number) {
    for (const light of this.flickerLights) {
      const base = light.userData.base as number;
      const phase = light.userData.phase as number;
      light.intensity = base * (0.7 + Math.sin(t * FLICKER_SPEED + phase) * 0.15 + Math.random() * 0.15);
    }
    for (const bat of this.bats) {
      const r = bat.userData.radius as number;
      const phase = bat.userData.phase as number;
      const angle = t * (bat.userData.speed as number) + phase;
      bat.position.set(Math.cos(angle) * r, (bat.userData.height as number) + Math.sin(t * 2 + phase), Math.sin(angle) * r);
      bat.rotation.y = -angle;
      bat.scale.y = 1 + Math.sin(t * BAT_FLAP_SPEED + phase) * 0.6;
    }
  }
}

/** Côté d'une parcelle (repère local) ; sert à laisser l'enceinte ouverte côté route. */
export type FenceSide = "+x" | "-x" | "+z" | "-z";

/**
 * Enceinte carrée (grille) d'une parcelle de demi-côté `half`. `open` omet un
 * côté pour ménager l'entrée (sous l'arche, côté route dans le monde continu).
 */
export function makeFence(half: number, scary: boolean, open?: FenceSide): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: scary ? 0x1a1a1f : 0x2b2b30,
    roughness: 0.7,
    metalness: 0.4,
  });
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, FENCE_POST_HEIGHT, 6);
  const sides: Array<[number, number, number, number, FenceSide]> = [
    [-half, half, -half, -half, "-z"],
    [-half, half, half, half, "+z"],
    [-half, -half, -half, half, "-x"],
    [half, half, -half, half, "+x"],
  ];
  for (const [x1, x2, z1, z2, side] of sides) {
    if (side === open) continue;
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.floor(len / FENCE_POST_STEP);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const post = new THREE.Mesh(postGeo, mat);
      post.position.set(x1 + (x2 - x1) * t, FENCE_POST_HEIGHT / 2, z1 + (z2 - z1) * t);
      post.castShadow = true;
      g.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), mat);
    rail.position.set((x1 + x2) / 2, FENCE_RAIL_HEIGHT, (z1 + z2) / 2);
    if (Math.abs(z2 - z1) > Math.abs(x2 - x1)) rail.rotation.y = Math.PI / 2;
    g.add(rail);
  }
  return g;
}

/** Un arbre (tronc + couronne) ; réutilisé par le décor du cimetière et la forêt du monde. */
export function makeTree(
  trunkMat: THREE.Material,
  foliageMat: THREE.Material,
  bare: boolean,
  rand: () => number,
): THREE.Group {
  const tree = new THREE.Group();
  const h = 2.5 + rand() * 2;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, h, 6), trunkMat);
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  tree.add(trunk);
  tree.add(bare ? makeBareCrown(trunkMat, h, rand) : makeFoliage(foliageMat, h, rand));
  return tree;
}

function makeFoliage(mat: THREE.Material, trunkHeight: number, rand: () => number): THREE.Mesh {
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2 + rand() * 0.6, 0), mat);
  foliage.position.y = trunkHeight + 0.4;
  foliage.castShadow = true;
  return foliage;
}

function makeBareCrown(mat: THREE.Material, trunkHeight: number, rand: () => number): THREE.Group {
  const crown = new THREE.Group();
  for (let b = 0; b < 4; b++) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 1.2, 5), mat);
    branch.position.y = trunkHeight * 0.8;
    branch.rotation.z = (rand() - 0.5) * 1.6;
    branch.rotation.x = (rand() - 0.5) * 1.6;
    crown.add(branch);
  }
  return crown;
}
