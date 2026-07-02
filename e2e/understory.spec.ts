import { test, expect, type Page } from "@playwright/test";
import { assertPerf, harnessUrl, poseToString, shotAndDiff, waitForReady, type CamPose } from "./helpers/harness.ts";

// Strate understory (mission 11) — arbre hero + fougères/arbustes/fleurs dispersés sous sa
// couronne (scene/trees/understory.ts, `mountUnderstoryDemoScene`). Même détour d'URL factice
// que tree-hero.spec.ts (jamais servie par le vrai serveur) : la mission ne peut modifier aucun
// fichier partagé (main.ts/worldStreamer.ts), voir plan/11-understory.md.
const UNDERSTORY_PATH = "/__understory-harness__";
const UNDERSTORY_ROUTE_PATTERN = "**/__understory-harness__**";
const UNDERSTORY_MODULE_PATH = "/src/scene/trees/understory.ts";
// Cadrage sous-bois : caméra basse, inclinée vers le sol pour cadrer la strate intermédiaire
// (le défaut de mountUnderstoryDemoScene) plutôt que la seule silhouette de l'arbre.
const CAM: CamPose = { x: 0, y: 2.1, z: 5.2, yaw: Math.PI, pitch: -0.28 };
const VIEWPORT = { width: 480, height: 360 }; // petit cadre → capture/attente rapides sous swiftshader
const UNDERSTORY_SEED = 1;

function understoryHtml(): string {
  return `<!doctype html>
<html>
<body style="margin:0;overflow:hidden;background:#000">
<script type="module">
  import { mountUnderstoryDemoScene } from "${UNDERSTORY_MODULE_PATH}";
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  document.body.appendChild(canvas);
  const params = new URLSearchParams(location.search);
  mountUnderstoryDemoScene(canvas, {
    seed: Number(params.get("seed") ?? "1"),
    camPose: params.get("cam") ?? undefined,
  });
</script>
</body>
</html>`;
}

/** Intercepte UNIQUEMENT la navigation vers `UNDERSTORY_PATH` (jamais les imports de modules
 *  qui suivent, servis normalement par Vite) et la remplace par la page inline ci-dessus. */
async function routeUnderstory(page: Page): Promise<void> {
  await page.route(UNDERSTORY_ROUTE_PATTERN, (route) =>
    route.fulfill({ contentType: "text/html", body: understoryHtml() }));
}

async function bootUnderstory(page: Page, seed: number): Promise<string> {
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await routeUnderstory(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrl(UNDERSTORY_PATH, { cam: CAM, seed }));
  await waitForReady(page);
  return page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
}

test("understory visible sous les arbres — diff vs baseline < seuil", async ({ page }) => {
  test.setTimeout(60_000);
  await routeUnderstory(page);
  await page.setViewportSize(VIEWPORT);
  await shotAndDiff(page, UNDERSTORY_PATH, { cam: CAM, seed: UNDERSTORY_SEED }, "understory-seed1.png");
});

test("déterminisme : même seed → PNG identiques (deux contextes)", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [shotA, shotB] = await Promise.all([
      bootUnderstory(await ctxA.newPage(), UNDERSTORY_SEED),
      bootUnderstory(await ctxB.newPage(), UNDERSTORY_SEED),
    ]);
    expect(shotA).toBe(shotB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("perf : strate sous-bois dispersée → fps ≥ 55 au framing", async ({ page }) => {
  test.setTimeout(60_000);
  await routeUnderstory(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrl(UNDERSTORY_PATH, { cam: CAM, seed: UNDERSTORY_SEED }));
  await waitForReady(page);
  const perf = await assertPerf(page, { minFps: 55 });
  console.log(`understory: ${poseToString(CAM)} — drawCalls=${perf.drawCalls} triangles=${perf.triangles} fps=${perf.fps.toFixed(1)}`);
});
