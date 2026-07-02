// Helper RÉUTILISABLE de capture d'un rendu de biome pour comparaison photométrique.
// Navigue vers le harnais de test, attend le signal de chargement, lit le canvas
// WebGL via toDataURL (nécessite preserveDrawingBuffer côté renderer) et décode le
// PNG. Évite le screenshot Playwright, très lent sous swiftshader (headless CI).
//
// Prérequis harnais : le canvas expose `preserveDrawingBuffer: true` et pose
// `document.body.dataset.ready` une fois la scène chargée.
import type { Page } from "@playwright/test";
import { decodePng, type DecodedPng } from "./png.ts";

export type CaptureOptions = {
  size?: number;        // côté du rendu carré (défaut 1024, = concept)
  selector?: string;    // sélecteur du canvas (défaut "#scene")
  readyValue?: string;  // valeur attendue de body.dataset.ready (défaut "cluster")
  settleMs?: number;    // délai après "ready" pour laisser charger GLTF/herbe (défaut 2500)
};

/** Rend le biome à `url` dans un cadre carré et renvoie le PNG décodé (RGBA). */
export async function captureBiome(page: Page, url: string, opts: CaptureOptions = {}): Promise<DecodedPng> {
  const { size = 1024, selector = "#scene", readyValue = "cluster", settleMs = 2500 } = opts;
  await page.setViewportSize({ width: size, height: size });
  await page.goto(url);
  await page.waitForFunction(
    (v) => document.body.dataset.ready === v,
    readyValue,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(settleMs);

  const dataUrl = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLCanvasElement).toDataURL("image/png"),
    selector,
  );
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}
