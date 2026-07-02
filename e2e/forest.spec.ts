import { test, expect, type Page } from "@playwright/test";
import { assertPerf, harnessUrl, shotAndDiff, waitForReady, type CamPose } from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";
import { decodePng, type DecodedPng } from "./png.ts";

// Forêt procédurale + chaîne LOD complète (mission 10) — même détour de
// routage que tree-hero.spec.ts/tree-cards.spec.ts : URL FACTICE jamais
// servie côté serveur, remplacée par une page HTML inline qui importe
// directement `mountForestDemoScene` (le vrai serveur Vite résout ensuite ses
// imports "three" normalement). Nécessaire car ce fichier ne peut toucher à
// main.ts/cemetery.ts/worldStreamer.ts (partition de la mission 10 — le flag
// PROCEDURAL_TREES_ENABLED de vegetation.ts reste éteint par défaut).
const FOREST_PATH = "/__forest-harness__";
const FOREST_ROUTE_PATTERN = "**/__forest-harness__**";
const FOREST_MODULE_PATH = "/src/scene/trees/forestDemo.ts";
const VIEWPORT = { width: 480, height: 360 };
const SEED = 1;

// Caméra au bord du disque de placement (rayon 200 m, cf. forestDemo.ts),
// regardant vers le centre : la scène « forêt à l'horizon » visée par la
// mission — hero proches, cards à mi-distance, impostors au loin, canopy
// shell à l'horizon. yaw=0 à z>0 regarde vers -Z (vers le centre), vérifié
// empiriquement sur THREE.PerspectiveCamera (ordre "YXZ").
const FOREST_HERO_CAM: CamPose = { x: 0, y: 1.8, z: 185, yaw: 0, pitch: -0.05 };

// assertPerf({ maxDrawCalls: 200, minFps: 55 }) — valeurs MESURABLES imposées
// par plan/10-arbres-lod-impostors.md (§ Critères d'acceptation > e2e > perf).
const FOREST_MAX_DRAW_CALLS = 200;
const FOREST_MIN_FPS = 55;
// Budget triangles généreux mais significatif : un hero coûte ≤ 20 000 tris
// (HERO_TRIANGLE_BUDGET, tree-hero.spec.ts), un arbre en cartes ≤ 4 000
// (CARDS_TREE_TRIANGLE_BUDGET, tree-cards.spec.ts). Au plus 6 hero simultanés
// (MAX_HERO_INSTANCES, treeLod.ts) + quelques centaines de cartes → très
// en-deçà de l'alternative « tout en hero » (500 arbres × 20 000 ≈ 10M tris).
const FOREST_TRIANGLE_BUDGET = 1_000_000;

// Fenêtre de balayage de la frontière cards R2 → impostor (test anti-pop) :
// caméra fixe au-dessus de l'origine, un seul arbre AUSSI à l'origine — le
// ratio de pixels différents entre deux pas adjacents doit rester petit (le
// crossfade dither, cf. distanceLod.ts, lisse la transition pixel par pixel).
const ANTI_POP_SWEEP_FACTORS: readonly number[] = [-1.2, -0.6, 0, 0.6, 1.2];
const ANTI_POP_DIFF_THRESHOLD = 0.02;
const SINGLE_TREE_CAM_BASE = { x: 0, y: 1.8, yaw: 0, pitch: -0.05 } as const;

type ForestHarnessWindow = Window & {
  __forest?: { tierCounts(): { hero: number; cardsR1: number; cardsR2: number; impostor: number } };
};

function forestHtml(): string {
  return `<!doctype html>
<html>
<body style="margin:0;overflow:hidden;background:#000">
<script type="module">
  import { mountForestDemoScene } from "${FOREST_MODULE_PATH}";
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  document.body.appendChild(canvas);
  const params = new URLSearchParams(location.search);
  window.__forest = mountForestDemoScene(canvas, {
    seed: Number(params.get("seed") ?? "1"),
    camPose: params.get("cam") ?? undefined,
    treeCount: params.has("treeCount") ? Number(params.get("treeCount")) : undefined,
    radius: params.has("radius") ? Number(params.get("radius")) : undefined,
    single: params.get("single") === "1",
  });
</script>
</body>
</html>`;
}

