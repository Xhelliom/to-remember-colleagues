// Capture d'atlas de feuillage (mission 09) : rend un bouquet de VRAIES
// feuilles (leafMesh.ts, mission 08) dans un WebGLRenderTarget — 4 variantes
// assemblées en atlas 2×2 — pour ensuite poser de grandes cartes alpha-testées
// (foliageCards.ts) au lieu de milliers de lames individuelles par arbre
// instancié. Capture faite UNE fois au boot (jamais par frame), mise en cache
// et partagée par tous les arbres de l'espèce.
//
// Référence de concept : LAAS `vegetation/FoliageCards.ts` — trois détails du
// "propre" reproduits ici :
//   1. Albedo écrit **sqrt-encodé** (`sqrtEncodeUnit`) : le remap linéaire 8
//      bits massacre la précision dans les verts sombres (peu de niveaux
//      distincts en bas de plage) ; sqrt() étale ces valeurs sombres sur plus
//      de codes 8 bits. Décodage (`x²`) au shader de `foliageCards.ts`.
//   2. **Dilatation du fond sur CPU** (`dilateBackground`) avant la génération
//      des mips : sans ça, un texel de fond noir (alpha 0) voisin d'un texel
//      de feuille opaque tire la couleur vers le noir aux mips grossiers →
//      liseré noir visible de loin autour de chaque carte.
//   3. Alpha-test (matériau de la carte, `foliageCards.ts`) : la silhouette de
//      la feuille vient directement de la géométrie captée (pas de masque
//      peint), le fond du rendu reste transparent par construction (clear
//      alpha = 0).
import * as THREE from "three";
import { buildAtlasSprayAnchors, buildFoliageGeometry, SPRAY_CAPTURE_RADIUS } from "./leafMesh.ts";

/** Résolution (px) d'une tuile de l'atlas. */
export const ATLAS_TILE_RES = 256;
/** Grille de variantes (2×2 = 4 bouquets distincts, pour varier les cartes). */
export const ATLAS_GRID = 2;
/** Côté (px) de l'atlas complet. */
export const ATLAS_RES = ATLAS_TILE_RES * ATLAS_GRID;
const SPRAY_VARIANT_COUNT = ATLAS_GRID * ATLAS_GRID;

/** Passes de dilatation du fond — chaque passe étend d'1 texel le halo de
 *  couleur valide ; 4 passes couvrent largement le rayon d'un texel de mip
 *  grossier pour une tuile de `ATLAS_TILE_RES` px. */
const DILATE_PASSES = 4;
/** Voisinage 4-connexe (croix) — suffisant pour propager la couleur, moins
 *  coûteux qu'un voisinage 8-connexe. */
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Même vert que `treeBuilder.ts` (FOLIAGE_COLOR) — dupliqué ici volontairement :
 *  ce fichier ne doit importer aucun module hors de sa partition (trees/*
 *  uniquement), cf. plan/09-arbres-cards-atlas.md. */
const FOLIAGE_ATLAS_COLOR = 0x4c7a34;
const CAPTURE_FRAME_MARGIN = 1.15; // marge de cadrage autour du rayon du bouquet
const CAPTURE_CAMERA_DISTANCE = 1.2;
const CAPTURE_NEAR = 0.05;
const CAPTURE_FAR = 4;

// --- Encodage sqrt (préserve la précision dans les tons sombres en 8 bits) ---

/** Encode une valeur linéaire [0,1] en espace sqrt [0,1]. */
export function sqrtEncodeUnit(linear: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, linear)));
}

/** Inverse de `sqrtEncodeUnit` — décodage fait au shader (foliageCards.ts). */
export function sqrtDecodeUnit(encoded: number): number {
  const c = Math.max(0, Math.min(1, encoded));
  return c * c;
}

/** Applique l'encodage sqrt sur les canaux RGB d'un buffer RGBA 8 bits, en
 *  place (alpha inchangé — l'alpha reste la couverture linéaire du masque). */
export function sqrtEncodeRgba(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.round(sqrtEncodeUnit(pixels[i] / 255) * 255);
    pixels[i + 1] = Math.round(sqrtEncodeUnit(pixels[i + 1] / 255) * 255);
    pixels[i + 2] = Math.round(sqrtEncodeUnit(pixels[i + 2] / 255) * 255);
  }
}

