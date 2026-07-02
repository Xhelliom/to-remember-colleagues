import { test, expect, type Page } from "@playwright/test";
import {
  assertPerf,
  captureCanvas,
  harnessUrl,
  shotAndDiff,
  waitForReady,
  type CamPose,
} from "./helpers/harness.ts";

// Cadrage "prairie" : la scène de harnais (`?testCluster=`, web/src/main.ts) pose une
// clairière entourée d'herbe haute (GrassField, heightScale=1.9) hors du disque de
// terre (EARTH_RADIUS ≈ 4.4 autour de z=9) et de l'allée centrale (|x| < 1.4, z < 9).
// Caméra posée DANS la bande d'herbe (x=3, donc hors allée et hors disque), inclinée
// vers le sol pour cadrer un plan rapproché de brins — à ajuster si besoin lors de la
// génération de la baseline (`UPDATE_BASELINES=1`, cf. e2e/helpers/harness.ts).
const GRASS_CAM: CamPose = { x: 3, y: 1.3, z: 1, yaw: 0.4, pitch: -0.55 };
const HARNESS_BASE = "/?testCluster=42";
const VIEWPORT = { width: 480, height: 320 }; // petit cadre → capture/attente rapides sous swiftshader
const GRASS_SEED = 1;

async function gotoGrassPrairie(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(harnessUrl(HARNESS_BASE, { cam: GRASS_CAM, seed: GRASS_SEED }));
  await waitForReady(page);
}

test("shot prairie vs baseline (diff visuel)", async ({ page }) => {
  test.setTimeout(30_000);
  await shotAndDiff(page, HARNESS_BASE, { cam: GRASS_CAM, seed: GRASS_SEED }, "grass-prairie.png");
});

test("budget perf tenu au cadrage prairie", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoGrassPrairie(page);
  // Budget GLOBAL de la scène de harnais (biome + herbe + tombes stand-in + ombres) :
  // window.__perf n'isole pas l'herbe seule (un seul window.__perf partagé, cf.
  // plan/README.md § infra de test). Un GrassField instancié n'ajoute QU'UN seul draw
  // call quel que soit son nombre de touffes (InstancedMesh) — un budget resserré sur
  // le total de la scène détecte donc quand même une régression vers du non-instancié.
  await assertPerf(page, { maxDrawCalls: 60, minFps: 55 });
});

test("déterminisme : deux runs même seed/cam → PNG identiques", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const [pageA, pageB] = [await ctxA.newPage(), await ctxB.newPage()];
    await Promise.all([gotoGrassPrairie(pageA), gotoGrassPrairie(pageB)]);
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

// --- Anti-scintillement --------------------------------------------------------
// La normale de brin est fondue vers la normale de terrain (grassField.ts,
// NORMAL_BLEND_NEAR/FAR) pour éviter le "sparkle" gris : un brin à normale plate
// catche la lumière de façon incohérente d'un pixel à l'autre. Signature du bug :
// forte variance de luminance ENTRE pixels voisins d'un même patch d'herbe (bruit
// "poivre et sel"). On mesure cette variance SPATIALE dans le rendu — la validation
// analytique de la normale de terrain elle-même (différences finies vs pente
// connue) est couverte par grassBlade.test.ts (pas besoin d'une vraie pente ici).

// Volontairement large tant que la baseline visuelle n'est pas calibrée avec un
// vrai rendu (cf. UPDATE_BASELINES=1) — à resserrer une fois calibré.
const SPARKLE_VARIANCE_THRESHOLD = 400; // variance de luminance (échelle 0..255²)

function luminance(data: Uint8Array, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** Variance de luminance entre pixels horizontalement voisins dans [x0,x1)×[y0,y1) —
 *  un ombrage lisse a une variance basse ; du "sparkle" une variance haute. */
function neighborLuminanceVariance(
  img: { width: number; data: Uint8Array },
  x0: number, y0: number, x1: number, y1: number,
): number {
  const diffs: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1 - 1; x++) {
      const i = (y * img.width + x) * 4;
      const iNext = (y * img.width + x + 1) * 4;
      diffs.push(luminance(img.data, iNext) - luminance(img.data, i));
    }
  }
  if (diffs.length === 0) throw new Error("patch vide");
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  return diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length;
}

test("anti-scintillement : variance de luminance basse dans un patch d'herbe", async ({ page }) => {
  test.setTimeout(30_000);
  await gotoGrassPrairie(page);
  const img = await captureCanvas(page);
  // Bande horizontale au centre-bas du cadre, cadrée sur le sol/l'herbe proche (GRASS_CAM
  // regarde vers le bas). Marge de 10% sur les bords pour éviter le vignettage/les bords du canvas.
  const x0 = Math.floor(img.width * 0.1);
  const x1 = Math.floor(img.width * 0.9);
  const y0 = Math.floor(img.height * 0.55);
  const y1 = Math.floor(img.height * 0.85);
  const variance = neighborLuminanceVariance(img, x0, y0, x1, y1);
  expect(variance).toBeLessThan(SPARKLE_VARIANCE_THRESHOLD);
});
