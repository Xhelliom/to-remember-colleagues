import { test, expect, type Page } from "@playwright/test";
import { assertPerf, harnessUrl, waitForReady, type CamPose } from "./helpers/harness.ts";
import { decodePng, type DecodedPng } from "./png.ts";

// Arbre en cartes (mission 09) vs hero (mission 08) — même détour de routage que
// tree-hero.spec.ts : URL FACTICE jamais servie côté serveur, remplacée par une
// page HTML inline qui importe `mountTreeHeroScene` directement (le vrai serveur
// Vite résout ensuite ses imports "three" normalement). Nécessaire car ce fichier
// ne peut toucher à main.ts/cemetery.ts (partition de la mission 09).
const CARDS_PATH = "/__tree-cards-harness__";
const CARDS_ROUTE_PATTERN = "**/__tree-cards-harness__**";
const CARDS_MODULE_PATH = "/src/scene/trees/treeBuilder.ts";
const CAM: CamPose = { x: 0, y: 1.8, z: 6.5, yaw: Math.PI, pitch: -0.08 };
const VIEWPORT = { width: 480, height: 360 };
const SEED = 1;

// Budget triangles d'un arbre en CARTES (mission 09) : bark (mission 08, inchangé
// par cette mission, ~2,4k tris à lod=0) + cartes de feuillage (~300-400 tris) —
// très en-deçà du budget hero "vraies feuilles" (MAX 20 000, cf. treeBuilder.test.ts),
// et surtout la partie feuillage seule chute de ~2 700 (mesh) à ~350 (cartes),
// l'ordre de grandeur visé pour l'instanciation en masse (mission 10).
const CARDS_TREE_TRIANGLE_BUDGET = 4000;

// Coverage de silhouette : fraction de pixels du cadrage qui ne sont PAS le ciel
// (donc couverts par bark+feuillage). Comparaison hero vs cartes à tolérance —
// le feuillage en cartes ne doit pas "maigrir" par rapport au hero.
const SKY_COLOR: readonly [number, number, number] = [0x9f, 0xc4, 0xe8]; // DEMO_SKY_COLOR (treeBuilder.ts)
const SKY_CHANNEL_TOLERANCE = 24; // même échelle que tools/compare.ts (CHANNEL_DIFF_THRESHOLD)
const COVERAGE_RELATIVE_TOLERANCE = 0.35; // "à tolérance près" — géométries différentes par nature
// Bande de cadrage utilisée pour la mesure de couverture — évite le sol (bas de
// cadre) et le vignettage des bords (marge latérale), garde la couronne + l'écorce.
const CROP = { x0: 0.1, x1: 0.9, y0: 0, y1: 0.62 };
const MIN_HALO_LUMINANCE = 40; // 0..255 — un liseré noir tomberait bien en-dessous

function heroCardsHtml(): string {
  return `<!doctype html>
<html>
<body style="margin:0;overflow:hidden;background:#000">
<script type="module">
  import { mountTreeHeroScene } from "${CARDS_MODULE_PATH}";
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  document.body.appendChild(canvas);
  const params = new URLSearchParams(location.search);
  mountTreeHeroScene(canvas, {
    seed: Number(params.get("seed") ?? "1"),
    camPose: params.get("cam") ?? undefined,
    foliageMode: params.get("foliage") ?? undefined,
  });
</script>
</body>
</html>`;
}

async function routeCards(page: Page): Promise<void> {
  await page.route(CARDS_ROUTE_PATTERN, (route) =>
    route.fulfill({ contentType: "text/html", body: heroCardsHtml() }));
}

function harnessUrlWithFoliage(base: string, foliage: string, cam: CamPose, seed: number): string {
  const url = harnessUrl(base, { cam, seed });
  return `${url}${url.includes("?") ? "&" : "?"}foliage=${foliage}`;
}

