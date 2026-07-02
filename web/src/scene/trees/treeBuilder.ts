// Assemble le squelette (skeleton.ts) + les maillages (tubeMesh.ts,
// leafMesh.ts) en un arbre complet {bark, foliageMesh, skeleton, stats} :
// l'API stable consommée par la mission 09 (cards/atlas). Écorce = matériau
// paramétrique (bruit BAKÉ, mission 03 noiseBake.ts — pas de texture
// externe) ; vent partagé (mission 02 wind.ts, pools rigide/souple).
//
// Mission 09 (cards/atlas) : `BuildTreeOptions.foliageMode` (optionnel,
// défaut "mesh") bascule le feuillage sur des cartes alpha-testées bon marché
// (foliageCards.ts) au lieu des vraies lames — signature de `buildTree`
// INCHANGÉE pour les appelants existants (mission 11 understory, en
// parallèle), seuls des champs optionnels sont ajoutés.
//
// `mountTreeHeroScene` en bas de fichier est un harnais MINIMAL réservé à
// l'e2e (tree-hero.spec.ts / tree-cards.spec.ts) : aucun chemin de prod
// (main.ts) ne l'importe. Il vit ici plutôt que dans un fichier séparé pour
// respecter la partition de fichiers de la mission 08 (ne créer que
// skeleton/tubeMesh/leafMesh/treeBuilder + tests, sans toucher
// main.ts/cemetery.ts partagés) — la mission 09 l'étend plutôt que d'en
// dupliquer un second, même contrainte de partition.
import * as THREE from "three";
import { BEECH_SPECIES, growSkeleton, type TreeSkeleton } from "./skeleton.ts";
import { buildBarkGeometry } from "./tubeMesh.ts";
import { buildFoliageGeometry } from "./leafMesh.ts";
import { addWindWeightAttribute, applyWind, RIGID_TREE_WIND_POOL, setWindTime, SOFT_TREE_WIND_POOL } from "../wind.ts";
import { bakeNoiseTextures, NOISE_SAMPLE_GLSL, type BakedNoiseTextures } from "../noiseBake.ts";
import { buildFoliageCards } from "./foliageCards.ts";
import { getOrCaptureFoliageAtlas } from "./atlasCapture.ts";

const BARK_BASE_COLOR = 0x6b5642;
const BARK_ROUGHNESS = 0.95;
const BARK_CREVICE_DARKEN = 0.55; // multiplicateur de couleur dans les creux (bruit ridged bas)
const BARK_NOISE_TILE_U = 3; // répétitions du bruit d'écorce autour du tronc (u = angle)
const BARK_NOISE_TILE_V = 6; // répétitions le long des branches (v)
const FOLIAGE_COLOR = 0x4c7a34;
const FOLIAGE_ROUGHNESS = 0.85;
/** Résolution du bruit bâké : un seul hero à la fois → pas besoin de la
 *  résolution "terrain" (128) de noiseBake.ts, 64 suffit largement. */
const NOISE_RESOLUTION = 64;

export type TreeStats = {
  readonly barkTriangles: number;
  readonly foliageTriangles: number;
  readonly totalTriangles: number;
  readonly leafCount: number;
  readonly nodeCount: number;
  /** Nb de cartes de feuillage (mission 09) — présent seulement en mode "cards"/"hybrid". */
  readonly cardCount?: number;
};

export type TreeBuild = {
  readonly group: THREE.Group;
  readonly bark: THREE.Mesh;
  /** Mode "mesh"/"hybrid" : vraies feuilles. Mode "cards" : le mesh de cartes
   *  lui-même (API stable — toujours un THREE.Mesh, jamais undefined). */
  readonly foliageMesh: THREE.Mesh;
  /** Présent uniquement en mode "hybrid" : couche de cartes en appoint du
   *  maillage réel (`foliageMesh`). */
  readonly cardsMesh?: THREE.Mesh;
  readonly skeleton: TreeSkeleton;
  readonly stats: TreeStats;
  dispose(): void;
};

/** "mesh" (défaut, historique) = vraies feuilles (leafMesh.ts) ; "cards" =
 *  cartes alpha-testées bon marché posées aux ancres (mission 09, remplace
 *  entièrement le feuillage réel) ; "hybrid" = les deux couches superposées
 *  (silhouette de cartes + détail de vraies feuilles), pour les arbres les
 *  plus proches quand ils sont instanciés en masse (mission 10). */
export type FoliageMode = "mesh" | "cards" | "hybrid";

