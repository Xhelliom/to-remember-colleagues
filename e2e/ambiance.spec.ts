import { test, expect, type Page } from "@playwright/test";
import { assertPerf, captureCanvas, waitForReady } from "./helpers/harness.ts";
import { compare } from "../tools/compare.ts";
import { decodePng, type DecodedPng } from "./png.ts";
import { BOOKMARKS } from "../web/src/scene/bookmarks.ts";

// Post/ambiance (mission 14) : bookmarks/flythrough (`?shot=`, scene/bookmarks.ts) +
// auto-exposition/grade/brume (`?post=1`, scene/post/*.ts) — greffés sur le harnais
// `?testCluster=42` (main.ts), SANS auth/DB (mêmes bases que harness.spec.ts/grass.spec.ts).
const HARNESS_BASE = "/?testCluster=42";
const VIEWPORT = { width: 400, height: 300 }; // petit cadre → capture/attente rapides sous swiftshader
const SEED = 1;

function shotUrl(shot: string | number, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ testCluster: "42", shot: String(shot), seed: String(SEED), ...extra });
  return `/?${params.toString()}`;
}

async function bootShot(page: Page, shot: string | number, extra: Record<string, string> = {}): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(shotUrl(shot, extra));
  await waitForReady(page);
}

// --- ?shot=1..9 : déterminisme (deux runs identiques) -----------------------

for (const bookmark of BOOKMARKS) {
  test(`?shot=${bookmark.id} (${bookmark.name}) rend déterministement (deux runs identiques)`, async ({ browser }) => {
    test.setTimeout(60_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await Promise.all([bootShot(pageA, bookmark.id), bootShot(pageB, bookmark.id)]);
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
}

// --- Flythrough (?shot=fly) : pas d'erreur console, la caméra bouge réellement ----

test("flythrough (?shot=fly) tourne sans erreur console et déplace la caméra", async ({ page }) => {
  test.setTimeout(30_000);
  const SAMPLE_GAP_MS = 2000; // fenêtre d'observation courte — le tour dure 90 s au total
  const MIN_MOVEMENT_DIFF_RATIO = 0.01; // ratio de pixels changés attendu si la caméra a bougé

  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await bootShot(page, "fly");
  const early = await captureCanvas(page);
  await page.waitForTimeout(SAMPLE_GAP_MS);
  const later = await captureCanvas(page);

  expect(consoleErrors).toEqual([]);
  const { diffRatio } = compare(early, later);
  expect(diffRatio).toBeGreaterThan(MIN_MOVEMENT_DIFF_RATIO);
});

// --- Grade filmique par heure : décalage colorimétrique mesurable aube/midi ------

function meanColor(png: DecodedPng): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    r += png.data[o]; g += png.data[o + 1]; b += png.data[o + 2];
  }
  return { r: r / n, g: g / n, b: b / n };
}

function colorDistance(a: { r: number; g: number; b: number }, bC: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - bC.r, a.g - bC.g, a.b - bC.b);
}

test("grade filmique (?post=1) : décalage colorimétrique mesurable entre ?T=6 (aube) et ?T=12 (midi)", async ({ page }) => {
  test.setTimeout(30_000);
  const MIN_COLOR_DISTANCE = 8; // écart moyen (0..255 par canal) minimal attendu entre aube et midi

  await bootShot(page, 3, { post: "1", T: "6" });
  const dawnDataUrl = await page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
  const dawn = decodePng(new Uint8Array(Buffer.from(dawnDataUrl.split(",")[1], "base64")));

  await bootShot(page, 3, { post: "1", T: "12" });
  const noonDataUrl = await page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
  const noon = decodePng(new Uint8Array(Buffer.from(noonDataUrl.split(",")[1], "base64")));

  const distance = colorDistance(meanColor(dawn), meanColor(noon));
  expect(distance).toBeGreaterThan(MIN_COLOR_DISTANCE);
});

// --- Perf : budget tenu avec le post activé ----------------------------------

test("budget perf tenu avec le post activé (?post=1)", async ({ page }) => {
  test.setTimeout(30_000);
  await bootShot(page, 3, { post: "1" });
  await assertPerf(page, { minFps: 55 });
});
