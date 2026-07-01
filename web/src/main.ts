import * as THREE from "three";
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

  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Rendu filmique + exposition basse → sous-bois sombre (cible meanLum ≈ 0.15).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;

  const scene = new THREE.Scene();
  // Trouée claire au fond de la voûte + brume sombre qui fond et assombrit les bords.
  scene.background = new THREE.Color(0xaebfa0);
  scene.fog = new THREE.FogExp2(0x3b4632, 0.05);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
  // Œil 1,7 m au débouché de l'allée, regardant le centre de la clairière (~9 m).
  camera.position.set(0, 1.7, 0.5);
  camera.lookAt(0, 1.4, 9);

  // Sous-bois sombre : ambiante très basse, hémisphérique douce, rai de soleil
  // chaud plongeant par la trouée du fond (contre-jour + ombres portées).
  scene.add(new THREE.AmbientLight(0x8092a0, 0.18));
  scene.add(new THREE.HemisphereLight(0xbcd0e0, 0x243018, 0.35));
  const sun = new THREE.DirectionalLight(0xffe2a8, 2.4);
  sun.position.set(-5, 18, 22); // haut, au fond → contre-jour à travers les arbres
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x24331b, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Clairière au centre, à ~9 m devant la caméra.
  const cluster: ClusterInfo = { x: 0, z: 9, chunk: 0, propKind: "tree" };
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

  // Herbe haute couvrant la clairière, sauf le disque de terre central.
  const grass = await GrassField.create(
    "test-company", 2, frame, 24, 20, 0, 20, undefined,
    { x: cluster.x, z: cluster.z, r: EARTH_RADIUS },
  );
  if (grass) scene.add(grass.mesh);

  document.body.dataset.ready = "cluster";

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    grass?.update(clock.getElapsedTime());
    renderer.render(scene, camera);
  });
}

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
