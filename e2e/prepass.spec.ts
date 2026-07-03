import { test, expect, type Page } from "@playwright/test";
import {
  assertPerf, captureCanvas, harnessUrl, poseToString, waitForReady, type CamPose, type PerfSnapshot,
} from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";

// A/B `?prepass=0|1` (mission 12, web/src/scene/vegPrepass.ts) : deux cadrages —
// "prairie" (herbe dense, grassField.ts) et "forêt dense" (cartes de feuillage
// superposées, trees/foliageCards.ts) — chacun vérifié pour (a) l'équivalence
// pixel EXACTE (le prepass ne doit JAMAIS changer le rendu) et (b) un gain de
// perf mesurable (fps ≥, cf. plan/12-depth-prepass.md § critères).

const VIEWPORT = { width: 480, height: 320 }; // petit cadre → capture/attente rapides sous swiftshader

// "très petit seuil" (spec) : tolère le feathering `alphaToCoverage` des cartes
// aux quelques pixels de bord (le prepass y applique un cutoff dur, la couleur
// une transition douce — écart intrinsèque et minime à la technique du
// z-prepass combiné à alphaToCoverage, pas une régression).
const PIXEL_EQUIV_THRESHOLD = 0.01;

// Marge anti-bruit de mesure (fps moyennée sur une fenêtre glissante, cf.
// installHarnessHooks/installDemoPerfHooks) : le prepass doit rester dans ce
// plancher du fps sans prepass, pas strictement identique frame à frame.
const FPS_NOISE_TOLERANCE = 0.9;

// --- Cadrage "prairie" : même harnais que grass.spec.ts (?testCluster=, main.ts) ---
const GRASS_CAM: CamPose = { x: 3, y: 1.3, z: 1, yaw: 0.4, pitch: -0.55 };
const GRASS_BASE = "/?testCluster=42";
const GRASS_SEED = 1;

// --- Cadrage "forêt dense" : harnais hero isolé (mission 09, tree-cards.spec.ts)
// en mode "cards", caméra tirée dans la couronne (crownRadiusXZ=3.4, BEECH_SPECIES,
// skeleton.ts) pour maximiser le chevauchement de cartes croisées — même profil
// d'overdraw qu'un sous-bois dense. Un seul arbre (mountTreeHeroScene n'en pose
// qu'un, cf. treeBuilder.ts) : hors partition de cette mission, pas de scène
// multi-arbres dédiée ici (voir tree-cards.spec.ts pour le même détour de route).
const FOREST_PATH = "/__prepass-forest-harness__";
const FOREST_ROUTE_PATTERN = "**/__prepass-forest-harness__**";
const FOREST_MODULE_PATH = "/src/scene/trees/treeBuilder.ts";
const FOREST_CAM: CamPose = { x: 0, y: 3, z: 4.2, yaw: Math.PI, pitch: -0.02 };
const FOREST_SEED = 1;

function withPrepass(url: string, prepass: 0 | 1): string {
  return `${url}${url.includes("?") ? "&" : "?"}prepass=${prepass}`;
}

function forestHtml(): string {
  return `<!doctype html>
<html>
<body style="margin:0;overflow:hidden;background:#000">
<script type="module">
  import { mountTreeHeroScene } from "${FOREST_MODULE_PATH}";
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  document.body.appendChild(canvas);
  const params = new URLSearchParams(location.search);
  mountTreeHeroScene(canvas, {
    seed: Number(params.get("seed") ?? "1"),
    camPose: params.get("cam") ?? undefined,
    foliageMode: "cards",
  });
</script>
</body>
</html>`;
}

async function routeForest(page: Page): Promise<void> {
  await page.route(FOREST_ROUTE_PATTERN, (route) =>
    route.fulfill({ contentType: "text/html", body: forestHtml() }));
}

function forestUrl(prepass: 0 | 1): string {
  const params = new URLSearchParams({ cam: poseToString(FOREST_CAM), seed: String(FOREST_SEED) });
  return withPrepass(`${FOREST_PATH}?${params.toString()}`, prepass);
}

async function gotoGrass(page: Page, prepass: 0 | 1): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(withPrepass(harnessUrl(GRASS_BASE, { cam: GRASS_CAM, seed: GRASS_SEED }), prepass));
  await waitForReady(page);
}

async function gotoForest(page: Page, prepass: 0 | 1): Promise<void> {
  await routeForest(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(forestUrl(prepass));
  await waitForReady(page);
}

async function readPerf(page: Page): Promise<PerfSnapshot> {
  return assertPerf(page, {}); // budget vide : lève seulement si window.__perf est absent
}

// --- Correction : image pixel-équivalente prepass=0 vs prepass=1 --------------

test("prairie : ?prepass=0 vs ?prepass=1 → image pixel-équivalente", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoGrass(page, 0);
  const off = await captureCanvas(page);
  const pageOn = await page.context().newPage();
  await gotoGrass(pageOn, 1);
  const on = await captureCanvas(pageOn);
  await pageOn.close();

  const { diffRatio } = compare(off, on);
  expect(diffRatio).toBeLessThan(PIXEL_EQUIV_THRESHOLD);
});

test("forêt dense : ?prepass=0 vs ?prepass=1 → image pixel-équivalente", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoForest(page, 0);
  const off = await captureCanvas(page);
  const pageOn = await page.context().newPage();
  await gotoForest(pageOn, 1);
  const on = await captureCanvas(pageOn);
  await pageOn.close();

  const { diffRatio } = compare(off, on);
  expect(diffRatio).toBeLessThan(PIXEL_EQUIV_THRESHOLD);
});

// --- Gain : fps(prepass=1) >= fps(prepass=0) (à la marge de bruit près) -------

test("prairie : gain perf mesurable avec le prepass", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoGrass(page, 0);
  const perfOff = await readPerf(page);
  await gotoGrass(page, 1);
  const perfOn = await readPerf(page);

  expect(perfOn.fps).toBeGreaterThanOrEqual(perfOff.fps * FPS_NOISE_TOLERANCE);
});

test("forêt dense : gain perf mesurable avec le prepass", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoForest(page, 0);
  const perfOff = await readPerf(page);
  await gotoForest(page, 1);
  const perfOn = await readPerf(page);

  expect(perfOn.fps).toBeGreaterThanOrEqual(perfOff.fps * FPS_NOISE_TOLERANCE);
});

// --- Déterminisme : le flag ne casse pas la reproductibilité par graine -------

test("déterminisme : ?prepass=1 sur deux runs même seed/cam → PNG identiques (prairie)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [pageA, pageB] = [await ctxA.newPage(), await ctxB.newPage()];
    await Promise.all([gotoGrass(pageA, 1), gotoGrass(pageB, 1)]);
    const [shotA, shotB] = await Promise.all([captureCanvas(pageA), captureCanvas(pageB)]);
    expect(compare(shotA, shotB).diffRatio).toBe(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
