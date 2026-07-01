import { test, expect } from "@playwright/test";

test("scène de test du biome de cluster se charge correctement", async ({ page }) => {
  await page.goto("/?testCluster=42");
  // Attend que buildClusterBiome ait terminé (data-ready="cluster" posé par main.ts)
  await page.waitForSelector("[data-ready=cluster]", { timeout: 15_000 });
  await expect(page).toHaveScreenshot("cluster-biome.png", { maxDiffPixelRatio: 0.05 });
});
