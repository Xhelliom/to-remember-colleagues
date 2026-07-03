import { test, expect, type Page } from "@playwright/test";
import { assertPerf, poseToString, waitForReady, type CamPose, type PerfSnapshot } from "./helpers/harness.ts";

// Scène déterministe sans auth/DB (runClusterTest, web/src/main.ts) + query params
// génériques du harnais (?cam/?seed/?T) — voir plan/01-harness.md.
const CAM: CamPose = { x: 0, y: 1.7, z: 0.5, yaw: 0, pitch: 0 };
const HARNESS_URL = `/?testCluster=42&cam=${poseToString(CAM)}&seed=1&T=12`;
const VIEWPORT = { width: 400, height: 300 }; // petit cadre → capture/attente rapides sous swiftshader

async function bootHarness(page: Page): Promise<string> {
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.setViewportSize(VIEWPORT);
  await page.goto(HARNESS_URL);
  await waitForReady(page);
  return page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
}

async function readPerfSnapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() => (window as unknown as { __perf: PerfSnapshot }).__perf);
}

test("déterminisme : deux runs identiques (même cam/seed/T) produisent le même PNG", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [shotA, shotB] = await Promise.all([
      bootHarness(await ctxA.newPage()),
      bootHarness(await ctxB.newPage()),
    ]);
    expect(shotA).toBe(shotB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test("window.__perf expose drawCalls/triangles/fps positifs", async ({ page }) => {
  test.setTimeout(30_000);
  await bootHarness(page);
  const perf = await readPerfSnapshot(page);
  expect(perf.drawCalls).toBeGreaterThan(0);
  expect(perf.triangles).toBeGreaterThan(0);
  expect(perf.fps).toBeGreaterThan(0);
});

test("assertPerf échoue quand le budget est artificiellement trop strict (test négatif)", async ({ page }) => {
  test.setTimeout(30_000);
  await bootHarness(page);
  // Un budget minFps délibérément irréaliste doit faire échouer l'assertion.
  await expect(assertPerf(page, { minFps: 1_000_000 })).rejects.toThrow(/budget perf dépassé/);
  // À l'inverse, un budget large passe (vérifie qu'assertPerf ne casse pas tout le temps).
  await expect(assertPerf(page, { minFps: 0 })).resolves.toBeTruthy();
});
