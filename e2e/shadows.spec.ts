import { test, expect, type Page } from "@playwright/test";
import { sampleShadowChroma } from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";
import { decodePng, type DecodedPng } from "./png.ts";

// Qualité des ombres (mission 13, `web/src/scene/shadows.ts`) — isolé dans un canvas
// dédié via import ESM direct servi par le dev server Vite, SANS passer par
// main.ts/cemetery.ts/l'auth/la DB (câblage complet du rig CSM différé à l'intégration,
// derrière `CSM_SHADOWS_ENABLED`, voir plan/13-ombres.md). Même stratégie que
// e2e/gravestone.spec.ts (mission 06) et e2e/grass-ring.spec.ts (mission 05).
const VIEWPORT = { width: 400, height: 300 };

// -- Scène « golden hour, tombe sous arbre » (chroma) --
const GOLDEN_SUN_COLOR = 0xff8a5c; // teinte chaude (proche du profil "dusk", ambiance.ts)
const GOLDEN_SUN_INTENSITY = 1.4;
const GOLDEN_AMBIENT_COLOR = 0x5a4f66; // teinte froide-violine (bounce), pas un gris neutre
// Volontairement SOUS le plancher (`SHADOW_AMBIENT_FLOOR`) pour exercer réellement le
// clamp anti-ombre-noire au lieu de simplement passer une valeur déjà sûre.
const GOLDEN_AMBIENT_RAW_INTENSITY = 0.04;
const SUN_DIR: readonly [number, number, number] = [0.6, 0.35, 0.4];
const SUN_DISTANCE = 20;
// Un pixel compte "assombri par l'ombre" si sa luminance chute d'au moins ceci (0..255)
// entre le rendu SANS occludeur (référence éclairée) et AVEC occludeur.
const SHADOW_DARKENING_MIN = 25;
const CHROMA_MIN_THRESHOLD = 0.03; // chroma mini attendue dans l'ombre (pas de noir plat)

// -- Scène « bord d'ombre connu » (douceur PCSS) --
const PCSS_CASCADE_COUNT = 4;
const PENUMBRA_BAND_LOW = 0.2; // borne basse de la bande de transition (fraction lit↔ombre)
const PENUMBRA_BAND_HIGH = 0.8;

// -- Perf cache de cascades on/off --
const SHADOW_MAP_SIZE = 2048;
const OCCLUDER_ROWS = 8; // grille d'occludeurs : shadow pass non-trivial (fill-rate) sous swiftshader
const OCCLUDER_COLS = 8;
const MOVE_FRAMES = 12; // frames où la cible caméra "bouge" (texel snap simulé)
const SETTLE_FRAMES = 28; // frames statiques ensuite : laisse le cache de cascades se stabiliser
const PERF_FRAMES = MOVE_FRAMES + SETTLE_FRAMES;
const CACHE_VS_NOCACHE_DIFF_THRESHOLD = 0.01; // une fois stabilisés, doivent converger vers la même image

async function bootBlankPage(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  // "/" sert uniquement à activer le dev server Vite (résolution des imports ESM) —
  // aucun effet de bord d'auth/API utilisé ensuite (cf. e2e/gravestone.spec.ts).
  await page.goto("/");
}

function luminance(data: Uint8Array, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** Pixels RGBA (aplatis) de `shadowed` significativement plus sombres que dans `lit` —
 *  robuste au cadrage exact (pas besoin de connaître la géométrie écran de l'ombre). */
function darkenedPixels(lit: DecodedPng, shadowed: DecodedPng): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < lit.data.length; i += 4) {
    if (luminance(lit.data, i) - luminance(shadowed.data, i) >= SHADOW_DARKENING_MIN) {
      out.push(shadowed.data[i], shadowed.data[i + 1], shadowed.data[i + 2], shadowed.data[i + 3]);
    }
  }
  return Uint8Array.from(out);
}

/** Nombre de pixels d'une ligne de balayage dont la luminance tombe dans la bande de
 *  transition [20%, 80%] entre le niveau ombré et le niveau éclairé de cette même ligne —
 *  mesure la largeur de pénombre sans connaître la position écran exacte du bord. */
function penumbraBandWidth(img: DecodedPng, row: number): number {
  const lums: number[] = [];
  for (let x = 0; x < img.width; x++) lums.push(luminance(img.data, (row * img.width + x) * 4));
  const lit = Math.max(...lums);
  const shadow = Math.min(...lums);
  const lo = shadow + PENUMBRA_BAND_LOW * (lit - shadow);
  const hi = shadow + PENUMBRA_BAND_HIGH * (lit - shadow);
  return lums.filter((l) => l > lo && l < hi).length;
}