export type BuildTreeOptions = {
  readonly lod?: number;
  readonly foliageMode?: FoliageMode;
  /** Requis uniquement pour la PREMIÈRE capture d'atlas (foliageMode !== "mesh") ;
   *  ignoré une fois l'atlas mis en cache (cf. atlasCapture.ts). */
  readonly renderer?: THREE.WebGLRenderer;
};

/** Injecte les uniforms/varyings du bruit d'écorce dans le shader — chaîné
 *  APRÈS le compile de `applyWind` (dont le clone() perd tout onBeforeCompile
 *  préexistant, cf. Material.js : "should not hold references to functions
 *  as these will not be cloned" — on doit donc composer après coup). */
function injectBarkNoise(shader: Parameters<THREE.Material["onBeforeCompile"]>[0], noiseTex: BakedNoiseTextures): void {
  shader.uniforms.uNoiseTexA = { value: noiseTex.texA };
  shader.uniforms.uNoiseTexB = { value: noiseTex.texB };
  // Varying custom (pas vUv standard) : indépendant de USE_UV, qui n'est
  // défini par three que si le matériau porte une texture map.
  shader.vertexShader = `attribute vec2 aBarkUv;\nvarying vec2 vBarkUv;\n${shader.vertexShader}`
    .replace("#include <begin_vertex>", "vBarkUv = aBarkUv;\n#include <begin_vertex>");
  shader.fragmentShader = `varying vec2 vBarkUv;\n${NOISE_SAMPLE_GLSL}${shader.fragmentShader}`.replace(
    "#include <color_fragment>",
    `#include <color_fragment>
    vec2 _barkUv = fract(vBarkUv * vec2(${BARK_NOISE_TILE_U.toFixed(1)}, ${BARK_NOISE_TILE_V.toFixed(1)}));
    float _barkRidged = sampleBakedRidged(_barkUv);
    diffuseColor.rgb *= mix(${BARK_CREVICE_DARKEN.toFixed(3)}, 1.0, _barkRidged);`,
  );
}

/** Matériau d'écorce : vent rigide (wind.ts) + bruit d'écorce bâké (noiseBake.ts). */
function buildBarkMaterial(noiseTex: BakedNoiseTextures): THREE.Material {
  const base = new THREE.MeshStandardMaterial({ color: BARK_BASE_COLOR, roughness: BARK_ROUGHNESS });
  const material = applyWind(base, { pool: RIGID_TREE_WIND_POOL });
  const windCompile = material.onBeforeCompile;
  material.onBeforeCompile = (...args) => {
    windCompile(...args);
    injectBarkNoise(args[0], noiseTex);
  };
  return material;
}

/** Matériau des feuilles : vent souple (plus de sway que l'écorce), double face. */
function buildFoliageMaterial(): THREE.Material {
  const base = new THREE.MeshStandardMaterial({
    color: FOLIAGE_COLOR,
    roughness: FOLIAGE_ROUGHNESS,
    side: THREE.DoubleSide,
  });
  return applyWind(base, { pool: SOFT_TREE_WIND_POOL });
}

/** Couche de feuillage assemblée (mesh + éventuelle couche cards en appoint),
 *  quel que soit le `FoliageMode` — voir `buildFoliageLayer`. */
type FoliageLayer = {
  readonly mesh: THREE.Mesh;
  readonly cardsMesh?: THREE.Mesh;
  readonly triangleCount: number;
  readonly leafCount: number;
  readonly cardCount?: number;
  dispose(): void;
};

/** Couche "vraies feuilles" (leafMesh.ts) — comportement historique, inchangé. */
function buildMeshFoliageLayer(skeleton: TreeSkeleton, lod: number): FoliageLayer {
  const result = buildFoliageGeometry(skeleton.anchors, lod);
  addWindWeightAttribute(result.geometry, SOFT_TREE_WIND_POOL);
  const material = buildFoliageMaterial();
  const mesh = new THREE.Mesh(result.geometry, material);
  return {
    mesh,
    triangleCount: result.triangleCount,
    leafCount: skeleton.anchors.length,
    dispose() { result.geometry.dispose(); material.dispose(); },
  };
}

/** Couche "cartes" (mission 09, foliageCards.ts) — nécessite l'atlas déjà
 *  capturé (ou `renderer` pour le capturer au premier appel). */
