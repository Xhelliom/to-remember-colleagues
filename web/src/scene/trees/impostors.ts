// Impostors d'arbres (mission 10) : capture 64 vues hémi-octaédriques d'un
// arbre de référence (bark + cartes de feuillage, mission 09) dans un atlas,
// puis un matériau instancié qui blende les 3 vues les plus proches de la
// direction caméra→instance (compensée du yaw de plantation, cf. treeLod.ts)
// — un quad billboard par arbre lointain au lieu de sa géométrie complète.
//
// Référence de concept : LAAS `vegetation/Impostors.ts` (octaédrique 8×8,
// albedo+normal+depth, blend 3 vues) — portée ici en Three.js WebGLRenderer,
// PAS de code copié. ponytail: un seul atlas (albedo) est capturé/utilisé
// pour le shading (pas de normal atlas ni de parallax) : l'éclairage des
// impostors reste non directionnel (couleur captée sous lumière fixe, pas de
// relighting per-pixel). Ajouter une 2e capture (normales objet-space) +
// relighting si l'aspect plat des impostors devient gênant à l'intégration
// visuelle. ponytail: un seul arbre de référence capturé (comme ATLAS_GRID=2
// pour les cartes de feuillage, mission 09) — tous les impostors partagent la
// même silhouette canonique, différenciés par le tint par instance ; ajouter
// 2-3 graines de référence si la répétition visuelle devient gênante.
import * as THREE from "three";
import { buildTree } from "./treeBuilder.ts";
import { dilateBackground, sqrtEncodeRgba } from "./atlasCapture.ts";

// --- Constantes (aucun nombre magique ailleurs dans ce fichier) ------------

/** Vues par axe de la grille hémi-octaédrique (8×8 = 64 vues). */
export const IMPOSTOR_GRID = 8;
export const IMPOSTOR_VIEWS = IMPOSTOR_GRID * IMPOSTOR_GRID;
const IMPOSTOR_TILE_RES = 64; // px — impostors = LOD le plus lointain, résolution modeste
export const IMPOSTOR_ATLAS_RES = IMPOSTOR_TILE_RES * IMPOSTOR_GRID;

/** Graine du SEUL arbre de référence capturé (ponytail, cf. en-tête). */
const IMPOSTOR_REFERENCE_SEED = 4242;
const IMPOSTOR_REFERENCE_LOD = 1; // bark grossier : la capture est minuscule (64 px), le détail ne se voit pas

const CAPTURE_FRAME_MARGIN = 1.15; // marge de cadrage autour du rayon de la sphère englobante
const CAPTURE_DISTANCE_MARGIN = 3; // distance caméra ≈ 3× le rayon (hors de la sphère)
const CAPTURE_FAR_MARGIN = 6;
const CAPTURE_NEAR = 0.05;
const CAPTURE_AMBIENT_COLOR = 0x88a0b0;
const CAPTURE_AMBIENT_INTENSITY = 0.7;
const CAPTURE_SUN_COLOR = 0xfff2d8;
const CAPTURE_SUN_INTENSITY = 2.4;
/** Position FIXE (monde/objet) du soleil de capture — la caméra orbite autour
 *  de l'arbre, la lumière reste fixe : c'est l'éclairage "baké" restitué par
 *  l'atlas (même principe qu'un lightmap). */
const CAPTURE_SUN_POSITION: readonly [number, number, number] = [4, 8, 3];

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FALLBACK_UP = new THREE.Vector3(0, 0, 1);
/** Seuil au-delà duquel la direction de vue est quasi parallèle à l'axe up —
 *  bascule sur un axe de secours pour `camera.up` (même pattern que
 *  foliageCards.ts `cardBasis`/understory.ts `ringBasis`). */
const CAPTURE_UP_DOT_THRESHOLD = 0.98;

const IMPOSTOR_ALPHA_TEST = 0.5;

// --- Encodage octaédrique HÉMISPHÉRIQUE (Y up), pur ----------------------

export type Direction = { readonly x: number; readonly y: number; readonly z: number };
export type TileCoord = { readonly col: number; readonly row: number };
export type ViewBlend = {
  readonly tiles: readonly [number, number, number];
  readonly weights: readonly [number, number, number];
};

/**
 * Projette la moitié supérieure (y ≥ 0) de la sphère des directions sur le
 * carré [-1,1]² — direction zénith (0,1,0) → centre du carré, direction
 * horizontale → bord. `dy` négatif est saturé à 0 (aucune vue n'est capturée
 * sous l'horizon).
 */
