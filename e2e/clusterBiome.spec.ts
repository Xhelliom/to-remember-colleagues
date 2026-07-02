import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng } from "./png.ts";
import { analyze, similarity } from "./clusterMetrics.ts";

const CONCEPT = "images/cluster-cocoon-concept.png";
// Barre volontairement basse pendant l'itération visuelle ; à relever au fil du calibrage.
const MIN_SIMILARITY = 0.5;

test("le rendu du cluster converge vers le concept (comparaison fine)", async ({ page }) => {
  test.setTimeout(120_000); // le screenshot WebGL sous swiftshader (headless) est lent
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  // Rendu carré 1024² pour comparer au concept (1024²) dans le même cadrage.
  await page.setViewportSize({ width: 1024, height: 1024 });
  await page.goto("/?testCluster=42");
  await page.waitForFunction(() => document.body.dataset.ready === "cluster", { timeout: 30_000 });
  // Laisse quelques frames au chargement GLTF/herbe.
  await page.waitForTimeout(2500);

  // Lecture directe du canvas (preserveDrawingBuffer) → PNG base64.
  const dataUrl = await page.evaluate(() =>
    (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"),
  );
  console.log("dataUrl length =", dataUrl.length);
  const renderBuf = Buffer.from(dataUrl.split(",")[1], "base64");
  const dumpPath = process.env.CLUSTER_DUMP;
  console.log("CLUSTER_DUMP =", dumpPath, "bufLen =", renderBuf.length);
  if (dumpPath) {
    try { writeFileSync(dumpPath, renderBuf); console.log("dump written"); }
    catch (e) { console.log("dump error:", (e as Error).message); }
  }
  const render = decodePng(new Uint8Array(renderBuf));
  const concept = decodePng(new Uint8Array(readFileSync(CONCEPT)));

  const vRender = analyze(render.data, render.width, render.height);
  const vConcept = analyze(concept.data, concept.width, concept.height);
  const score = similarity(vConcept, vRender);

  console.log("Concept :", JSON.stringify(vConcept));
  console.log("Rendu   :", JSON.stringify(vRender));
  console.log(`Similarité = ${(score * 100).toFixed(1)} %`);

  expect(score).toBeGreaterThan(MIN_SIMILARITY);
});
