import { test, expect, type Page } from "@playwright/test";
import { assertPerf, harnessUrl, poseToString, shotAndDiff, waitForReady, type CamPose } from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";
import { decodePng } from "./png.ts";

// Arbre hero (mission 08) — scène minimale à UN SEUL arbre, jamais atteinte par
// le harnais `?testCluster` de main.ts (aucun arbre monté là). On route donc
// une URL FACTICE (jamais servie côté serveur) vers une page HTML inline qui
// importe directement `mountTreeHeroScene` depuis
// `/src/scene/trees/treeBuilder.ts` : cette requête-là, elle, N'EST PAS
// interceptée et passe par le vrai serveur de dev Vite, qui résout donc
// normalement les imports "three" bare-specifier de treeBuilder.ts. Ce
// détour est nécessaire car la mission 08 ne peut modifier aucun fichier
// partagé (main.ts/cemetery.ts) — voir plan/08-arbres-grammaire.md.
const HERO_PATH = "/__tree-hero-harness__";
const HERO_ROUTE_PATTERN = "**/__tree-hero-harness__**";
const HERO_MODULE_PATH = "/src/scene/trees/treeBuilder.ts";
const CAM: CamPose = { x: 0, y: 1.8, z: 6.5, yaw: Math.PI, pitch: -0.08 };
const VIEWPORT = { width: 480, height: 360 }; // petit cadre → capture/attente rapides sous swiftshader
// Même budget que treeBuilder.test.ts (hero UNIQUE, jamais instancié en masse).
const HERO_TRIANGLE_BUDGET = 20_000;
// Ratio de pixels différents mini entre deux graines (silhouettes doivent diverger).
const SILHOUETTE_DIFF_THRESHOLD = 0.02;

function heroHtml(): string {
  return `<!doctype html>
<html>
<body style="margin:0;overflow:hidden;background:#000">
<script type="module">
  import { mountTreeHeroScene } from "${HERO_MODULE_PATH}";
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  document.body.appendChild(canvas);
  const params = new URLSearchParams(location.search);
  mountTreeHeroScene(canvas, {
    seed: Number(params.get("seed") ?? "1"),
    camPose: params.get("cam") ?? undefined,
  });
</script>
</body>
</html>`;
}

/** Intercepte UNIQUEMENT la navigation vers `HERO_PATH` (jamais les imports de
 *  modules qui suivent, servis normalement par Vite) et la remplace par la
 *  page inline ci-dessus. */
async function routeHero(page: Page): Promise<void> {
  await page.route(HERO_ROUTE_PATTERN, (route) =>
    route.fulfill({ contentType: "text/html", body: heroHtml() }));
}

/** Boot complet + lecture du canvas en dataURL (comparaison directe, comme
 *  `e2e/harness.spec.ts`). */
async function bootHero(page: Page, seed: number): Promise<string> {
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await routeHero(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrl(HERO_PATH, { cam: CAM, seed }));
  await waitForReady(page);
  return page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
}

function dataUrlToDecodedPng(dataUrl: string) {
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

test("arbre hero seed=1 — diff vs baseline < seuil", async ({ page }) => {
  test.setTimeout(60_000);
  await routeHero(page);
  await page.setViewportSize(VIEWPORT);
  await shotAndDiff(page, HERO_PATH, { cam: CAM, seed: 1 }, "tree-hero-seed1.png");
});

test("déterminisme : même seed → PNG identiques (deux contextes)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [shotA, shotB] = await Promise.all([
      bootHero(await ctxA.newPage(), 1),
      bootHero(await ctxB.newPage(), 1),
    ]);
    expect(shotA).toBe(shotB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("deux graines différentes → silhouettes différentes", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [shotA, shotB] = await Promise.all([
      bootHero(await ctxA.newPage(), 1),
      bootHero(await ctxB.newPage(), 2),
    ]);
    const { diffRatio } = compare(dataUrlToDecodedPng(shotA), dataUrlToDecodedPng(shotB));
    expect(diffRatio).toBeGreaterThan(SILHOUETTE_DIFF_THRESHOLD);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("perf : un seul hero visible → fps ≥ 55, tri-budget hero respecté", async ({ page }) => {
  test.setTimeout(60_000);
  await routeHero(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrl(HERO_PATH, { cam: CAM, seed: 1 }));
  await waitForReady(page);
  const perf = await assertPerf(page, { minFps: 55 });
  expect(perf.triangles).toBeLessThan(HERO_TRIANGLE_BUDGET);
  console.log(`hero: ${poseToString(CAM)} — drawCalls=${perf.drawCalls} triangles=${perf.triangles} fps=${perf.fps.toFixed(1)}`);
});
