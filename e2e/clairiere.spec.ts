import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
// Kit générique partagé (e2e/) + pièces spécifiques au biome (dossier du biome).
import { decodePng } from "./png.ts";
import { captureBiome } from "./captureBiome.ts";
import { describe as describeImage, similarity as similarityGeneric } from "./imageDescriptor.ts";
import { analyze, similarity } from "../web/src/scene/biomes/clairiere/metrics.ts";
import { clairiereManifest } from "../web/src/scene/biomes/clairiere/manifest.ts";

// Barre volontairement basse pendant l'itération visuelle ; à relever au fil du calibrage.
const MIN_SIMILARITY = 0.5;

test("le rendu du cluster converge vers le concept (comparaison fine)", async ({ page }) => {
  test.setTimeout(120_000); // la lecture WebGL sous swiftshader (headless) est lente
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

  const render = await captureBiome(page, clairiereManifest.testUrl);
  const concept = decodePng(new Uint8Array(readFileSync(clairiereManifest.conceptImage)));

  // Métriques spécifiques cimetière (green/earth/grave) : diagnostic fin.
  const vRender = analyze(render.data, render.width, render.height);
  const vConcept = analyze(concept.data, concept.width, concept.height);
  const score = similarity(vConcept, vRender);

  // Descripteur générique (réutilisable pour tout biome) : score de composition.
  const gScore = similarityGeneric(
    describeImage(concept.data, concept.width, concept.height),
    describeImage(render.data, render.width, render.height),
  );

  console.log("Rendu   :", JSON.stringify(vRender));
  console.log(`Similarité cimetière = ${(score * 100).toFixed(1)} %  |  générique = ${(gScore * 100).toFixed(1)} %`);

  expect(score).toBeGreaterThan(MIN_SIMILARITY);
});
