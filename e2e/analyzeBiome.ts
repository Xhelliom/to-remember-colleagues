// CLI GÉNÉRIQUE : analyse une (ou deux) image(s) de biome et affiche le descripteur
// générique (histogramme de teintes + stats), plus la similarité si deux images sont
// fournies. Marche pour tout thème (cimetière, enfer, paradis…).
//   node --experimental-strip-types e2e/analyzeBiome.ts <concept.png> [<rendu.png>]
import { readFileSync } from "node:fs";
import { decodePng } from "./png.ts";
import { describe, similarity, type ImageDescriptor } from "./imageDescriptor.ts";

function describeOf(path: string): ImageDescriptor {
  const { width, height, data } = decodePng(new Uint8Array(readFileSync(path)));
  return describe(data, width, height);
}

const [refPath, renderPath] = process.argv.slice(2);
if (!refPath) {
  console.error("usage: analyzeBiome.ts <ref.png> [<render.png>]");
  process.exit(1);
}

const ref = describeOf(refPath);
console.log(`\n=== ${refPath} ===`);
console.log(JSON.stringify(ref, null, 2));

if (renderPath) {
  const render = describeOf(renderPath);
  console.log(`\n=== ${renderPath} ===`);
  console.log(JSON.stringify(render, null, 2));
  console.log(`\nSimilarité = ${(similarity(ref, render) * 100).toFixed(1)} %`);
}
