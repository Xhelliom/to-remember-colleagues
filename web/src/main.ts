import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { getColleagues, getCompanies, getCurrentUser, getColleagueById } from "./api.ts";
import { Cemetery } from "./cemetery.ts";
import { hideAuth, setupAuth, showAuth } from "./ui/auth.ts";
import { hideMenu, refreshMenu, setMenuUser, setupMenu, showMenu } from "./ui/menu.ts";
import { hideHud, setupHud, showWorldHud } from "./ui/hud.ts";
import { buildClusterBiome, graveAnchors, EARTH_RADIUS } from "./scene/biomes/clairiere/builder.ts";
import { GrassField } from "./scene/grassField.ts";
import { getAmbiance, getFilmGrade, resolveTimeKey, type SeasonKey } from "./ambiance.ts";
import { Flythrough, getBookmark, parseShotParam, type BookmarkPose } from "./scene/bookmarks.ts";
import { AutoExposurePass } from "./scene/post/autoExposure.ts";
import { applyFilmGrade, createGoldenGradePass } from "./scene/post/grade.ts";
import { createFogRenderTarget, GroundFogPass } from "./scene/post/groundFog.ts";
import type { ClusterInfo } from "./procedural.ts";
import type { Frame } from "./worldLayout.ts";

const loader = document.getElementById("loader") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

const PERF_FRAME_WINDOW = 30; // frames sur lesquelles la fps est moyennée (glissant)
const READY_FRAME_COUNT = 10; // nb de frames avant de considérer la scène stable (__ready)
const HARNESS_SUN_DISTANCE = 16; // distance soleil↔cible, calée sur le rig d'origine (3,16,2)
const HARNESS_SEASON: SeasonKey = "summer"; // fixe → déterminisme indépendant de la date du run

// Post/ambiance additifs (issue #14) : auto-exposition, grade filmique par heure,
// brume de hauteur — regroupés derrière UN SEUL flag `?post=1` (défaut : comportement
// actuel inchangé, aucune de ces passes n'est construite). `?shot=1..9`/`?shot=fly`
// (bookmarks/flythrough, scene/bookmarks.ts) sont indépendants de ce flag : la
// caméra seule change, pas le pipeline de post-traitement.
const POST_FX_PARAM = "post";
const SHOT_PARAM = "shot";
const DEFAULT_GRADE_HOUR = 12; // heure utilisée pour le grade filmique quand `?T=` est absent

// Bypass complet du routing pour l'itération visuelle du biome de cluster — sert
// aussi de scène de HARNAIS déterministe pour les missions du rework herbe/arbres
// (plan/README.md § Infra de test partagée) : `?cam=x,y,z,yaw,pitch[,fov]` place la
// caméra, `?seed=N` fait varier le layout (déterministe), `?T=heures` recolore
// l'ambiance (défaut = comportement actuel si absent). `?preset=low|high|ultra` est
// lu tel quel par les futures missions (herbe/arbres/pierre) via URLSearchParams —
// rien à câbler ici tant qu'aucun chemin alternatif n'existe.
// Usage : ?testCluster=42  (la valeur est un seed pour de futures variations)
// NB : ce dispatch doit rester APRÈS toutes les const ci-dessus — `runClusterTest`
// les lit de façon synchrone dès son premier appel (avant tout `await`), et un
// appel plus haut dans le fichier lève une ReferenceError (TDZ) sur ces const.
const testClusterSeed = new URLSearchParams(window.location.search).get("testCluster");
if (testClusterSeed !== null) {
  void runClusterTest(canvas);
} else {
  void startApp();
}

type PerfSnapshot = { drawCalls: number; triangles: number; programs: number; fps: number };
/** Fenêtre enrichie des hooks dev/e2e — jamais présente en prod (voir installHarnessHooks). */
type HarnessWindow = Window & { __perf?: PerfSnapshot; __ready?: Promise<void> };

/**
 * Câble `window.__perf`/`window.__ready` (dev/e2e uniquement — voir
 * plan/01-harness.md). Renvoie le tick à appeler à chaque frame du rendu.
 */
