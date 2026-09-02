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
import { distanceToPath, type PathSegment } from "../procedural.ts";
import { pondDepth, pondRelief, type Pond } from "./pond.ts";
import { toLocal, toWorld, type Frame } from "../worldLayout.ts";
import { disposeObject } from "./disposeObject.ts";

const CELL_SIZE = 1.5;    // taille de maille du terrain (m) — indépendante de la taille du chunk
const AMPLITUDE = 4.5;    // amplitude max en mètres
const BASE_FREQ = 0.05;   // fréquence de base en coordonnées MONDE (doux, pas montagne)
const FADE_WIDTH = 4;     // mètres de fondu vers 0 en bordure réelle

// --- Terrasses : le FBM seul donne des collines molles, sans ligne de force.
// Quantifier la hauteur en paliers séparés par des talus courts produit des
// mini-falaises — des ruptures que l'œil accroche, et de l'ombre portée. ---
const TERRACE_STEP = 1.6;      // m — dénivelé d'un palier
/** Fraction du palier consacrée au talus : bas = falaise franche, haut = pente molle. */
const TERRACE_SHARPNESS = 0.3;

// --- Chemin en creux : l'allée et ses bras restent plats et le relief monte
// de part et d'autre. Le visiteur marche dans un vallon, pas sur une bosse. ---
const PATH_FLAT_HALF = 2.2;  // m — largeur strictement plate autour de l'axe
const PATH_FLAT_FADE = 6;    // m — remontée progressive vers le relief plein
/** Marge en Z pour ne retenir que les segments de chemin utiles à une tranche. */
const PATH_SEGMENT_MARGIN = 12;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Quantifie une hauteur en paliers séparés par des talus raides.
 * Pure et monotone : deux points voisins ne peuvent pas s'inverser, donc pas
 * de repli du maillage.
 */
export function terraceHeight(h: number, step = TERRACE_STEP, sharpness = TERRACE_SHARPNESS): number {
  const t = h / step;
  const base = Math.floor(t);
  const frac = t - base;
  return (base + smoothstep(0.5 - sharpness / 2, 0.5 + sharpness / 2, frac)) * step;
}

/** [0,1] — 0 sur le chemin (sol plat imposé), 1 au-delà de la zone de remontée. */
export function pathRelief(distance: number): number {
  return smoothstep(PATH_FLAT_HALF, PATH_FLAT_HALF + PATH_FLAT_FADE, distance);
}

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
  private readonly halfWidth: number;   // demi-largeur du MAILLAGE (portée du chunk)
  private readonly fadeHalf: number;    // demi-largeur du fondu de bordure (globale, invariante entre chunks)
  private readonly plotDepth: number;
  private readonly zStart: number;
  private readonly zEnd: number;
  /** Segments de chemin pouvant influencer cette tranche (les autres sont trop
   *  loin pour peser) — la hauteur est échantillonnée des milliers de fois par
   *  chunk, tester tout le cimetière à chaque appel serait ruineux. */
  private readonly nearbyPath: PathSegment[];
  /** Étangs du cimetière : ils creusent le terrain et aplanissent leurs abords. */
  private readonly ponds: readonly Pond[];

  constructor(
    companyId: string,
    frame: Frame,
    chunkWidth: number,
    plotWidth: number,
    plotDepth: number,
    zStart: number,
    zEnd: number,
    mat: THREE.Material,
    pathSegments: readonly PathSegment[] = [],
    ponds: readonly Pond[] = [],
  ) {
    this.seed = hashSeed(companyId + ":terrain");
    this.frame = frame;
    this.halfWidth = chunkWidth / 2;
    this.fadeHalf = plotWidth / 2;
    this.plotDepth = plotDepth;
    this.zStart = zStart;
    this.zEnd = zEnd;
    this.nearbyPath = pathSegments.filter(
      (p) => Math.max(p.z0, p.z1) >= zStart - PATH_SEGMENT_MARGIN && Math.min(p.z0, p.z1) <= zEnd + PATH_SEGMENT_MARGIN,
    );

    this.ponds = ponds;

    const depth = zEnd - zStart;
    const zMid = (zStart + zEnd) / 2;
    const segX = Math.max(1, Math.round(chunkWidth / CELL_SIZE));
    const segZ = Math.max(1, Math.round(depth / CELL_SIZE));
    const geo = new THREE.PlaneGeometry(chunkWidth, depth, segX, segZ);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let iz = 0; iz <= segZ; iz++) {
      for (let ix = 0; ix <= segX; ix++) {
        const meshLocalX = (ix / segX - 0.5) * chunkWidth;
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
    const shaped = terraceHeight(terrainHeightAt(this.seed, world.x, world.z));
    const fade = borderFade(localX, localZ, this.fadeHalf, this.plotDepth);
    const relief = this.nearbyPath.length ? pathRelief(distanceToPath(this.nearbyPath, localX, localZ)) : 1;
    const water = this.ponds.length ? pondRelief(localX, localZ, this.ponds) : 1;
    return shaped * fade * relief * water - pondDepth(localX, localZ, this.ponds);
  }

  /** Hauteur exacte (FBM + fondu de bordure) en coordonnées monde ; 0 hors de cette tranche. */
  getHeightAt(wx: number, wz: number): number {
    return this.heightIfInside(wx, wz) ?? 0;
  }

  /** Comme `getHeightAt`, mais `null` hors de la tranche — la caméra doit
   *  savoir si ce sol la concerne, là où un placement se contente de 0. */
  heightIfInside(wx: number, wz: number): number | null {
    const local = toLocal(this.frame, { x: wx, z: wz });
    if (Math.abs(local.x) > this.halfWidth || local.z < this.zStart || local.z > this.zEnd) return null;
    return this.heightAtLocal(local.x, local.z);
  }

  dispose() {
    // Matériau + splatTex créés PAR chunk (chunkMeshes) → tout libérer ici.
    disposeObject(this.mesh);
  }
}