// --- Dilatation du fond (anti-halo) ---

/**
 * Étend la couleur RGB des texels opaques dans les texels transparents
 * voisins, `passes` fois de suite (alpha laissé tel quel — le texel reste
 * transparent, seule sa couleur cesse d'être noire). Nécessaire avant la
 * génération des mips : le filtrage linéaire GPU moyenne la couleur des
 * texels voisins indépendamment de l'alpha.
 */
export function dilateBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  passes: number = DILATE_PASSES,
): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(pixels);
  let mask: Uint8Array<ArrayBuffer> = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) mask = dilatePass(out, mask, width, height);
  return out;
}

/** Une passe de dilatation : remplit les texels non "source" (mask=0) ayant au
 *  moins un voisin source, avec la moyenne de couleur de ces voisins — puis
 *  les marque source pour la passe suivante (croissance d'un anneau/passe). */
function dilatePass(
  pixels: Uint8ClampedArray, mask: Uint8Array<ArrayBuffer>, width: number, height: number,
): Uint8Array<ArrayBuffer> {
  const nextMask = Uint8Array.from(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 1) continue;
      const avg = averageSourceNeighborColor(pixels, mask, width, height, x, y);
      if (!avg) continue;
      const i = idx * 4;
      pixels[i] = avg.r; pixels[i + 1] = avg.g; pixels[i + 2] = avg.b;
      nextMask[idx] = 1;
    }
  }
  return nextMask;
}

/** Moyenne RGB des voisins "source" (mask=1) de (x,y), ou `null` si aucun. */
function averageSourceNeighborColor(
  pixels: Uint8ClampedArray, mask: Uint8Array<ArrayBuffer>, width: number, height: number, x: number, y: number,
): { r: number; g: number; b: number } | null {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const nIdx = ny * width + nx;
    if (mask[nIdx] !== 1) continue;
    const ni = nIdx * 4;
    sumR += pixels[ni]; sumG += pixels[ni + 1]; sumB += pixels[ni + 2]; count++;
  }
  if (count === 0) return null;
  return { r: Math.round(sumR / count), g: Math.round(sumG / count), b: Math.round(sumB / count) };
}

// --- Diagnostics (consommés par foliageCards.test.ts) ---

/** Fraction de texels opaques (alpha > 0) — sert à vérifier qu'une capture
 *  n'est pas vide. */
export function alphaCoverageRatio(pixels: Uint8ClampedArray): number {
  const count = pixels.length / 4;
  if (count === 0) return 0;
  let opaque = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 0) opaque++;
  return opaque / count;
}

/** Luminance minimale (0..1) parmi les texels TRANSPARENTS adjacents à un
 *  texel opaque — `null` s'il n'y a aucun texel de ce type. Test anti-halo :
 *  avant dilatation ce minimum est proche de 0 (fond noir) ; après, il doit
 *  être significatif (couleur de feuille propagée, pas du noir). */
export function minLuminanceOfTransparentEdge(
  pixels: Uint8ClampedArray, width: number, height: number,
): number | null {
  let min: number | null = null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] > 0) continue; // pas un texel de fond
      if (!hasOpaqueNeighbor(pixels, width, height, x, y)) continue;
      const luminance = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
      if (min === null || luminance < min) min = luminance;
    }
  }
  return min;
}

function hasOpaqueNeighbor(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): boolean {
  return NEIGHBOR_OFFSETS.some(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
    return pixels[(ny * width + nx) * 4 + 3] > 0;
  });
}

// --- Composition de l'atlas (grille 2×2 de tuiles) ---