function installHarnessHooks(renderer: THREE.WebGLRenderer): () => void {
  const w = window as unknown as HarnessWindow;
  let resolveReady: () => void = () => {};
  w.__ready = new Promise((r) => { resolveReady = r; });
  let frames = 0;
  let last = performance.now();
  const deltas: number[] = [];
  return () => {
    const now = performance.now();
    deltas.push(now - last);
    last = now;
    if (deltas.length > PERF_FRAME_WINDOW) deltas.shift();
    const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    w.__perf = {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
      fps: avgDelta > 0 ? 1000 / avgDelta : 0,
    };
    frames++;
    if (frames === READY_FRAME_COUNT) resolveReady();
  };
}

/** Positionne la caméra sur une pose (bookmark ou frame de flythrough, voir
 *  scene/bookmarks.ts) — partagé par `applyCamPose` (`?cam=`) et le harnais `?shot=`. */
function applyBookmarkPose(camera: THREE.PerspectiveCamera, pose: BookmarkPose): void {
  camera.position.set(pose.x, pose.y, pose.z);
  camera.rotation.order = "YXZ";
  camera.rotation.set(pose.pitch, pose.yaw, 0);
}

/** Applique une pose caméra `x,y,z,yaw,pitch[,fov]` (voir e2e/helpers/harness.ts). */
function applyCamPose(camera: THREE.PerspectiveCamera, raw: string): void {
  const [x, y, z, yaw, pitch, fov] = raw.split(",").map(Number);
  if ([x, y, z, yaw, pitch].some((n) => Number.isNaN(n))) return;
  applyBookmarkPose(camera, { x, y, z, yaw, pitch });
  if (!Number.isNaN(fov)) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/** Recolore l'éclairage du harnais selon l'heure `T` (0–24h), en réutilisant les
 *  palettes d'ambiance.ts — n'est appliqué que si `?T=` est fourni (comportement
 *  par défaut inchangé sinon, voir plan/01-harness.md). */
function applyTimeOverride(
  hour: number,
  scene: THREE.Scene,
  fog: THREE.FogExp2,
  ambientLight: THREE.AmbientLight,
  hemiLight: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  sunTarget: THREE.Object3D,
): void {
  const a = getAmbiance(resolveTimeKey("auto", hour), HARNESS_SEASON);
  scene.background = new THREE.Color(a.skyTop);
  fog.color.setHex(a.fogColor);
  fog.density = a.fogDensity;
  ambientLight.color.setHex(a.ambientColor);
  ambientLight.intensity = a.ambientIntensity;
  hemiLight.color.setHex(a.hemiSky);
  hemiLight.groundColor.setHex(a.hemiGround);
  hemiLight.intensity = a.hemiIntensity;
  sun.color.setHex(a.keyLightColor);
  sun.intensity = a.keyLightIntensity;
  const [dx, dy, dz] = a.keyLightDir;
  sun.position.set(dx * HARNESS_SUN_DISTANCE, dy * HARNESS_SUN_DISTANCE, dz * HARNESS_SUN_DISTANCE)
    .add(sunTarget.position);
}

/** Scène de test isolée : 1 cluster, caméra fixe — pas de Cemetery, pas d'auth.
 *  Sert aussi de scène de harnais déterministe (?cam/?seed/?T, voir plus haut). */
async function runClusterTest(c: HTMLCanvasElement) {
  loader.classList.add("hidden");
  const harnessParams = new URLSearchParams(window.location.search);
  // `?post=1` : active auto-exposition/grade filmique/brume (issue #14) — voir
  // POST_FX_PARAM. Absent par défaut → composer strictement identique à avant.
  const postFxEnabled = harnessParams.get(POST_FX_PARAM) === "1";

  // preserveDrawingBuffer : permet au test E2E de lire le rendu via toDataURL
  // (évite le screenshot Playwright, très lent sous swiftshader headless).
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); // capture 1:1 pour la comparaison au concept
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Rendu filmique + exposition très basse → sous-bois sombre et désaturé
  // (cibles : meanLum ≈ 0.15, meanSat ≈ 0.19, green ≈ 0.13).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;

  const scene = new THREE.Scene();
  // Trouée claire au fond + brume sombre neutre : fond et désature les lointains.
  scene.background = new THREE.Color(0x9aa894);
  scene.fog = new THREE.FogExp2(0x232a1f, 0.07);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
  // Œil 1,7 m au débouché de l'allée, regardant le centre de la clairière (~9 m).
  camera.position.set(0, 1.7, 0.5);
  camera.lookAt(0, 1.4, 9);
  const camParam = harnessParams.get("cam");
  // `?shot=1..9` (bookmark QA/visite guidée) prime sur `?cam=` ; `?shot=fly` démarre
  // le tour automatique (piloté frame par frame dans la boucle de rendu plus bas).
  const shotParam = parseShotParam(harnessParams.get(SHOT_PARAM));
  let flythrough: Flythrough | undefined;
  if (shotParam === "fly") {
    flythrough = new Flythrough();
  } else if (typeof shotParam === "number") {
    const bookmark = getBookmark(shotParam);
    if (bookmark) applyBookmarkPose(camera, bookmark.pose);
  } else if (camParam) {
    applyCamPose(camera, camParam); // défaut inchangé si absent
  }

  // Contraste concept : canopée/bords sombres, MAIS flaque de lumière chaude sur
  // le sol de la clairière (soleil plongeant de l'avant vers le centre + graves).
  const ambientLight = new THREE.AmbientLight(0x7a7060, 0.16); // légère chaleur → lève la terre
  scene.add(ambientLight);
  const hemiLight = new THREE.HemisphereLight(0x9fb2c0, 0x221c12, 0.24);
  scene.add(hemiLight);
  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(0, 0, 9); // centre de la clairière
  scene.add(sunTarget);
  const sun = new THREE.DirectionalLight(0xffe0a0, 3.2);
  sun.position.set(3, 16, 2); // au-dessus/avant → éclaire le sol et l'avant des tombes
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  scene.add(sun);

  const timeParam = harnessParams.get("T");
  if (timeParam !== null && !Number.isNaN(Number(timeParam))) {
    applyTimeOverride(Number(timeParam), scene, scene.fog as THREE.FogExp2, ambientLight, hemiLight, sun, sunTarget);
  }

  // Flaque de lumière chaude sur le sol de la clairière (signature du concept :
  // sol ensoleillé sous une canopée sombre).
  const floorGlow = new THREE.PointLight(0xffdca0, 22, 22, 2);
  floorGlow.position.set(0, 4.5, 7);
  scene.add(floorGlow);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x1c2716, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Clairière au centre, à ~9 m devant la caméra. Centre ouvert (pas d'arbre) :
  // le concept a une clairière dégagée avec les tombes en arc.
  // approach = (0,0) : le visiteur (caméra) arrive de l'entrée vers le centre.
  const cluster: ClusterInfo = { x: 0, z: 9, chunk: 0, propKind: "flat", approach: { x: 0, z: 0 } };
  const frame: Frame = { entrance: { x: 0, z: 0 }, rotY: 0 };
  // ?seed= fait varier le layout de façon déterministe (défaut inchangé si absent).
  const seedParam = harnessParams.get("seed");
  const companyId = seedParam !== null ? `harness-${seedParam}` : "test-company";
  const biome = await buildClusterBiome(cluster, frame, undefined, companyId);
  scene.add(biome);

  // Tombes stand-in aux ancres possédées par le biome (arc face au visiteur).
  const GRAVE_COUNT = 5;
  for (const a of graveAnchors(frame, cluster, GRAVE_COUNT)) {
    const stone = makeHeadstone();
    stone.position.set(a.x, 0, a.z);
    stone.rotation.y = a.rotY;
    scene.add(stone);
  }

  // Herbe HAUTE bordant la clairière, exclue du disque de terre ET de l'allée
  // centrale (l'allée reste en terre nue jusqu'au fer à cheval).
  const PATH_HALF = 1.4;
  const grass = await GrassField.create(
    companyId, 2, frame, 16, 16, 0, 16, undefined,
    {
      heightScale: 1.9,
      exclude: (x, z) => {
        const inDisk = (x - cluster.x) ** 2 + (z - cluster.z) ** 2 < EARTH_RADIUS * EARTH_RADIUS;
        const inPath = Math.abs(x - cluster.x) < PATH_HALF && z < cluster.z;
        return inDisk || inPath;
      },
    },
  );
  if (grass) scene.add(grass.mesh);

  document.body.dataset.ready = "cluster";

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Étalonnage (color grade) : désature + vignette + léger contraste → matche le
  // rendu gradé sombre du concept (baisse green/meanSat, renforce la vignette).
  // `?post=1` : le buffer porte une depthTexture (brume de hauteur) — sinon composer
  // strictement identique à avant (comportement par défaut inchangé).
  const composer = postFxEnabled
    ? new EffectComposer(renderer, createFogRenderTarget(renderer))
    : new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(GRADE_SHADER));

  if (postFxEnabled) {
    composer.addPass(new AutoExposurePass());
    const goldenGrade = createGoldenGradePass();
    const gradeHour = timeParam !== null && !Number.isNaN(Number(timeParam)) ? Number(timeParam) : DEFAULT_GRADE_HOUR;
    applyFilmGrade(goldenGrade, getFilmGrade(resolveTimeKey("auto", gradeHour)));
    composer.addPass(goldenGrade);
    composer.addPass(new GroundFogPass(camera));
  }

  // window.__perf/__ready : dev/e2e uniquement, jamais en prod (voir installHarnessHooks).
  const tickHarness = import.meta.env.DEV ? installHarnessHooks(renderer) : () => {};

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = clock.getElapsedTime();
    grass?.update(elapsed);
    if (flythrough) applyBookmarkPose(camera, flythrough.samplePose(elapsed));
    composer.render();
    tickHarness();
  });
}