/** Intercepte UNIQUEMENT la navigation vers `FOREST_PATH` (jamais les imports
 *  de modules qui suivent, servis normalement par Vite). */
async function routeForest(page: Page): Promise<void> {
  await page.route(FOREST_ROUTE_PATTERN, (route) =>
    route.fulfill({ contentType: "text/html", body: forestHtml() }));
}

async function bootForest(page: Page, cam: CamPose, extraQuery = ""): Promise<void> {
  await routeForest(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${harnessUrl(FOREST_PATH, { cam, seed: SEED })}${extraQuery}`);
  await waitForReady(page);
}

async function bootSingleTree(page: Page, camZ: number): Promise<DecodedPng> {
  await bootForest(page, { ...SINGLE_TREE_CAM_BASE, z: camZ }, "&single=1");
  const dataUrl = await page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

test("forêt dense au forest-hero — diff vs baseline", async ({ page }) => {
  test.setTimeout(60_000);
  await routeForest(page);
  await page.setViewportSize(VIEWPORT);
  await shotAndDiff(page, FOREST_PATH, { cam: FOREST_HERO_CAM, seed: SEED }, "forest-hero.png");
});

test("impostors lointains : majorité des arbres visibles, drawCalls/triangles/fps bornés", async ({ page }) => {
  test.setTimeout(60_000);
  await bootForest(page, FOREST_HERO_CAM);

  const perf = await assertPerf(page, { maxDrawCalls: FOREST_MAX_DRAW_CALLS, minFps: FOREST_MIN_FPS });
  expect(perf.triangles).toBeLessThan(FOREST_TRIANGLE_BUDGET);

  const tiers = await page.evaluate(() => (window as ForestHarnessWindow).__forest!.tierCounts());
  const detailedInstances = tiers.hero + tiers.cardsR1 + tiers.cardsR2;
  expect(tiers.impostor).toBeGreaterThan(detailedInstances);
  console.log(
    `forest-hero: drawCalls=${perf.drawCalls} triangles=${perf.triangles} fps=${perf.fps.toFixed(1)} tiers=${JSON.stringify(tiers)}`,
  );
});

test("anti-pop : traversée de la frontière cards R2 → impostor sans saut visuel", async ({ page }) => {
  test.setTimeout(90_000);
  // Contexte de page nécessaire avant un import ESM dynamique dans page.evaluate
  // (même détour que grass-ring.spec.ts) — résolu ensuite par le vrai serveur Vite.
  await page.goto("/");
  const { threshold, hysteresis } = await page.evaluate(async () => {
    const m = await import("/src/scene/trees/treeLod.ts");
    return { threshold: m.TREE_LOD_THRESHOLDS[2], hysteresis: m.TREE_LOD_HYSTERESIS };
  });

  const sweep = ANTI_POP_SWEEP_FACTORS.map((f) => threshold + f * hysteresis);
  const frames: DecodedPng[] = [];
  for (const camZ of sweep) frames.push(await bootSingleTree(page, camZ));

  for (let i = 1; i < frames.length; i++) {
    const { diffRatio } = compare(frames[i], frames[i - 1]);
    expect(diffRatio).toBeLessThan(ANTI_POP_DIFF_THRESHOLD);
  }
});

test("déterminisme : même seed → PNG identiques (deux contextes)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [pageA, pageB] = [await ctxA.newPage(), await ctxB.newPage()];
    await Promise.all([bootForest(pageA, FOREST_HERO_CAM), bootForest(pageB, FOREST_HERO_CAM)]);
    const [shotA, shotB] = await Promise.all([
      pageA.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png")),
      pageB.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png")),
    ]);
    expect(shotA).toBe(shotB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