export function hemiOctEncode(dx: number, dy: number, dz: number): { u: number; v: number } {
  const y = Math.max(0, dy);
  const l1 = Math.abs(dx) + y + Math.abs(dz) || 1;
  return { u: dx / l1, v: dz / l1 };
}

/** Inverse de `hemiOctEncode` — replie les coins du carré (hors du losange
 *  valide |u|+|v|≤1) dans l'hémisphère plutôt que de les laisser invalides,
 *  pour que CHAQUE tuile de la grille corresponde à une direction réelle
 *  (quitte à dupliquer une vue proche du zénith aux coins). */
export function hemiOctDecode(u: number, v: number): Direction {
  let px = u;
  let pz = v;
  if (Math.abs(px) + Math.abs(pz) > 1) {
    const foldedX = (1 - Math.abs(pz)) * Math.sign(px || 1);
    const foldedZ = (1 - Math.abs(px)) * Math.sign(pz || 1);
    px = foldedX;
    pz = foldedZ;
  }
  const py = Math.max(0, 1 - Math.abs(px) - Math.abs(pz));
  const len = Math.hypot(px, py, pz) || 1;
  return { x: px / len, y: py / len, z: pz / len };
}

/** Coordonnées de tuile (col, row ∈ [0, grid-1]) les plus proches de (u, v). */
export function tileForUv(u: number, v: number, grid: number = IMPOSTOR_GRID): TileCoord {
  const col = Math.min(grid - 1, Math.max(0, Math.floor(((u + 1) / 2) * grid)));
  const row = Math.min(grid - 1, Math.max(0, Math.floor(((v + 1) / 2) * grid)));
  return { col, row };
}

export function tileIndex(tile: TileCoord, grid: number = IMPOSTOR_GRID): number {
  return tile.row * grid + tile.col;
}

/** Tuile de vue la plus proche d'une direction quelconque (pipeline complet
 *  direction → (u,v) → tuile) — mapping testé pour les directions cardinales. */
export function directionToTile(dx: number, dy: number, dz: number, grid: number = IMPOSTOR_GRID): TileCoord {
  const { u, v } = hemiOctEncode(dx, dy, dz);
  return tileForUv(u, v, grid);
}

/** UV normalisé (u, v ∈ [-1,1]) du centre d'une tuile — inverse de `tileForUv`. */
export function tileCenterUv(tile: TileCoord, grid: number = IMPOSTOR_GRID): { u: number; v: number } {
  return { u: ((tile.col + 0.5) / grid) * 2 - 1, v: ((tile.row + 0.5) / grid) * 2 - 1 };
}

/** Direction (monde) au centre d'une tuile — utilisée pour positionner la
 *  caméra de capture de cette tuile. */
export function tileCenterDirection(tile: TileCoord, grid: number = IMPOSTOR_GRID): Direction {
  const { u, v } = tileCenterUv(tile, grid);
  return hemiOctDecode(u, v);
}

/** Coordonnées de tuile continues (avant floor) dans la grille grid×grid. */
function gridCoord(u: number, v: number, grid: number): { gx: number; gy: number } {
  return { gx: ((u + 1) / 2) * (grid - 1), gy: ((v + 1) / 2) * (grid - 1) };
}

/**
 * Poids de blend des 3 vues (tuiles) les plus proches d'une direction, par
 * interpolation barycentrique dans le triangle de la grille qui contient le
 * point — les poids somment TOUJOURS à 1 (propriété barycentrique).
 */
export function nearestViewsBlend(dx: number, dy: number, dz: number, grid: number = IMPOSTOR_GRID): ViewBlend {
  const { u, v } = hemiOctEncode(dx, dy, dz);
  const { gx, gy } = gridCoord(u, v, grid);
  const x0 = Math.min(grid - 2, Math.max(0, Math.floor(gx)));
  const y0 = Math.min(grid - 2, Math.max(0, Math.floor(gy)));
  const fx = Math.min(1, Math.max(0, gx - x0));
  const fy = Math.min(1, Math.max(0, gy - y0));
  const idx = (col: number, row: number) => row * grid + col;

  if (fx + fy <= 1) {
    return { tiles: [idx(x0, y0), idx(x0 + 1, y0), idx(x0, y0 + 1)], weights: [1 - fx - fy, fx, fy] };
  }
  return {
    tiles: [idx(x0 + 1, y0 + 1), idx(x0 + 1, y0), idx(x0, y0 + 1)],
    weights: [fx + fy - 1, 1 - fy, 1 - fx],
  };
}

/** UV de base (coin bas-gauche) d'une tuile dans l'atlas — utilisé au runtime
 *  (instances) ET à la composition de l'atlas. */
