// Relief procédural déterministe (FBM 3 octaves, amplitude 2m). terrainHeightAt
// est INVARIANTE à la taille du cimetière : un point (seed, x, z) monde donné
// renvoie toujours la même hauteur, quelle que soit la longueur du chemin au
// moment du calcul — prérequis du chunking intra-cimetière (phase 0 du plan).
// Un `TerrainChunk` couvre une TRANCHE [zStart, zEnd[ du couloir (phase 3) :
// le fondu de bordure ne s'applique qu'aux vrais bords extérieurs (largeur du
// couloir, entrée, fond), jamais aux jointures internes entre tranches.
import * as THREE from "three";
import { seededRandom } from "../graves.ts";
import { hashSeed } from "../procedural.ts";
import { toLocal, toWorld, type Frame } from "../worldLayout.ts";

const CELL_SIZE = 1.5;    // taille de maille du terrain (m) — indépendante de la taille du chunk
const AMPLITUDE = 2.0;    // amplitude max en mètres
const BASE_FREQ = 0.05;   // fréquence de base en coordonnées MONDE (doux, pas montagne)
const FADE_WIDTH = 4;     // mètres de fondu vers 0 en bordure réelle

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

// Une seule table de gradients par graine (un cimetière = une seed, pas par chunk).
const fbmCache = new Map<number, (x: number, y: number) => number>();
function getFbm(seed: number): (x: number, y: number) => number {
  let fbm = fbmCache.get(seed);
  if (!fbm) {
    fbm = makeFbm(seed);
    fbmCache.set(seed, fbm);
  }
  return fbm;
}

/**
 * Hauteur FBM brute en un point MONDE (x, z) — fonction pure, indépendante de
 * la taille ou du découpage en chunks du cimetière (invariance, phase 0).
 */
export function terrainHeightAt(seed: number, worldX: number, worldZ: number): number {
  return getFbm(seed)(worldX * BASE_FREQ, worldZ * BASE_FREQ) * AMPLITUDE;
}

/**
 * Fondu 1 (intérieur) → 0 (bord réel : mur latéral, entrée ou fond du chemin).
 * Ne dépend que des dimensions GLOBALES du cimetière, jamais des bornes d'un
 * chunk particulier → aucune couture aux jointures internes (0.3).
 */
function borderFade(localX: number, localZ: number, halfWidth: number, plotDepth: number): number {
  const edgeDist = Math.min(halfWidth - Math.abs(localX), localZ, plotDepth - localZ);
  return Math.max(0, Math.min(1, edgeDist / FADE_WIDTH));
}

/** Terrain procédural d'une tranche [zStart, zEnd[ du couloir d'un cimetière. */
export class TerrainChunk {
  readonly mesh: THREE.Mesh;
  private readonly seed: number;
  private readonly frame: Frame;
  private readonly halfWidth: number;
  private readonly plotDepth: number;
  private readonly zStart: number;
  private readonly zEnd: number;

  constructor(
    companyId: string,
    frame: Frame,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    mat: THREE.Material,
  ) {
    this.seed = hashSeed(companyId + ":terrain");
    this.frame = frame;
    this.halfWidth = plotWidth / 2;
    this.plotDepth = plotDepth;
    this.zStart = zStart;
    this.zEnd = zEnd;

    const depth = zEnd - zStart;
    const zMid = (zStart + zEnd) / 2;
    const segX = Math.max(1, Math.round(plotWidth / CELL_SIZE));
    const segZ = Math.max(1, Math.round(depth / CELL_SIZE));
    const geo = new THREE.PlaneGeometry(plotWidth, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let iz = 0; iz <= segZ; iz++) {
      for (let ix = 0; ix <= segX; ix++) {
        const meshLocalX = (ix / segX - 0.5) * plotWidth;
        const meshLocalZ = (iz / segZ - 0.5) * depth;
        const h = this.heightAtLocal(meshLocalX, meshLocalZ + zMid);
        pos.setY(iz * (segX + 1) + ix, h);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.mesh = new THREE.Mesh(geo, mat);
    const center = toWorld(frame, 0, zMid);
    this.mesh.position.set(center.x, 0, center.z);
    this.mesh.rotation.y = frame.rotY;
    this.mesh.receiveShadow = true;
  }

  private heightAtLocal(localX: number, localZ: number): number {
    const world = toWorld(this.frame, localX, localZ);
    return terrainHeightAt(this.seed, world.x, world.z) * borderFade(localX, localZ, this.halfWidth, this.plotDepth);
  }

  /** Hauteur exacte (FBM + fondu de bordure) en coordonnées monde ; 0 hors de cette tranche. */
  getHeightAt(wx: number, wz: number): number {
    const local = toLocal(this.frame, { x: wx, z: wz });
    if (Math.abs(local.x) > this.halfWidth || local.z < this.zStart || local.z > this.zEnd) return 0;
    return this.heightAtLocal(local.x, local.z);
  }

  dispose() {
    this.mesh.geometry.dispose();
    // Le matériau est partagé (géré par cemetery.ts) → pas de dispose ici
  }
}