function decode(dataUrl: string): DecodedPng {
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

/** Scène minimale « tombe sous canopée » : sol + tombe (stand-in) + occludeur optionnel
 *  (canopée), soleil chaud + ambiante colorée passée au plancher anti-ombre-noire. */
async function renderGoldenHourScene(page: Page, occluderPresent: boolean): Promise<string> {
  return page.evaluate(async ({
    occluderPresent, width, height, sunColor, sunIntensity, ambientColor, ambientRawIntensity, sunDir, sunDistance,
  }) => {
    const THREE = await import("three");
    const { clampAmbientFloor } = await import("/src/scene/shadows.ts");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 2.8);
    camera.lookAt(0, 0.6, 0);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x556655, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const tombe = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.9 }),
    );
    tombe.position.set(0, 0.5, 0);
    tombe.receiveShadow = true;
    tombe.castShadow = true;
    scene.add(tombe);

    const dir = new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();
    if (occluderPresent) {
      // Place la canopée sur le rayon (directionnel, donc parallèle) qui retombe
      // exactement sur la tombe : évite de deviner une position à la main (cf.
      // e2e/shadows.spec.ts § golden hour pour la dérivation).
      const canopyHeight = 4;
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.4, 6),
        new THREE.MeshStandardMaterial({ color: 0x2c3d22, roughness: 1 }),
      );
      canopy.position.set((canopyHeight / dir.y) * dir.x, canopyHeight, (canopyHeight / dir.y) * dir.z);
      canopy.castShadow = true;
      scene.add(canopy);
    }

    const ambient = new THREE.AmbientLight(ambientColor, clampAmbientFloor(ambientRawIntensity));
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
    sun.position.set(sunDir[0] * sunDistance, sunDir[1] * sunDistance, sunDir[2] * sunDistance);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -10; cam.right = 10; cam.top = 10; cam.bottom = -10;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  }, {
    occluderPresent, width: VIEWPORT.width, height: VIEWPORT.height,
    sunColor: GOLDEN_SUN_COLOR, sunIntensity: GOLDEN_SUN_INTENSITY, ambientColor: GOLDEN_AMBIENT_COLOR,
    ambientRawIntensity: GOLDEN_AMBIENT_RAW_INTENSITY, sunDir: SUN_DIR, sunDistance: SUN_DISTANCE,
  });
}

/** Scène « bord d'ombre » : occludeur couvrant la moitié d'un grand sol, caméra en
 *  plongée cadrant la transition lit→ombre — pour mesurer la largeur de pénombre. */
async function renderPenumbraEdgeScene(page: Page, shadowRadius: number): Promise<string> {
  return page.evaluate(async ({ shadowRadius, width, height }) => {
    const THREE = await import("three");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-6, 6, 4.5, -4.5, 0.1, 50);
    camera.position.set(0, 8, 0.01);
    camera.lookAt(0, 0, 0);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Occludeur haut, décalé : projette un bord d'ombre net traversant le cadre caméra.
    const occluder = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 20),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    occluder.position.set(-10, 6, 0);
    occluder.castShadow = true;
    scene.add(occluder);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-2, 12, 0); // quasi zénithal, léger tilt → bord net et prévisible
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -15; cam.right = 15; cam.top = 15; cam.bottom = -15;
    sun.shadow.radius = shadowRadius;
    scene.add(sun, sun.target);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  }, { shadowRadius, width: VIEWPORT.width, height: VIEWPORT.height });
}