function composeAtlas(tiles: readonly Uint8ClampedArray[]): Uint8ClampedArray {
  const atlas = new Uint8ClampedArray(ATLAS_RES * ATLAS_RES * 4);
  tiles.forEach((tile, tileIndex) => {
    const col = tileIndex % ATLAS_GRID;
    const row = Math.floor(tileIndex / ATLAS_GRID);
    for (let y = 0; y < ATLAS_TILE_RES; y++) {
      for (let x = 0; x < ATLAS_TILE_RES; x++) {
        const srcI = (y * ATLAS_TILE_RES + x) * 4;
        const dstX = col * ATLAS_TILE_RES + x;
        const dstY = row * ATLAS_TILE_RES + y;
        const dstI = (dstY * ATLAS_RES + dstX) * 4;
        atlas[dstI] = tile[srcI]; atlas[dstI + 1] = tile[srcI + 1];
        atlas[dstI + 2] = tile[srcI + 2]; atlas[dstI + 3] = tile[srcI + 3];
      }
    }
  });
  return atlas;
}

// --- Capture GPU (WebGLRenderTarget) ---

/** Rend UNE variante de bouquet dans un WebGLRenderTarget carré et lit ses
 *  pixels — fond transparent par `setClearColor(.., 0)`, aucun masque d'alpha
 *  requis : la silhouette vient de la géométrie (feuilles), pas d'une texture. */
function captureTile(renderer: THREE.WebGLRenderer, variantSeed: number): Uint8ClampedArray {
  const anchors = buildAtlasSprayAnchors(variantSeed);
  const { geometry } = buildFoliageGeometry(anchors, 0);
  const material = new THREE.MeshBasicMaterial({ color: FOLIAGE_ATLAS_COLOR, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);

  const scene = new THREE.Scene();
  scene.add(mesh);
  const half = SPRAY_CAPTURE_RADIUS * CAPTURE_FRAME_MARGIN;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, CAPTURE_NEAR, CAPTURE_FAR);
  camera.position.set(0, 0, CAPTURE_CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  const target = new THREE.WebGLRenderTarget(ATLAS_TILE_RES, ATLAS_TILE_RES);
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const pixels = new Uint8ClampedArray(ATLAS_TILE_RES * ATLAS_TILE_RES * 4);
  renderer.readRenderTargetPixels(target, 0, 0, ATLAS_TILE_RES, ATLAS_TILE_RES, pixels);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);
  geometry.dispose();
  material.dispose();
  target.dispose(); // RT jetable dès la lecture faite (contrainte : dispose() des RT de capture)

  return pixels;
}

export type FoliageAtlas = { readonly texture: THREE.DataTexture; dispose(): void };

/** Capture les 4 variantes, encode sqrt + dilate, assemble l'atlas et l'upload
 *  en `DataTexture` (mips générés par le GPU à partir des données déjà
 *  dilatées — donc sans halo noir). */
function renderFoliageAtlas(renderer: THREE.WebGLRenderer): FoliageAtlas {
  const tiles: Uint8ClampedArray[] = [];
  for (let variant = 0; variant < SPRAY_VARIANT_COUNT; variant++) {
    const raw = captureTile(renderer, variant);
    sqrtEncodeRgba(raw);
    tiles.push(raw);
  }
  const composed = composeAtlas(tiles);
  const dilated = dilateBackground(composed, ATLAS_RES, ATLAS_RES);

  const texture = new THREE.DataTexture(dilated, ATLAS_RES, ATLAS_RES, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace; // encodage sqrt custom, décodé au shader — pas de sRGB standard
  texture.needsUpdate = true;
  return { texture, dispose: () => texture.dispose() };
}

// --- Cache partagé (une capture par session, jamais par arbre ni par frame) ---

let cachedAtlas: FoliageAtlas | null = null;

/** Renvoie l'atlas de feuillage partagé, en le capturant au premier appel.
 *  `renderer` n'est nécessaire que pour cette première capture (les appels
 *  suivants renvoient le cache sans lui). */
export function getOrCaptureFoliageAtlas(renderer?: THREE.WebGLRenderer): FoliageAtlas {
  if (cachedAtlas) return cachedAtlas;
  if (!renderer) {
    throw new Error("getOrCaptureFoliageAtlas: renderer requis pour la première capture (mise en cache ensuite)");
  }
  cachedAtlas = renderFoliageAtlas(renderer);
  return cachedAtlas;
}

/** Vide le cache (dispose la texture) — tests, ou reconstruction explicite
 *  d'un nouvel atlas (contrainte : dispose() des atlas régénérés). */
export function resetFoliageAtlasCache(): void {
  cachedAtlas?.dispose();
  cachedAtlas = null;
}
