// Relief procédural déterministe d'une parcelle (FBM 3 octaves, amplitude 0.8m).
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";

const GRID = 64;        // résolution de la grille heightmap
const AMPLITUDE = 2.0;  // amplitude max en mètres
const BASE_FREQ = 0.12; // fréquence de base (doux, pas montagne)

/** FBM 3 octaves avec gradient Perlin simplifié (table de permutation seedée). */
function makeFbm(seed: number) {
  const rand = seededRandom(seed);
  // Table de 256 gradients 2D pseudo-aléatoires
  const grads: [number, number][] = Array.from({ length: 256 }, () => {
    const a = rand() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  });
  const perm = Array.from({ length: 512 }, (_, i) => i & 255);
  // Mélange de Fisher-Yates seedé
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
    perm[i + 256] = perm[i];
    perm[j + 256] = perm[j];
  }

  function dot(gx: number, gy: number, dx: number, dy: number) {
    const g = grads[perm[(gx & 255) + perm[gy & 255]]];
    return g[0] * dx + g[1] * dy;
  }
  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a: number, b: number, t: number) { return a + t * (b - a); }

  function perlin(x: number, y: number): number {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = x - xi;        const yf = y - yi;
    const u = fade(xf);       const v = fade(yf);
    return lerp(
      lerp(dot(xi, yi, xf, yf), dot(xi + 1, yi, xf - 1, yf), u),
      lerp(dot(xi, yi + 1, xf, yf - 1), dot(xi + 1, yi + 1, xf - 1, yf - 1), u),
      v,
    );
  }

  return (x: number, y: number): number => {
    let v = 0, amp = 1, freq = 1, max = 0;
    for (let o = 0; o < 3; o++) {
      v   += perlin(x * freq, y * freq) * amp;
      max += amp;
      amp *= 0.5; freq *= 2;
    }
    return v / max; // [-1, 1]
  };
}

/** Terrain procédural d'une parcelle cimetière. */
export class TerrainChunk {
  readonly mesh: THREE.Mesh;
  private readonly heights: Float32Array; // GRID×GRID valeurs Y
  private readonly plotHalf: number;
  private readonly center: { x: number; z: number };

  constructor(
    companyId: string,
    plotHalf: number,
    plotCenter: { x: number; z: number },
    mat: THREE.Material,
  ) {
    this.plotHalf = plotHalf;
    this.center = plotCenter;

    const fbm = makeFbm(hashSeed(companyId + ":terrain"));
    const size = plotHalf * 2;
    const geo = new THREE.PlaneGeometry(size, size, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    this.heights = new Float32Array(GRID * GRID);

    for (let iz = 0; iz < GRID; iz++) {
      for (let ix = 0; ix < GRID; ix++) {
        const fx = (ix / (GRID - 1) - 0.5) * 2; // [-1, 1]
        const fz = (iz / (GRID - 1) - 0.5) * 2;
        // Fondu vers 0 en bordure pour ne pas déformer sous les murs d'enceinte
        const border = Math.max(0, 1 - Math.max(Math.abs(fx), Math.abs(fz)) / 0.85);
        const h = fbm(fx * BASE_FREQ * size, fz * BASE_FREQ * size) * AMPLITUDE * border;
        const idx = iz * GRID + ix;
        this.heights[idx] = h;
        pos.setY(idx, h);
      }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(plotCenter.x, 0, plotCenter.z);
    this.mesh.receiveShadow = true;
  }

  /** Hauteur interpolée bilinéaire en coordonnées monde. */
  getHeightAt(wx: number, wz: number): number {
    const lx = wx - this.center.x;
    const lz = wz - this.center.z;
    const half = this.plotHalf;
    // Hors de la parcelle → sol plat
    if (Math.abs(lx) > half || Math.abs(lz) > half) return 0;

    const u = (lx / half + 1) / 2 * (GRID - 1); // [0, GRID-1]
    const v = (lz / half + 1) / 2 * (GRID - 1);
    const x0 = Math.floor(u); const x1 = Math.min(x0 + 1, GRID - 1);
    const z0 = Math.floor(v); const z1 = Math.min(z0 + 1, GRID - 1);
    const tx = u - x0; const tz = v - z0;

    const h00 = this.heights[z0 * GRID + x0];
    const h10 = this.heights[z0 * GRID + x1];
    const h01 = this.heights[z1 * GRID + x0];
    const h11 = this.heights[z1 * GRID + x1];
    return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz)
         + h01 * (1 - tx) * tz        + h11 * tx * tz;
  }

  dispose() {
    this.mesh.geometry.dispose();
    // Le matériau est partagé (géré par cemetery.ts) → pas de dispose ici
  }
}
