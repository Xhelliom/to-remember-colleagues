import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { getColleagues, getCompanies, getCurrentUser, getColleagueById } from "./api.ts";
import { Cemetery } from "./cemetery.ts";
import { hideAuth, setupAuth, showAuth } from "./ui/auth.ts";
import { hideMenu, refreshMenu, setMenuUser, setupMenu, showMenu } from "./ui/menu.ts";
import { hideHud, setupHud, showWorldHud } from "./ui/hud.ts";
import { buildClusterBiome, graveAnchors, EARTH_RADIUS } from "./scene/clusterBiome.ts";
import { GrassField } from "./scene/grassField.ts";
import type { ClusterInfo } from "./procedural.ts";
import type { Frame } from "./worldLayout.ts";

const loader = document.getElementById("loader") as HTMLDivElement;
const canvas = document.getElementById("scene") as HTMLCanvasElement;

// Bypass complet du routing pour l'itération visuelle du biome de cluster.
// Usage : ?testCluster=42  (la valeur est un seed pour de futures variations)
const testClusterSeed = new URLSearchParams(window.location.search).get("testCluster");
if (testClusterSeed !== null) {
  void runClusterTest(canvas);
} else {
  void startApp();
}

/** Scène de test isolée : 1 cluster, caméra fixe — pas de Cemetery, pas d'auth. */
async function runClusterTest(c: HTMLCanvasElement) {
  loader.classList.add("hidden");

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

  // Contraste concept : canopée/bords sombres, MAIS flaque de lumière chaude sur
  // le sol de la clairière (soleil plongeant de l'avant vers le centre + graves).
  scene.add(new THREE.AmbientLight(0x7a7060, 0.16)); // légère chaleur → lève la terre
  scene.add(new THREE.HemisphereLight(0x9fb2c0, 0x221c12, 0.24));
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
  const biome = await buildClusterBiome(cluster, frame, undefined, "test-company");
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
    "test-company", 2, frame, 16, 16, 0, 16, undefined,
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
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(GRADE_SHADER));

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    grass?.update(clock.getElapsedTime());
    composer.render();
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
