// Harnais e2e SEUL (mission 10, e2e/forest.spec.ts) : scène minimale d'une
// forêt de placements procéduraux déterministes, montée avec la chaîne LOD
// complète (treeLod.ts : hero → cards R1/R2 → impostor → canopy shell).
// Jamais importé par le code de prod (main.ts/cemetery.ts) — même partition
// que treeBuilder.ts `mountTreeHeroScene` (tree-hero.spec.ts/tree-cards.spec.ts),
// dupliquée ici pour la même raison (ce fichier ne peut toucher aux fichiers
// partagés d'autres missions déjà closes).
import * as THREE from "three";
import { seededRandom } from "../../graves.ts";
import { hashSeed } from "../../procedural.ts";
import { setWindTime } from "../wind.ts";
import { TreeLodField, type TreePlacement } from "./treeLod.ts";

// --- Placement de la forêt de démo (disque déterministe autour de la caméra) -

const FOREST_RADIUS = 200; // m — rayon du disque de placement (couvre largement le seuil impostor à 95 m)
const FOREST_TREE_COUNT = 500; // dense, mais dans la capacité de l'impostor (IMPOSTOR_CAPACITY=500, cf. impostors.ts)
const FOREST_SCALE_MIN = 0.8;
const FOREST_SCALE_RANGE = 0.6;

/** Un seul arbre fixe à l'origine — réservé au test anti-pop (forest.spec.ts),
 *  qui balaie la DISTANCE CAMÉRA pour traverser précisément la fenêtre de
 *  transition cards R2 → impostor, sans le bruit d'une forêt entière. */
const SINGLE_TREE_PLACEMENT: readonly TreePlacement[] = [
  { x: 0, y: 0, z: 0, yaw: 0, scale: 1, seed: hashSeed("forestdemo:single") },
];

/**
 * Placements déterministes uniformes dans un disque de rayon `radius` centré
 * à l'origine — aire uniforme (racine du rayon, pas de biais au centre), même
 * schéma que `buildTreePlacements` (vegetation.ts), dupliqué ici car ce
 * harnais ne peut importer vegetation.ts (fichier possédé par une autre
 * mission déjà close) et cette fonction n'y est pas exportée.
 */
export function buildForestPlacements(seed: number, treeCount: number, radius: number): TreePlacement[] {
  const rand = seededRandom(seed);
  return Array.from({ length: treeCount }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * radius;
    return {
      x: Math.cos(angle) * dist,
      y: 0,
      z: Math.sin(angle) * dist,
      yaw: rand() * Math.PI * 2,
      scale: FOREST_SCALE_MIN + rand() * FOREST_SCALE_RANGE,
      seed: hashSeed(`forestdemo:${seed}:${i}`),
    };
  });
}

// --- Scène de démo (sol + ciel + lumière + caméra + hooks perf/ready) ------
// Constantes dupliquées de treeBuilder.ts `mountTreeHeroScene` (même
// contrainte de partition, cf. en-tête) — un jour factorisable si une 3e
// mission a besoin du même harnais minimal.

const DEMO_GROUND_SIZE = FOREST_RADIUS * 2.2;
const DEMO_GROUND_COLOR = 0x2c3620;
const DEMO_SKY_COLOR = 0x9fc4e8;
const DEMO_SUN_COLOR = 0xfff2d8;
const DEMO_SUN_INTENSITY = 3;
const DEMO_AMBIENT_COLOR = 0x88a0b0;
const DEMO_AMBIENT_INTENSITY = 0.5;
const DEMO_SUN_POSITION: readonly [number, number, number] = [6, 10, 4];
const DEMO_FOV = 60;
const DEMO_NEAR = 0.1;
const DEMO_FAR = FOREST_RADIUS * 2;
const DEMO_CAM_DEFAULT = { x: 0, y: 1.8, z: 0, yaw: 0, pitch: -0.02 };
const DEMO_PERF_FRAME_WINDOW = 30; // frames sur lesquelles la fps est moyennée (glissant)
const DEMO_READY_FRAME_COUNT = 10; // nb de frames avant de considérer la scène stable (__ready)

type DemoPerf = { drawCalls: number; triangles: number; programs: number; fps: number };
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
 *  tick à appeler à chaque frame — mêmes formules que treeBuilder.ts. */
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

export type ForestDemoOptions = {
  readonly seed: number;
  /** `"x,y,z,yaw,pitch[,fov]"`, même format que e2e/helpers/harness.ts. */
  readonly camPose?: string;
  readonly treeCount?: number;
  readonly radius?: number;
  /** Un seul arbre fixe à l'origine (ignore `treeCount`/`radius`) — cf.
   *  `SINGLE_TREE_PLACEMENT`, réservé au test anti-pop. */
  readonly single?: boolean;
};

export type ForestDemoHandle = {
  /** Comptes d'instances par palier après la dernière frame — cf.
   *  `TreeLodField.tierCounts`. */
  tierCounts(): { hero: number; cardsR1: number; cardsR2: number; impostor: number };
  dispose(): void;
};

/**
 * Scène minimale d'une forêt procédurale + chaîne LOD complète, réservée au
 * harnais e2e (forest.spec.ts). La capture d'impostor (mission 10) est faite
 * une fois au montage (cf. `TreeLodField.create` → `getOrCaptureImpostorAtlas`),
 * jamais par frame.
 */
export function mountForestDemoScene(canvas: HTMLCanvasElement, opts: ForestDemoOptions): ForestDemoHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(DEMO_SKY_COLOR);
  addDemoLighting(scene);
  addDemoGround(scene);

  const placements = opts.single
    ? SINGLE_TREE_PLACEMENT
    : buildForestPlacements(opts.seed, opts.treeCount ?? FOREST_TREE_COUNT, opts.radius ?? FOREST_RADIUS);
  const treeLod = TreeLodField.create(hashSeed(`forestdemo:${opts.seed}`), placements, renderer);
  scene.add(treeLod.group);

  const camera = new THREE.PerspectiveCamera(DEMO_FOV, window.innerWidth / window.innerHeight, DEMO_NEAR, DEMO_FAR);
  applyDemoCamPose(camera, opts.camPose);

  const tick = import.meta.env.DEV ? installDemoPerfHooks(renderer) : () => {};
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    setWindTime(clock.getElapsedTime());
    treeLod.update(camera.position.x, camera.position.z, camera.position.y);
    renderer.render(scene, camera);
    tick();
  });

  return {
    tierCounts: () => treeLod.tierCounts(),
    dispose() {
      renderer.setAnimationLoop(null);
      treeLod.dispose();
      renderer.dispose();
    },
  };
}
