// CLI : analyse une (ou deux) image(s) de cluster et affiche le vecteur de
// métriques P1–P9, plus la similarité si deux images sont fournies.
//   node --experimental-strip-types e2e/analyzeCluster.ts <concept.png> [<rendu.png>]
import { readFileSync } from "node:fs";
import { decodePng } from "./png.ts";
import { analyze, similarity, type MetricsVector } from "./clusterMetrics.ts";

function vectorOf(path: string): MetricsVector {
  const { width, height, data } = decodePng(new Uint8Array(readFileSync(path)));
  return analyze(data, width, height);
}

const [refPath, renderPath] = process.argv.slice(2);
if (!refPath) {
  console.error("usage: analyzeCluster.ts <ref.png> [<render.png>]");
  process.exit(1);
}

const ref = vectorOf(refPath);
console.log(`\n=== ${refPath} ===`);
console.table(ref);

if (renderPath) {
  const render = vectorOf(renderPath);
  console.log(`\n=== ${renderPath} ===`);
  console.table(render);
  console.log(`\nSimilarité = ${(similarity(ref, render) * 100).toFixed(1)} %`);
}