function tileBaseUv(tile: number, grid: number = IMPOSTOR_GRID): { u: number; v: number } {
  return { u: (tile % grid) / grid, v: Math.floor(tile / grid) / grid };
}

// --- Capture GPU (WebGLRenderTarget) — un seul arbre de référence ----------

export type ImpostorAtlas = { readonly texture: THREE.DataTexture; dispose(): void };

function computeCaptureFrame(group: THREE.Object3D): { center: THREE.Vector3; radius: number } {
  const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center, radius: sphere.radius || 1 };
}

function positionCaptureCamera(
  camera: THREE.OrthographicCamera, dir: Direction, center: THREE.Vector3, distance: number,
): void {
  camera.position.set(center.x + dir.x * distance, center.y + dir.y * distance, center.z + dir.z * distance);
  camera.up.copy(Math.abs(dir.y) > CAPTURE_UP_DOT_THRESHOLD ? FALLBACK_UP : WORLD_UP);
  camera.lookAt(center);
}

/** Rend UNE vue dans un WebGLRenderTarget carré et lit ses pixels — fond
 *  transparent (même technique que atlasCapture.ts `captureTile`). */
function renderImpostorTile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Uint8ClampedArray {
  const target = new THREE.WebGLRenderTarget(IMPOSTOR_TILE_RES, IMPOSTOR_TILE_RES);
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();

  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const pixels = new Uint8ClampedArray(IMPOSTOR_TILE_RES * IMPOSTOR_TILE_RES * 4);
  renderer.readRenderTargetPixels(target, 0, 0, IMPOSTOR_TILE_RES, IMPOSTOR_TILE_RES, pixels);

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);
  target.dispose();
  return pixels;
}

function composeImpostorAtlas(tiles: readonly Uint8ClampedArray[]): Uint8ClampedArray {
  const atlas = new Uint8ClampedArray(IMPOSTOR_ATLAS_RES * IMPOSTOR_ATLAS_RES * 4);
  tiles.forEach((tile, i) => {
    const { u, v } = tileBaseUv(i);
    const originX = Math.round(u * IMPOSTOR_ATLAS_RES);
    const originY = Math.round(v * IMPOSTOR_ATLAS_RES);
    for (let y = 0; y < IMPOSTOR_TILE_RES; y++) {
      for (let x = 0; x < IMPOSTOR_TILE_RES; x++) {
        const srcI = (y * IMPOSTOR_TILE_RES + x) * 4;
        const dstI = ((originY + y) * IMPOSTOR_ATLAS_RES + (originX + x)) * 4;
        atlas[dstI] = tile[srcI];
        atlas[dstI + 1] = tile[srcI + 1];
        atlas[dstI + 2] = tile[srcI + 2];
        atlas[dstI + 3] = tile[srcI + 3];
      }
    }
  });
  return atlas;
}

/** Capture les 64 vues de l'arbre de référence, encode sqrt + dilate (anti-halo,
 *  cf. atlasCapture.ts) et assemble l'atlas. Coûteux (64 petits renders) mais
 *  fait UNE fois au boot (cf. `getOrCaptureImpostorAtlas`), jamais par frame. */
function renderImpostorAtlas(renderer: THREE.WebGLRenderer): ImpostorAtlas {
  const tree = buildTree(IMPOSTOR_REFERENCE_SEED, { lod: IMPOSTOR_REFERENCE_LOD, foliageMode: "cards", renderer });
  const { center, radius } = computeCaptureFrame(tree.group);
  const frame = radius * CAPTURE_FRAME_MARGIN;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(CAPTURE_AMBIENT_COLOR, CAPTURE_AMBIENT_INTENSITY));
  const sun = new THREE.DirectionalLight(CAPTURE_SUN_COLOR, CAPTURE_SUN_INTENSITY);
  sun.position.set(...CAPTURE_SUN_POSITION);
  scene.add(sun);
  scene.add(tree.group);

  const camera = new THREE.OrthographicCamera(-frame, frame, frame, -frame, CAPTURE_NEAR, radius * CAPTURE_FAR_MARGIN);
  const tiles: Uint8ClampedArray[] = [];
  for (let row = 0; row < IMPOSTOR_GRID; row++) {
    for (let col = 0; col < IMPOSTOR_GRID; col++) {
      const dir = tileCenterDirection({ col, row });
      positionCaptureCamera(camera, dir, center, radius * CAPTURE_DISTANCE_MARGIN);
      const raw = renderImpostorTile(renderer, scene, camera);
      sqrtEncodeRgba(raw);
      tiles.push(raw);
    }
  }

  scene.remove(tree.group); // le groupe n'est jamais ajouté à une scène de prod, on ne fait que le désolidariser

  const dilated = dilateBackground(composeImpostorAtlas(tiles), IMPOSTOR_ATLAS_RES, IMPOSTOR_ATLAS_RES);
  const texture = new THREE.DataTexture(dilated, IMPOSTOR_ATLAS_RES, IMPOSTOR_ATLAS_RES, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace; // encodage sqrt custom, décodé au shader
  texture.needsUpdate = true;
  return { texture, dispose: () => texture.dispose() };
}