function buildCardsFoliageLayer(skeleton: TreeSkeleton, seed: number, renderer: THREE.WebGLRenderer | undefined): FoliageLayer {
  const atlas = getOrCaptureFoliageAtlas(renderer);
  const cards = buildFoliageCards(skeleton.anchors, seed, atlas.texture);
  return {
    mesh: cards.mesh,
    triangleCount: cards.triangleCount,
    leafCount: skeleton.anchors.length,
    cardCount: cards.cardCount,
    dispose: cards.dispose,
  };
}

/** Sélectionne la/les couche(s) de feuillage selon `mode` (API stable :
 *  `foliageMesh` reste toujours un THREE.Mesh, quel que soit le mode). */
function buildFoliageLayer(
  skeleton: TreeSkeleton, seed: number, lod: number, mode: FoliageMode, renderer: THREE.WebGLRenderer | undefined,
): FoliageLayer {
  if (mode === "cards") return buildCardsFoliageLayer(skeleton, seed, renderer);
  const meshLayer = buildMeshFoliageLayer(skeleton, lod);
  if (mode === "mesh") return meshLayer;
  // "hybrid" : silhouette de cartes + détail de vraies feuilles superposés.
  const cardsLayer = buildCardsFoliageLayer(skeleton, seed, renderer);
  return {
    mesh: meshLayer.mesh,
    cardsMesh: cardsLayer.mesh,
    triangleCount: meshLayer.triangleCount + cardsLayer.triangleCount,
    leafCount: meshLayer.leafCount,
    cardCount: cardsLayer.cardCount,
    dispose() { meshLayer.dispose(); cardsLayer.dispose(); },
  };
}

/**
 * Construit un arbre hero unique et déterministe : `buildTree(seed)` deux
 * fois avec la même graine renvoie la même géométrie (mêmes tri-counts,
 * mêmes positions). `opts.lod` (0 = hero, plus haut = plus grossier) réduit
 * les segments radiaux de l'écorce et la densité de feuilles. `opts.foliageMode`
 * (mission 09) bascule le feuillage sur des cartes bon marché — défaut "mesh",
 * comportement historique inchangé (API stable pour la mission 11).
 */
export function buildTree(seed: number, opts: BuildTreeOptions = {}): TreeBuild {
  const lod = opts.lod ?? 0;
  const foliageMode = opts.foliageMode ?? "mesh";
  const skeleton = growSkeleton(BEECH_SPECIES, seed);
  const noiseTex = bakeNoiseTextures(seed, NOISE_RESOLUTION);

  const barkResult = buildBarkGeometry(skeleton, lod);
  addWindWeightAttribute(barkResult.geometry, RIGID_TREE_WIND_POOL);
  const barkMaterial = buildBarkMaterial(noiseTex);
  const bark = new THREE.Mesh(barkResult.geometry, barkMaterial);

  const foliage = buildFoliageLayer(skeleton, seed, lod, foliageMode, opts.renderer);

  const group = new THREE.Group();
  group.add(bark, foliage.mesh);
  if (foliage.cardsMesh) group.add(foliage.cardsMesh);

  return {
    group,
    bark,
    foliageMesh: foliage.mesh,
    cardsMesh: foliage.cardsMesh,
    skeleton,
    stats: {
      barkTriangles: barkResult.triangleCount,
      foliageTriangles: foliage.triangleCount,
      totalTriangles: barkResult.triangleCount + foliage.triangleCount,
      leafCount: foliage.leafCount,
      nodeCount: skeleton.nodes.length,
      cardCount: foliage.cardCount,
    },
    dispose() {
      barkResult.geometry.dispose();
      barkMaterial.dispose();
      foliage.dispose();
      noiseTex.dispose();
    },
  };
}

// --- Harnais e2e (tree-hero.spec.ts uniquement, voir en-tête du fichier) ---

export type TreeHeroDemoOptions = {
  readonly seed: number;
  /** `"x,y,z,yaw,pitch[,fov]"`, même format que e2e/helpers/harness.ts. */
  readonly camPose?: string;
  /** Mission 09 (cards/atlas) : mode de feuillage du harnais, défaut "mesh"
   *  (comportement historique de tree-hero.spec.ts). */
  readonly foliageMode?: FoliageMode;
};

