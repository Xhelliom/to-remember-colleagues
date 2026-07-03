// Comparaison photométrique de deux PNG (diff pixel + SSIM) — sert de garde-fou
// visuel à toutes les missions du rework herbe/arbres (plan/README.md § Infrastructure
// de test partagée). Fonctions pures réutilisées par e2e/helpers/harness.ts.
//
//   node --experimental-strip-types tools/compare.ts --a a.png --b b.png [--out diff.png] [--threshold 0.02]
//
// Code retour : 0 si diffRatio <= threshold, 1 sinon (utile en script/CI).
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import { decodePng, type DecodedPng } from "../e2e/png.ts";

const CHANNEL_DIFF_THRESHOLD = 24; // écart par canal (0..255) au-delà duquel un pixel compte "différent"
const DEFAULT_DIFF_THRESHOLD = 0.02; // ratio de pixels différents toléré par défaut (CLI)
const DIFF_HIGHLIGHT: readonly [number, number, number, number] = [255, 0, 96, 255]; // rose vif = pixel différent
const SSIM_C1 = (0.01 * 255) ** 2;
const SSIM_C2 = (0.03 * 255) ** 2;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type CompareResult = { diffRatio: number; ssim: number };

function assertSameSize(a: DecodedPng, b: DecodedPng): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`tailles différentes : ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  }
}

function luminance(data: Uint8Array, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/** Diff pixel-à-pixel : ratio de pixels dont un canal dépasse le seuil, + image de
 *  diff (rose = différent, niveaux de gris = identique) pour inspection humaine. */
export function diffPixels(a: DecodedPng, b: DecodedPng): { diffRatio: number; diffPng: DecodedPng } {
  assertSameSize(a, b);
  const { width, height } = a;
  const out = new Uint8Array(width * height * 4);
  let diffCount = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    if (Math.max(dr, dg, db) > CHANNEL_DIFF_THRESHOLD) {
      diffCount++;
      out.set(DIFF_HIGHLIGHT, o);
    } else {
      const gray = luminance(a.data, o) | 0;
      out[o] = gray; out[o + 1] = gray; out[o + 2] = gray; out[o + 3] = 255;
    }
  }
  return { diffRatio: diffCount / (width * height), diffPng: { width, height, data: out } };
}

/** SSIM globale simplifiée (une seule fenêtre = l'image entière, en luminance) :
 *  suffisant pour détecter une dérive visuelle d'ensemble sans reproduire tout
 *  l'appareillage fenêtré de la métrique originale. Toujours ∈ [0,1] (clampée). */
export function ssim(a: DecodedPng, b: DecodedPng): number {
  assertSameSize(a, b);
  const n = a.width * a.height;
  const la = new Float64Array(n);
  const lb = new Float64Array(n);
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) {
    la[i] = luminance(a.data, i * 4);
    lb[i] = luminance(b.data, i * 4);
    sumA += la[i]; sumB += lb[i];
  }
  const meanA = sumA / n, meanB = sumB / n;
  let varA = 0, varB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = la[i] - meanA, db = lb[i] - meanB;
    varA += da * da; varB += db * db; cov += da * db;
  }
  varA /= Math.max(1, n - 1); varB /= Math.max(1, n - 1); cov /= Math.max(1, n - 1);
  const num = (2 * meanA * meanB + SSIM_C1) * (2 * cov + SSIM_C2);
  const den = (meanA ** 2 + meanB ** 2 + SSIM_C1) * (varA + varB + SSIM_C2);
  return Math.min(1, Math.max(0, num / den));
}

/** Diff + SSIM en un appel — c'est cette fonction que consomme le harnais e2e. */
export function compare(a: DecodedPng, b: DecodedPng): CompareResult & { diffPng: DecodedPng } {
  const { diffRatio, diffPng } = diffPixels(a, b);
  return { diffRatio, ssim: ssim(a, b), diffPng };
}

// --- Encodeur PNG minimal (RGBA 8 bits, filtre "none", zlib natif) : symétrique du
// décodeur d'e2e/png.ts, pour écrire l'image de diff sans dépendance nouvelle. ---
const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Encode une image RGBA décodée en PNG (round-trip avec `decodePng`). */
export function encodePng({ width, height, data }: DecodedPng): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // bitDepth=8, colorType=6 (RGBA), compression/filtre/entrelacement=0

  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const ro = y * (1 + stride);
    raw[ro] = 0; // filtre "none" par scanline
    raw.set(data.subarray(y * stride, (y + 1) * stride), ro + 1);
  }
  const idat = zlib.deflateSync(raw);

  const sig = new Uint8Array(PNG_SIGNATURE);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// --- CLI ---
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

function runCli(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.a || !args.b) {
    console.error("usage: compare.ts --a img1.png --b img2.png [--out diff.png] [--threshold 0.02]");
    process.exit(2);
  }
  const a = decodePng(new Uint8Array(readFileSync(args.a)));
  const b = decodePng(new Uint8Array(readFileSync(args.b)));
  const threshold = args.threshold ? Number(args.threshold) : DEFAULT_DIFF_THRESHOLD;
  const result = compare(a, b);
  if (args.out) writeFileSync(args.out, encodePng(result.diffPng));
  console.log(JSON.stringify({ diffRatio: result.diffRatio, ssim: result.ssim, threshold }));
  process.exit(result.diffRatio > threshold ? 1 : 0);
}

if (process.argv[1]?.endsWith("compare.ts")) runCli();