let cachedAtlas: ImpostorAtlas | null = null;

/** Renvoie l'atlas d'impostors partagé, en le capturant au premier appel
 *  (mêmes contrats que `atlasCapture.ts` : `renderer` requis seulement pour
 *  cette première capture, mise en cache ensuite). */
export function getOrCaptureImpostorAtlas(renderer?: THREE.WebGLRenderer): ImpostorAtlas {
  if (cachedAtlas) return cachedAtlas;
  if (!renderer) throw new Error("getOrCaptureImpostorAtlas: renderer requis pour la première capture");
  cachedAtlas = renderImpostorAtlas(renderer);
  return cachedAtlas;
}

/** Vide le cache (dispose la texture) — tests, ou reconstruction explicite. */
export function resetImpostorAtlasCache(): void {
  cachedAtlas?.dispose();
  cachedAtlas = null;
}

// --- Matériau + géométrie instanciés (blend 3 vues, fade-in dither) --------

const IMPOSTOR_QUAD_HALF_WIDTH = 0.5;

/** Quad billboard : base (y=0) au pied de l'arbre, sommet (y=1) à sa hauteur —
 *  mis à l'échelle par instance via `aQuadScale` (cf. `updateInstance`). */
function buildImpostorGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -IMPOSTOR_QUAD_HALF_WIDTH, 0, 0,
    IMPOSTOR_QUAD_HALF_WIDTH, 0, 0,
    IMPOSTOR_QUAD_HALF_WIDTH, 1, 0,
    -IMPOSTOR_QUAD_HALF_WIDTH, 1, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Billboard toujours face caméra (technique "spherique" classique) : seule la
 *  TRANSLATION de `instanceMatrix` est utilisée (rotation/échelle ignorées —
 *  l'échelle passe par `aQuadScale`, dédiée). Blend de 3 vues + décodage sqrt
 *  (cf. atlasCapture.ts) + fade-in ditheré (anti-pop, cf. treeLod.ts). */
const IMPOSTOR_VERTEX_GLSL = `
attribute vec2 aTileUvA;
attribute vec2 aTileUvB;
attribute vec2 aTileUvC;
attribute vec3 aTileWeights;
attribute vec2 aQuadScale;
attribute float aTint;
attribute float aFadeIn;

varying vec2 vLocalUv;
varying vec2 vTileUvA;
varying vec2 vTileUvB;
varying vec2 vTileUvC;
varying vec3 vTileWeights;
varying float vTint;
varying float vFadeIn;

void main() {
  vLocalUv = uv;
  vTileUvA = aTileUvA;
  vTileUvB = aTileUvB;
  vTileUvC = aTileUvC;
  vTileWeights = aTileWeights;
  vTint = aTint;
  vFadeIn = aFadeIn;

  vec4 instanceOrigin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 mvOrigin = modelViewMatrix * instanceOrigin;
  mvOrigin.xy += position.xy * aQuadScale;
  gl_Position = projectionMatrix * mvOrigin;
}
`;

const IMPOSTOR_FRAGMENT_GLSL = `
uniform sampler2D uAtlas;
uniform float uTileStep;
uniform float uAlphaTest;

varying vec2 vLocalUv;
varying vec2 vTileUvA;
varying vec2 vTileUvB;
varying vec2 vTileUvC;
varying vec3 vTileWeights;
varying float vTint;
varying float vFadeIn;

vec4 sampleTile(vec2 base) {
  return texture2D(uAtlas, base + vLocalUv * uTileStep);
}

/** Hash déterministe de l'écran — dither du fade-in (même principe que
 *  distanceLod.ts, appliqué PAR PIXEL : un impostor est une instance unique,
 *  pas un essaim sur lequel étaler la transition comme l'herbe). */
float ditherHash(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 blended = sampleTile(vTileUvA) * vTileWeights.x
    + sampleTile(vTileUvB) * vTileWeights.y
    + sampleTile(vTileUvC) * vTileWeights.z;
  if (blended.a < uAlphaTest) discard;
  if (vFadeIn < 1.0 && ditherHash(gl_FragCoord.xy) > vFadeIn) discard;
  vec3 color = blended.rgb * blended.rgb * vTint; // inverse de sqrtEncodeRgba (capture)
  gl_FragColor = vec4(color, blended.a);
}
`;

function buildImpostorMaterial(atlas: ImpostorAtlas): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas.texture },
      uTileStep: { value: 1 / IMPOSTOR_GRID },
      uAlphaTest: { value: IMPOSTOR_ALPHA_TEST },
    },
    vertexShader: IMPOSTOR_VERTEX_GLSL,
    fragmentShader: IMPOSTOR_FRAGMENT_GLSL,
    side: THREE.DoubleSide,
    transparent: false,
    alphaToCoverage: true,
  });
}

