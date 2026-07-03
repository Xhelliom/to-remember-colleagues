import { test, expect, type Page } from "@playwright/test";
import { assertPerf } from "./helpers/harness.ts";
import { decodePng, type DecodedPng } from "./png.ts";
import { compare } from "../tools/compare.ts";

// Anneau d'herbe centré caméra (mission 05, web/src/scene/grassRing.ts) — isolé dans un
// canvas dédié via import ESM direct servi par le dev server Vite, SANS passer par
// main.ts/worldStreamer.ts/l'auth/la DB : le flag GRASS_RING_ENABLED de worldStreamer.ts
// reste éteint par défaut (câblage complet différé à l'intégration, cf. plan/05-*.md).
// Même stratégie que e2e/gravestone.spec.ts (mission 06) et e2e/tree-hero.spec.ts (08).
const VIEWPORT = { width: 480, height: 360 };
// Hauteur de caméra en vue plongeante quasi-zénithale : cadre approximativement la bande
// proche (RING_BAND_NEAR_OUTER ≈ 14 m) avec un FOV de 60° — cf. initRingHarness.
const TOPDOWN_HEIGHT = 24;
const NARROW_HEIGHT = 10; // cadrage plus serré pour le test anti-pop (zone de transition)
const ADVANCE_METERS = 20; // "avancer de N m" — traverse plusieurs cellules de la grille
const NEAR_COVERAGE_MIN = 0.15; // fraction mini de pixels "herbe" attendue en vue plongeante
const ANTI_POP_DIFF_THRESHOLD = 0.03; // ratio de pixels différents toléré entre 2 pas adjacents
const PERF_FRAME_SAMPLES = 30;
const TRAVERSAL_STEPS = 24;
const TRAVERSAL_STEP_METERS = 3; // m par pas — franchit plusieurs cellules + bandes de LOD
const TRAVERSAL_MIN_FPS = 30; // seuil permissif : pire frame isolée, pas la moyenne

/** État partagé entre plusieurs `page.evaluate()` (pas de re-création par frame). */
type RingHarnessWindow = Window & {
  __ringHarness?: {
    ring: {
      update: (x: number, z: number, heightAt: (x: number, z: number) => number) => void;
      dispose: () => void;
      group: { children: { count: number }[] };
    };
    renderer: {
      render: (scene: unknown, camera: unknown) => void;
      domElement: HTMLCanvasElement;
      info: { reset: () => void; render: { calls: number; triangles: number }; programs?: unknown[] };
    };
    camera: { position: { set: (x: number, y: number, z: number) => void }; lookAt: (x: number, y: number, z: number) => void };
    scene: unknown;
  };
  __perf?: unknown;
};

async function bootBlankPage(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  // "/" sert uniquement à activer le dev server Vite (résolution des imports ESM) —
  // aucun effet de bord d'auth/API utilisé ensuite (cf. e2e/gravestone.spec.ts).
  await page.goto("/");
}

/** Construit une scène minimale (sol + lumière + un VRAI `GrassRing`) et la retient sur
 *  `window.__ringHarness` pour les pas suivants. */
async function initRingHarness(page: Page, withGround: boolean = true): Promise<void> {
  await page.evaluate(async ({ withGround, width, height }) => {
    const THREE = await import("three");
    const { GrassRing } = await import("/src/scene/grassRing.ts");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1c140f); // sol nu sombre : contraste net avec l'herbe verte
    if (withGround) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x1c140f }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
    }
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(5, 10, 5);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 200);
    const ring = GrassRing.create();
    scene.add(ring.group);

    (window as RingHarnessWindow).__ringHarness = { renderer, scene, camera, ring };
  }, { withGround, width: VIEWPORT.width, height: VIEWPORT.height });
}

type StepResult = { dataUrl: string; drawCalls: number };

/**
 * Fait suivre l'anneau à (ringX, ringZ) puis rend une frame avec la caméra en vue
 * plongeante centrée sur (viewX, viewZ) — distincts par défaut de (ringX, ringZ) pour
 * pouvoir observer une zone de sol FIXE pendant que la position transmise à l'anneau
 * varie (cf. test anti-pop).
 */
async function stepRing(
  page: Page,
  ringX: number,
  ringZ: number,
  viewX: number = ringX,
  viewZ: number = ringZ,
  height: number = TOPDOWN_HEIGHT,
): Promise<StepResult> {
  return page.evaluate(({ ringX, ringZ, viewX, viewZ, height }) => {
    const h = (window as RingHarnessWindow).__ringHarness!;
    h.ring.update(ringX, ringZ, () => 0);
    h.camera.position.set(viewX, height, viewZ + 0.01);
    h.camera.lookAt(viewX, 0, viewZ);
    h.renderer.info.reset();
    h.renderer.render(h.scene, h.camera);
    return { dataUrl: h.renderer.domElement.toDataURL("image/png"), drawCalls: h.renderer.info.render.calls };
  }, { ringX, ringZ, viewX, viewZ, height });
}