const DEMO_GROUND_SIZE = 40;
const DEMO_GROUND_COLOR = 0x2c3620;
const DEMO_SKY_COLOR = 0x9fc4e8;
const DEMO_SUN_COLOR = 0xfff2d8;
const DEMO_SUN_INTENSITY = 3;
const DEMO_AMBIENT_COLOR = 0x88a0b0;
const DEMO_AMBIENT_INTENSITY = 0.5;
const DEMO_SUN_POSITION: readonly [number, number, number] = [6, 10, 4];
const DEMO_FOV = 55;
const DEMO_NEAR = 0.1;
const DEMO_FAR = 100;
const DEMO_CAM_DEFAULT = { x: 0, y: 1.7, z: 7, yaw: Math.PI, pitch: -0.05 };
const DEMO_PERF_FRAME_WINDOW = 30; // frames sur lesquelles la fps est moyennée (glissant)
const DEMO_READY_FRAME_COUNT = 10; // nb de frames avant de considérer la scène stable (__ready)

type DemoPerf = { drawCalls: number; triangles: number; programs: number; fps: number };
/** Fenêtre enrichie des hooks dev/e2e — jamais en prod (aucun import de ce
 *  module par main.ts). Miroir de l'installation faite dans main.ts pour le
 *  harnais `?testCluster`, dupliqué ici car ce fichier ne doit importer
 *  aucun fichier partagé hors de sa partition (plan/08-arbres-grammaire.md). */
type DemoWindow = Window & { __perf?: DemoPerf; __ready?: Promise<void> };

function addDemoLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(DEMO_AMBIENT_COLOR, DEMO_AMBIENT_INTENSITY));
  const sun = new THREE.DirectionalLight(DEMO_SUN_COLOR, DEMO_SUN_INTENSITY);
  sun.position.set(...DEMO_SUN_POSITION);
  scene.add(sun);
}

function addDemoGround(scene: THREE.Scene): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DEMO_GROUND_SIZE, DEMO_GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: DEMO_GROUND_COLOR, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

/** Applique une pose caméra `x,y,z,yaw,pitch[,fov]` (voir e2e/helpers/harness.ts),
 *  ou la pose par défaut si absente/invalide. */
function applyDemoCamPose(camera: THREE.PerspectiveCamera, raw: string | undefined): void {
  camera.rotation.order = "YXZ";
  camera.position.set(DEMO_CAM_DEFAULT.x, DEMO_CAM_DEFAULT.y, DEMO_CAM_DEFAULT.z);
  camera.rotation.set(DEMO_CAM_DEFAULT.pitch, DEMO_CAM_DEFAULT.yaw, 0);
  if (!raw) return;
  const [x, y, z, yaw, pitch, fov] = raw.split(",").map(Number);
  if ([x, y, z, yaw, pitch].some((n) => Number.isNaN(n))) return;
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);
  if (!Number.isNaN(fov)) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/** Câble `window.__perf`/`window.__ready` (dev/e2e uniquement). Renvoie le
 *  tick à appeler à chaque frame — mêmes formules que main.ts (mission 01). */
function installDemoPerfHooks(renderer: THREE.WebGLRenderer): () => void {
  const w = window as unknown as DemoWindow;
  let resolveReady: () => void = () => {};
  w.__ready = new Promise((r) => { resolveReady = r; });
  let frames = 0;
  let last = performance.now();
  const deltas: number[] = [];
  return () => {
    const now = performance.now();
    deltas.push(now - last);
    last = now;
    if (deltas.length > DEMO_PERF_FRAME_WINDOW) deltas.shift();
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    w.__perf = {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
      fps: avgDelta > 0 ? 1000 / avgDelta : 0,
    };
    frames++;
    if (frames === DEMO_READY_FRAME_COUNT) resolveReady();
  };
}

/**
 * Scène minimale à UN SEUL arbre hero + sol + ciel — réservée au harnais e2e
 * (tree-hero.spec.ts). Jamais d'instanciation de masse ici : le hero est
 * lourd par construction (cf. plan), seule sa mise en scène isolée permet
 * de mesurer sa perf/silhouette sans autre objet dans le budget.
 */
export function mountTreeHeroScene(canvas: HTMLCanvasElement, opts: TreeHeroDemoOptions): { dispose(): void } {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEMO_SKY_COLOR);
  addDemoLighting(scene);
  addDemoGround(scene);

  const tree = buildTree(opts.seed, { foliageMode: opts.foliageMode, renderer });
  scene.add(tree.group);

  const camera = new THREE.PerspectiveCamera(DEMO_FOV, window.innerWidth / window.innerHeight, DEMO_NEAR, DEMO_FAR);
  applyDemoCamPose(camera, opts.camPose);

  const tick = import.meta.env.DEV ? installDemoPerfHooks(renderer) : () => {};
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    setWindTime(clock.getElapsedTime());
    renderer.render(scene, camera);
    tick();
  });

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      tree.dispose();
      renderer.dispose();
    },
  };
}