test.describe("qualité des ombres (mission 13) — CSM/PCSS/cache", () => {
  test("golden hour, tombe sous canopée : l'ombre garde de la chroma (pas de noir plat)", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    const lit = decode(await renderGoldenHourScene(page, false));
    const shadowed = decode(await renderGoldenHourScene(page, true));

    const shadowPixels = darkenedPixels(lit, shadowed);
    expect(shadowPixels.length).toBeGreaterThan(0); // l'occludeur a bien assombri quelque chose
    expect(sampleShadowChroma(shadowPixels)).toBeGreaterThan(CHROMA_MIN_THRESHOLD);
  });

  test("douceur : une cascade lointaine (rayon PCSS plus large) élargit la pénombre", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    const radii = await page.evaluate(async (cascades) => {
      const { computeCascadePcssRadius } = await import("/src/scene/shadows.ts");
      return [computeCascadePcssRadius(0, cascades), computeCascadePcssRadius(cascades - 1, cascades)];
    }, PCSS_CASCADE_COUNT);
    const [narrowRadius, wideRadius] = radii;
    expect(wideRadius).toBeGreaterThan(narrowRadius);

    const narrowImg = decode(await renderPenumbraEdgeScene(page, narrowRadius));
    const wideImg = decode(await renderPenumbraEdgeScene(page, wideRadius));
    const midRow = Math.floor(VIEWPORT.height / 2);
    const narrowBand = penumbraBandWidth(narrowImg, midRow);
    const wideBand = penumbraBandWidth(wideImg, midRow);
    expect(wideBand).toBeGreaterThan(narrowBand);
  });

  test("perf : le cache de cascades tient un fps ≥ à un refresh systématique, image identique une fois stable", async ({ page }) => {
    test.setTimeout(60_000);
    await bootBlankPage(page);

    const run = async (cacheEnabled: boolean) => page.evaluate(async ({ cacheEnabled, width, height, mapSize, rows, cols, frames, moveFrames }) => {
      const THREE = await import("three");
      const { CascadeShadowCache } = await import("/src/scene/shadows.ts");

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      document.body.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
      camera.position.set(0, 14, 14);
      camera.lookAt(0, 0, 0);

      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x556655 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // Grille d'occludeurs : gonfle le coût du passage d'ombre (fill-rate, mapSize élevé)
      // pour que sauter des re-rendus ait un effet mesurable sous swiftshader (logiciel).
      const boxGeom = new THREE.BoxGeometry(0.6, 1.4, 0.6);
      const boxMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92 });
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const box = new THREE.Mesh(boxGeom, boxMat);
          box.position.set((c - cols / 2) * 2, 0.7, (r - rows / 2) * 2);
          box.castShadow = true;
          box.receiveShadow = true;
          scene.add(box);
        }
      }

      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(10, 20, 8);
      sun.castShadow = true;
      sun.shadow.mapSize.set(mapSize, mapSize);
      const shadowCam = sun.shadow.camera as THREE.OrthographicCamera;
      shadowCam.near = 1; shadowCam.far = 60;
      shadowCam.left = -20; shadowCam.right = 20; shadowCam.top = 20; shadowCam.bottom = -20;
      scene.add(sun, sun.target);
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));

      const cache = new CascadeShadowCache();
      const sunDir: [number, number, number] = [0, 1, 0];

      const deltas: number[] = [];
      let last = performance.now();
      for (let f = 0; f < frames; f++) {
        // Simule le suivi caméra (cible qui change de texel) pendant MOVE_FRAMES, puis se
        // stabilise (SETTLE_FRAMES) — même scénario pour cache on/off. Un dernier "tick"
        // forcé à la toute dernière frame (comme un prochain mouvement de caméra, même
        // minime) laisse le cache rattraper la position finale avant la capture, sans quoi
        // il resterait figé sur la dernière fenêtre de rafraîchissement franchie pendant le
        // mouvement — cf. shadows.test.ts (CascadeShadowCache ne rafraîchit jamais sans
        // demande, par construction).
        const moving = f < moveFrames;
        const requested = moving || f === frames - 1;
        if (moving) sun.target.position.x = f * 0.01;
        if (cacheEnabled) {
          if (cache.shouldRefresh(requested, sunDir)) renderer.shadowMap.needsUpdate = true;
        } else if (requested) {
          renderer.shadowMap.needsUpdate = true;
        }
        renderer.render(scene, camera);
        const now = performance.now();
        deltas.push(now - last);
        last = now;
      }
      const avgMs = deltas.slice(1).reduce((s, d) => s + d, 0) / (deltas.length - 1); // ignore la 1ère frame (compilation shader)
      const fps = avgMs > 0 ? 1000 / avgMs : 0;
      return { fps, dataUrl: canvas.toDataURL("image/png") };
    }, {
      cacheEnabled, width: VIEWPORT.width, height: VIEWPORT.height, mapSize: SHADOW_MAP_SIZE,
      rows: OCCLUDER_ROWS, cols: OCCLUDER_COLS, frames: PERF_FRAMES, moveFrames: MOVE_FRAMES,
    });

    const off = await run(false);
    const on = await run(true);

    expect(on.fps).toBeGreaterThanOrEqual(off.fps);

    const diff = compare(decode(on.dataUrl), decode(off.dataUrl));
    expect(diff.diffRatio).toBeLessThan(CACHE_VS_NOCACHE_DIFF_THRESHOLD);
  });
});