function decode(dataUrl: string): DecodedPng {
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

/** Fraction de pixels « herbe » (canal vert nettement dominant) dans l'image. */
function grassCoverage(img: DecodedPng): number {
  let grassy = 0;
  let total = 0;
  for (let i = 0; i + 2 < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (g > r + 10 && g > b + 10) grassy++;
    total++;
  }
  if (total === 0) throw new Error("image vide");
  return grassy / total;
}

test.describe("anneau d'herbe centré caméra (mission 05)", () => {
  test("l'herbe suit la caméra : couverture bande proche maintenue après avoir avancé", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    await initRingHarness(page);

    const poseA = await stepRing(page, 0, 0);
    const poseB = await stepRing(page, ADVANCE_METERS, ADVANCE_METERS);

    expect(grassCoverage(decode(poseA.dataUrl))).toBeGreaterThanOrEqual(NEAR_COVERAGE_MIN);
    expect(grassCoverage(decode(poseB.dataUrl))).toBeGreaterThanOrEqual(NEAR_COVERAGE_MIN);
  });

  test("anti-pop : pas de saut visuel en traversant un seuil de bande (dither complémentaire)", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    await initRingHarness(page);

    const { nearOuter, hysteresis } = await page.evaluate(async () => {
      const m = await import("/src/scene/grassRing.ts");
      return { nearOuter: m.RING_BAND_NEAR_OUTER, hysteresis: m.RING_HYSTERESIS };
    });

    // Caméra de rendu FIXE à l'origine : on observe la même zone de sol pendant que la
    // position « logique » transmise à l'anneau balaie la fenêtre de transition
    // [seuil-hystérésis, seuil+hystérésis]. Un pop de géométrie (bande proche→moyenne)
    // se verrait comme un grand diff entre deux pas adjacents de ce balayage.
    const sweep = [-1.2, -0.6, 0, 0.6, 1.2].map((f) => nearOuter + f * hysteresis);
    const frames: DecodedPng[] = [];
    for (const ringX of sweep) {
      const res = await stepRing(page, ringX, 0, 0, 0, NARROW_HEIGHT);
      frames.push(decode(res.dataUrl));
    }
    for (let i = 1; i < frames.length; i++) {
      const { diffRatio } = compare(frames[i], frames[i - 1]);
      expect(diffRatio).toBeLessThan(ANTI_POP_DIFF_THRESHOLD);
    }
  });

  test("perf : au plus 3 draw calls (une InstancedMesh par bande) et fps ≥ 55", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    await initRingHarness(page, false); // pas de sol : les draw calls mesurés sont ceux de l'herbe SEULE

    const { drawCalls } = await stepRing(page, 0, 0);
    expect(drawCalls).toBeLessThanOrEqual(3);

    // Alimente `window.__perf` manuellement (ce spec ne passe pas par main.ts, même
    // contrat que le harnais — cf. e2e/gravestone.spec.ts).
    await page.evaluate(({ frames }) => {
      const h = (window as RingHarnessWindow).__ringHarness!;
      const deltas: number[] = [];
      let last = performance.now();
      for (let f = 0; f < frames; f++) {
        h.ring.update(0, 0, () => 0);
        h.renderer.render(h.scene, h.camera);
        const now = performance.now();
        deltas.push(now - last);
        last = now;
      }
      const avgMs = deltas.reduce((s, d) => s + d, 0) / deltas.length;
      (window as RingHarnessWindow).__perf = {
        drawCalls: h.renderer.info.render.calls,
        triangles: h.renderer.info.render.triangles,
        programs: h.renderer.info.programs?.length ?? 0,
        fps: avgMs > 0 ? 1000 / avgMs : 0,
      };
    }, { frames: PERF_FRAME_SAMPLES });

    await assertPerf(page, { maxDrawCalls: 3, minFps: 55 });
  });

  test("pas de spike perf pendant une traversée continue (recyclage de cellules)", async ({ page }) => {
    test.setTimeout(30_000);
    await bootBlankPage(page);
    await initRingHarness(page, false);

    const frameDeltasMs = await page.evaluate(({ steps, stepMeters }) => {
      const h = (window as RingHarnessWindow).__ringHarness!;
      const deltas: number[] = [];
      let last = performance.now();
      for (let i = 0; i < steps; i++) {
        h.ring.update(i * stepMeters, 0, () => 0); // traverse plusieurs cellules + bandes de LOD
        h.renderer.render(h.scene, h.camera);
        const now = performance.now();
        deltas.push(now - last);
        last = now;
      }
      return deltas;
    }, { steps: TRAVERSAL_STEPS, stepMeters: TRAVERSAL_STEP_METERS });

    // Ignore le 1er pas (compilation shader à froid) : on borne la pire frame de régime,
    // pas un artefact de démarrage.
    const worstFrameMs = Math.max(...frameDeltasMs.slice(1));
    const minFps = 1000 / worstFrameMs;
    expect(minFps).toBeGreaterThanOrEqual(TRAVERSAL_MIN_FPS);
  });
});
