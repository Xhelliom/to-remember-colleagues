// Descripteur d'image GÉNÉRIQUE (indépendant du type de biome) : sert à comparer
// finement un rendu à une image concept, quel que soit le thème (cimetière vert,
// enfer rouge/lave, paradis blanc/or…). Contrairement à clusterMetrics.ts — qui a
// des champs spécifiques cimetière (green/earth/grave) — ce descripteur repose sur
// un histogramme de teintes + des stats globales/spatiales valables pour tout thème.
//
// Auto-test : `node --experimental-strip-types e2e/imageDescriptor.ts` (compare une
// image à elle-même → ~1, et à une version assombrie → < 1).

const HUE_BINS = 12;   // 12 secteurs de 30° → capte "vert forêt" vs "rouge enfer" vs "blanc/or"
const GRID = 3;        // grille 3×3 de luminance (composition spatiale)

export type ImageDescriptor = {
  meanLum: number;            // luminance moyenne [0,1] (ambiance sombre/claire)
  meanSat: number;            // saturation moyenne [0,1] (vif/désaturé)
  vignette: number;           // L(centre) / L(bords) (>1 = centre éclairé)
  symmetry: number;           // corrélation miroir gauche/droite [0,1]
  hue: number[];              // histogramme de teintes pondéré par saturation (somme = 1)
  region: number[];           // luminance moyenne de chaque case de la grille 3×3
};

function lum(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hueSat(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function describe(data: Uint8Array, w: number, h: number): ImageDescriptor {
  let sumLum = 0, sumSat = 0;
  const hue = new Array(HUE_BINS).fill(0);
  let hueWeight = 0;
  const region = new Array(GRID * GRID).fill(0);
  const regionN = new Array(GRID * GRID).fill(0);

  // Zones centre (30 % central) et bords (12 % extérieurs) pour la vignette.
  const cxA = w * 0.35, cxB = w * 0.65, cyA = h * 0.35, cyB = h * 0.65;
  const bx0 = w * 0.12, bx1 = w * 0.88, by0 = h * 0.12, by1 = h * 0.88;
  let centerLum = 0, centerN = 0, borderLum = 0, borderN = 0;

  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID - 1, (y / h * GRID) | 0);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = lum(r, g, b);
      const c = hueSat(r, g, b);
      sumLum += L; sumSat += c.s;

      const bin = Math.min(HUE_BINS - 1, (c.h / 360 * HUE_BINS) | 0);
      hue[bin] += c.s; hueWeight += c.s; // pondéré par saturation → le gris ne pollue pas

      const gx = Math.min(GRID - 1, (x / w * GRID) | 0);
      const cell = gy * GRID + gx;
      region[cell] += L; regionN[cell]++;

      if (x >= cxA && x < cxB && y >= cyA && y < cyB) { centerLum += L; centerN++; }
      if (x < bx0 || x >= bx1 || y < by0 || y >= by1) { borderLum += L; borderN++; }
    }
  }

  let symDiff = 0, symN = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < (w >> 1); x += 2) {
      const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4;
      symDiff += Math.abs(lum(data[i], data[i + 1], data[i + 2]) - lum(data[j], data[j + 1], data[j + 2]));
      symN++;
    }
  }

  const total = w * h;
  return {
    meanLum: sumLum / total,
    meanSat: sumSat / total,
    vignette: (centerLum / Math.max(1, centerN)) / Math.max(1e-6, borderLum / Math.max(1, borderN)),
    symmetry: 1 - symDiff / Math.max(1, symN),
    hue: hue.map((v) => v / Math.max(1e-6, hueWeight)),
    region: region.map((v, k) => v / Math.max(1, regionN[k])),
  };
}

// Poids relatifs des familles de métriques dans la distance (somme libre).
const W = { meanLum: 1.5, meanSat: 1, vignette: 1, symmetry: 1, hue: 3, region: 2 };

/** Similarité [0,1] = 1 − distance normalisée entre deux descripteurs. */
export function similarity(a: ImageDescriptor, b: ImageDescriptor): number {
  const scalar = (k: "meanLum" | "meanSat" | "vignette" | "symmetry", norm: number) =>
    W[k] * ((a[k] - b[k]) / norm) ** 2;
  const vec = (k: "hue" | "region") =>
    W[k] * a[k].reduce((s, v, i) => s + (v - b[k][i]) ** 2, 0) / a[k].length;

  const sumW = W.meanLum + W.meanSat + W.vignette + W.symmetry + W.hue + W.region;
  const dist = scalar("meanLum", 0.5) + scalar("meanSat", 0.5) + scalar("vignette", 2)
    + scalar("symmetry", 1) + vec("hue") + vec("region");
  return Math.max(0, 1 - Math.sqrt(dist / sumW));
}

// --- Auto-test (ponytail: une vérification runnable pour la logique non triviale) ---
async function demo() {
  const { readFileSync } = await import("node:fs");
  const { decodePng } = await import("./png.ts");
  const path = process.argv[2] ?? "images/cluster-cocoon-concept.png";
  const { width, height, data } = decodePng(new Uint8Array(readFileSync(path)));
  const d = describe(data, width, height);

  // Version assombrie de moitié : doit être moins similaire que l'identité.
  const dark = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) dark[i] = i % 4 === 3 ? data[i] : (data[i] / 2) | 0;
  const dd = describe(dark, width, height);

  const self = similarity(d, d);
  const vsDark = similarity(d, dd);
  console.log(`similarité(image, image)   = ${(self * 100).toFixed(1)} %  (attendu 100)`);
  console.log(`similarité(image, sombre)  = ${(vsDark * 100).toFixed(1)} %  (attendu < 100)`);
  if (Math.abs(self - 1) > 1e-9) throw new Error("identité ≠ 1");
  if (vsDark >= self) throw new Error("assombrissement pas détecté");
  console.log("OK");
}

if (process.argv[1]?.endsWith("imageDescriptor.ts")) void demo();