// Shader d'étalonnage plein écran : saturation, vignette, contraste.
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 0.4 },        // < 1 → désature (concept quasi monochrome)
    uVignette: { value: 1.0 },   // force de l'assombrissement des bords
    uContrast: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSat;
    uniform float uVignette;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, uSat);           // désaturation
      col = (col - 0.5) * uContrast + 0.5;            // contraste
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d);        // assombrit les bords
      gl_FragColor = vec4(clamp(col * vig, 0.0, 1.0), c.a);
    }
  `,
};

/** Pierre tombale stand-in (test) : dalle grise + sommet arrondi. */
function makeHeadstone(): THREE.Group {
  // Léger émissif : la pierre reste lisible en gris même à l'ombre de la voûte.
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.95, emissive: 0x2b2b28 });
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.15), mat);
  slab.position.y = 0.55;
  slab.castShadow = true;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.15, 16, 1, false, 0, Math.PI), mat);
  top.rotation.z = -Math.PI / 2;
  top.rotation.y = Math.PI / 2;
  top.position.y = 1.1;
  top.castShadow = true;
  g.add(slab, top);
  return g;
}

/** Démarrage normal : auth → menu → monde. */
async function startApp() {
  const cemetery = new Cemetery(canvas);
  cemetery.setColleagueLoader((id) => getColleagues(id));

  async function goToMenu() {
    cemetery.setActive(false);
    cemetery.leavePresence();
    cemetery.clearWorld();
    hideAuth();
    hideHud();
    await refreshMenu();
    showMenu();
  }

  function goToAuth() {
    cemetery.setActive(false);
    cemetery.leavePresence();
    hideHud();
    hideMenu();
    showAuth();
  }

  async function enterCemeteryByGrave(graveId: string) {
    try {
      const { company } = await getColleagueById(graveId);
      await goToWorld(company.id);
      history.replaceState(null, "", window.location.pathname);
    } catch {
      await goToMenu();
    }
  }

  async function goToWorld(spawnCompanyId?: string) {
    hideMenu();
    hideAuth();
    const companies = await getCompanies();
    cemetery.enterWorld(companies, spawnCompanyId);
    showWorldHud(companies.length);
    cemetery.setActive(true);
  }

  setupAuth(async () => {
    const user = await getCurrentUser();
    if (user) {
      setMenuUser(user);
      cemetery.setVisitorName(user.name);
    }
    const graveId = new URLSearchParams(window.location.search).get("grave");
    if (graveId) {
      await enterCemeteryByGrave(graveId);
    } else {
      await goToMenu();
    }
  });

  setupMenu({
    onEnter: (company) => {
      void goToWorld(company.id);
    },
    onExplore: () => {
      void goToWorld();
    },
    onSignOut: () => goToAuth(),
  });

  setupHud(cemetery, {
    onBack: () => {
      void goToMenu();
    },
    onColleagueAdded: () => {
      /* la tombe est déjà ajoutée à la scène ; rien d'autre à faire ici */
    },
  });

  try {
    const user = await getCurrentUser();
    const graveId = new URLSearchParams(window.location.search).get("grave");
    if (user) {
      setMenuUser(user);
      cemetery.setVisitorName(user.name);
      if (graveId) {
        await enterCemeteryByGrave(graveId);
      } else {
        await goToMenu();
      }
    } else {
      goToAuth();
    }
  } catch {
    goToAuth();
  } finally {
    loader.classList.add("hidden");
  }
}