export type ImpostorInstanceWrite = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly blend: ViewBlend;
  readonly tint: number;
  /** 0 = invisible, 1 = pleinement opaque — dither progressif entre les deux
   *  (cf. `ditherHash`), piloté par treeLod.ts (transitionProgress). */
  readonly fadeIn: number;
};

export type ImpostorMesh = {
  readonly mesh: THREE.InstancedMesh;
  updateInstance(index: number, write: ImpostorInstanceWrite): void;
  dispose(): void;
};

function writeTileUv(arr: Float32Array, index: number, tile: number): void {
  const { u, v } = tileBaseUv(tile);
  arr[index * 2] = u;
  arr[index * 2 + 1] = v;
}

type ImpostorBuffers = {
  readonly tileUvA: Float32Array; readonly tileUvB: Float32Array; readonly tileUvC: Float32Array;
  readonly weights: Float32Array; readonly quadScale: Float32Array; readonly tint: Float32Array; readonly fadeIn: Float32Array;
};

/** Alloue les buffers + attributs instanciés et les rattache à la géométrie
 *  — un attribut par donnée par-instance (cf. `IMPOSTOR_VERTEX_GLSL`). */
function attachImpostorInstanceAttributes(
  geometry: THREE.BufferGeometry, capacity: number,
): { buffers: ImpostorBuffers; attrs: Record<string, THREE.InstancedBufferAttribute> } {
  const buffers: ImpostorBuffers = {
    tileUvA: new Float32Array(capacity * 2),
    tileUvB: new Float32Array(capacity * 2),
    tileUvC: new Float32Array(capacity * 2),
    weights: new Float32Array(capacity * 3),
    quadScale: new Float32Array(capacity * 2),
    tint: new Float32Array(capacity),
    fadeIn: new Float32Array(capacity),
  };
  const attrs: Record<string, THREE.InstancedBufferAttribute> = {
    aTileUvA: new THREE.InstancedBufferAttribute(buffers.tileUvA, 2),
    aTileUvB: new THREE.InstancedBufferAttribute(buffers.tileUvB, 2),
    aTileUvC: new THREE.InstancedBufferAttribute(buffers.tileUvC, 2),
    aTileWeights: new THREE.InstancedBufferAttribute(buffers.weights, 3),
    aQuadScale: new THREE.InstancedBufferAttribute(buffers.quadScale, 2),
    aTint: new THREE.InstancedBufferAttribute(buffers.tint, 1),
    aFadeIn: new THREE.InstancedBufferAttribute(buffers.fadeIn, 1),
  };
  for (const [name, attr] of Object.entries(attrs)) geometry.setAttribute(name, attr);
  return { buffers, attrs };
}

/** Champ d'impostors instanciés (1 seul draw call, `capacity` places). */
export function buildImpostorMesh(atlas: ImpostorAtlas, capacity: number): ImpostorMesh {
  const geometry = buildImpostorGeometry();
  const { buffers, attrs } = attachImpostorInstanceAttributes(geometry, capacity);

  const material = buildImpostorMaterial(atlas);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  const dummy = new THREE.Object3D();

  function updateInstance(index: number, write: ImpostorInstanceWrite): void {
    dummy.position.set(write.x, write.y, write.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);

    const [tA, tB, tC] = write.blend.tiles;
    writeTileUv(buffers.tileUvA, index, tA);
    writeTileUv(buffers.tileUvB, index, tB);
    writeTileUv(buffers.tileUvC, index, tC);
    buffers.weights.set(write.blend.weights, index * 3);
    buffers.quadScale[index * 2] = write.width;
    buffers.quadScale[index * 2 + 1] = write.height;
    buffers.tint[index] = write.tint;
    buffers.fadeIn[index] = write.fadeIn;

    mesh.instanceMatrix.needsUpdate = true;
    for (const attr of Object.values(attrs)) attr.needsUpdate = true;
  }

  return {
    mesh,
    updateInstance,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