async function bootTree(page: Page, foliage: string): Promise<DecodedPng> {
  await routeCards(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrlWithFoliage(CARDS_PATH, foliage, CAM, SEED));
  await waitForReady(page);
  const dataUrl = await page.evaluate(() => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"));
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

function isSkyPixel(img: DecodedPng, i: number): boolean {
  return (
    Math.abs(img.data[i] - SKY_COLOR[0]) <= SKY_CHANNEL_TOLERANCE &&
    Math.abs(img.data[i + 1] - SKY_COLOR[1]) <= SKY_CHANNEL_TOLERANCE &&
    Math.abs(img.data[i + 2] - SKY_COLOR[2]) <= SKY_CHANNEL_TOLERANCE
  );
}

/** Fraction de pixels "non-ciel" (bark+feuillage) dans la bande `CROP`. */
function silhouetteCoverage(img: DecodedPng): number {
  const x0 = Math.floor(img.width * CROP.x0), x1 = Math.floor(img.width * CROP.x1);
  const y0 = Math.floor(img.height * CROP.y0), y1 = Math.floor(img.height * CROP.y1);
  let covered = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      if (!isSkyPixel(img, i)) covered++;
      total++;
    }
  }
  if (total === 0) throw new Error("silhouetteCoverage : cadrage vide");
  return covered / total;
}

function luminance(data: Uint8Array, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/**
 * Luminance minimale des pixels de TRANSITION ciel→feuillage (le pixel non-ciel
 * juste après un pixel ciel, en balayage horizontal) — un liseré noir de mip
 * d'atlas mal dilaté ferait chuter cette luminance bien en-dessous du feuillage
 * environnant (cf. atlasCapture.ts dilateBackground).
 */
function minBorderLuminance(img: DecodedPng): number | null {
  const x0 = Math.floor(img.width * CROP.x0), x1 = Math.floor(img.width * CROP.x1);
  const y0 = Math.floor(img.height * CROP.y0), y1 = Math.floor(img.height * CROP.y1);
  let min: number | null = null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0 + 1; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const iPrev = (y * img.width + x - 1) * 4;
      if (!isSkyPixel(img, iPrev) || isSkyPixel(img, i)) continue; // pas une transition ciel→matière
      const lum = luminance(img.data, i);
      if (min === null || lum < min) min = lum;
    }
  }
  return min;
}

test("silhouette de couronne : couverture cartes ≈ hero (à tolérance près)", async ({ page }) => {
  test.setTimeout(60_000);
  const hero = await bootTree(page, "mesh");
  const cardsPage = await page.context().newPage();
  const cards = await bootTree(cardsPage, "cards");
  await cardsPage.close();

  const covHero = silhouetteCoverage(hero);
  const covCards = silhouetteCoverage(cards);
  const relDiff = Math.abs(covCards - covHero) / Math.max(covHero, covCards);
  expect(relDiff).toBeLessThan(COVERAGE_RELATIVE_TOLERANCE);
});

test("anti-halo : bord de couronne en cartes sans liseré noir", async ({ page }) => {
  test.setTimeout(60_000);
  const cards = await bootTree(page, "cards");
  const minLum = minBorderLuminance(cards);
  expect(minLum).not.toBeNull();
  expect(minLum!).toBeGreaterThan(MIN_HALO_LUMINANCE);
});

test("perf : arbre en cartes → budget triangles réduit, fps ≥ 55", async ({ page }) => {
  test.setTimeout(60_000);
  await routeCards(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrlWithFoliage(CARDS_PATH, "cards", CAM, SEED));
  await waitForReady(page);
  const perf = await assertPerf(page, { minFps: 55 });
  expect(perf.triangles).toBeLessThan(CARDS_TREE_TRIANGLE_BUDGET);
});

test("déterminisme : même seed/mode cartes → PNG identiques", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [pageA, pageB] = [await ctxA.newPage(), await ctxB.newPage()];
    await Promise.all([routeCards(pageA), routeCards(pageB)]);
    await Promise.all([pageA.setViewportSize(VIEWPORT), pageB.setViewportSize(VIEWPORT)]);
    await Promise.all([
      pageA.goto(harnessUrlWithFoliage(CARDS_PATH, "cards", CAM, SEED)),
      pageB.goto(harnessUrlWithFoliage(CARDS_PATH, "cards", CAM, SEED)),
    ]);
    await Promise.all([waitForReady(pageA), waitForReady(pageB)]);
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
