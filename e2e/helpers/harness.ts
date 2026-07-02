// Harnais e2e partagé : URL déterministes (`?cam`/`?seed`/`?T`/`?preset`), capture
// canvas + diff vs baseline, et assertion de budget perf via `window.__perf`.
// Consommé par toutes les missions du rework herbe/arbres (plan/README.md § Infra
// de test partagée) — ne pas dupliquer cette logique dans chaque `*.spec.ts`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { decodePng, type DecodedPng } from "../png.ts";
import { compare, diffPixels, encodePng, type CompareResult } from "../../tools/compare.ts";

const READY_WAIT_TIMEOUT = 30_000; // délai max d'attente de window.__ready
const DEFAULT_DIFF_THRESHOLD = 0.05; // ratio de pixels différents toléré par défaut
const BASELINES_DIR = fileURLToPath(new URL("../baselines/", import.meta.url));
const DIFF_OUT_DIR = join(dirname(fileURLToPath(new URL("../../", import.meta.url))), "test-results", "harness-diffs");

/** Pose caméra du harnais : `x,y,z,yaw,pitch[,fov]` (mètres, radians). */
export type CamPose = { x: number; y: number; z: number; yaw: number; pitch: number; fov?: number };

export type PerfSnapshot = { drawCalls: number; triangles: number; programs: number; fps: number };
export type PerfBudget = { maxDrawCalls?: number; maxTriangles?: number; maxPrograms?: number; minFps?: number };

/** Fenêtre enrichie des hooks de dev/e2e câblés par main.ts/cemetery.ts (jamais en prod). */
type HarnessWindow = Window & { __perf?: PerfSnapshot; __ready?: Promise<void> };

// ---- Pose caméra : parsing/sérialisation (round-trip testé) ----

/** `"x,y,z,yaw,pitch[,fov]"` → pose. Lève si le format est invalide. */
export function parseCamPose(raw: string): CamPose {
  const parts = raw.split(",").map(Number);
  const [x, y, z, yaw, pitch, fov] = parts;
  if (parts.length < 5 || [x, y, z, yaw, pitch].some((n) => Number.isNaN(n))) {
    throw new Error(`pose caméra invalide : "${raw}" (attendu x,y,z,yaw,pitch[,fov])`);
  }
  return fov !== undefined && !Number.isNaN(fov) ? { x, y, z, yaw, pitch, fov } : { x, y, z, yaw, pitch };
}

/** Pose → `"x,y,z,yaw,pitch[,fov]"` — inverse de `parseCamPose`. */
export function poseToString(p: CamPose): string {
  const base = [p.x, p.y, p.z, p.yaw, p.pitch];
  return (p.fov !== undefined ? [...base, p.fov] : base).join(",");
}

/** Construit une URL de harnais déterministe à partir d'une base (peut déjà porter
 *  ses propres query params, ex. `?testCluster=42`). */
export function harnessUrl(
  base: string,
  opts: { cam?: CamPose; seed?: number; T?: number; preset?: string },
): string {
  const params = new URLSearchParams();
  if (opts.cam) params.set("cam", poseToString(opts.cam));
  if (opts.seed !== undefined) params.set("seed", String(opts.seed));
  if (opts.T !== undefined) params.set("T", String(opts.T));
  if (opts.preset) params.set("preset", opts.preset);
  const qs = params.toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

// ---- Capture & attente de stabilité ----

/** Attend que `window.__ready` existe puis se résolve (scène stable, N frames). */
export async function waitForReady(page: Page, timeout = READY_WAIT_TIMEOUT): Promise<void> {
  await page.waitForFunction(() => "__ready" in window, undefined, { timeout });
  await page.evaluate(() => (window as unknown as HarnessWindow).__ready);
}

/** Lit le canvas `#scene` via `toDataURL` (rapide sous swiftshader headless,
 *  contrairement au screenshot Playwright — voir e2e/captureBiome.ts). */
export async function captureCanvas(page: Page, selector = "#scene"): Promise<DecodedPng> {
  const dataUrl = await page.evaluate((sel) => {
    const c = document.querySelector(sel) as HTMLCanvasElement;
    return c.toDataURL("image/png");
  }, selector);
  return decodePng(new Uint8Array(Buffer.from(dataUrl.split(",")[1], "base64")));
}

// ---- Comparaison à une baseline versionnée (e2e/baselines/) ----

/**
 * Navigue vers `base` avec les query params du harnais, attend la stabilité, capture
 * le canvas et le compare à `e2e/baselines/<baselineName>`. Lève si le diff dépasse
 * `threshold`. Avec `UPDATE_BASELINES=1`, (ré)écrit la baseline au lieu de comparer.
 */
export async function shotAndDiff(
  page: Page,
  base: string,
  opts: { cam?: CamPose; seed?: number; T?: number; preset?: string },
  baselineName: string,
  threshold = DEFAULT_DIFF_THRESHOLD,
): Promise<CompareResult> {
  await page.goto(harnessUrl(base, opts));
  await waitForReady(page);
  const render = await captureCanvas(page);

  const baselinePath = join(BASELINES_DIR, baselineName);
  if (process.env.UPDATE_BASELINES) {
    mkdirSync(BASELINES_DIR, { recursive: true });
    writeFileSync(baselinePath, encodePng(render));
    return { diffRatio: 0, ssim: 1 };
  }
  if (!existsSync(baselinePath)) {
    throw new Error(`baseline absente : ${baselinePath} (relancer avec UPDATE_BASELINES=1 pour la créer)`);
  }

  const baseline = decodePng(new Uint8Array(readFileSync(baselinePath)));
  const result = compare(render, baseline);
  if (result.diffRatio > threshold) {
    mkdirSync(DIFF_OUT_DIR, { recursive: true });
    const diffPath = join(DIFF_OUT_DIR, `${baselineName}.diff.png`);
    writeFileSync(diffPath, encodePng(diffPixels(render, baseline).diffPng));
    throw new Error(
      `diff visuel ${(result.diffRatio * 100).toFixed(1)}% > seuil ${(threshold * 100).toFixed(1)}% (voir ${diffPath})`,
    );
  }
  return result;
}

// ---- Budget perf (window.__perf) ----

/** Lit `window.__perf` (lève si absent : la page doit être en mode dev/e2e). */
export async function readPerf(page: Page): Promise<PerfSnapshot> {
  const perf = await page.evaluate(() => (window as unknown as HarnessWindow).__perf);
  if (!perf) throw new Error("window.__perf indisponible (mode dev/e2e requis, voir main.ts/cemetery.ts)");
  return perf;
}

/** Lève si `window.__perf` dépasse le budget donné. Renvoie le relevé sinon (log). */
export async function assertPerf(page: Page, budget: PerfBudget): Promise<PerfSnapshot> {
  const perf = await readPerf(page);
  const failures: string[] = [];
  if (budget.maxDrawCalls !== undefined && perf.drawCalls > budget.maxDrawCalls) {
    failures.push(`drawCalls ${perf.drawCalls} > ${budget.maxDrawCalls}`);
  }
  if (budget.maxTriangles !== undefined && perf.triangles > budget.maxTriangles) {
    failures.push(`triangles ${perf.triangles} > ${budget.maxTriangles}`);
  }
  if (budget.maxPrograms !== undefined && perf.programs > budget.maxPrograms) {
    failures.push(`programs ${perf.programs} > ${budget.maxPrograms}`);
  }
  if (budget.minFps !== undefined && perf.fps < budget.minFps) {
    failures.push(`fps ${perf.fps.toFixed(1)} < ${budget.minFps}`);
  }
  if (failures.length > 0) throw new Error(`budget perf dépassé : ${failures.join(" ; ")}`);
  return perf;
}

// ---- Règle « pas d'ombre noire » (Pillar B LAAS) ----

/**
 * Chroma moyenne (écart max-min de canal, normalisé [0,1]) d'un échantillon de
 * pixels RGBA plats. Une ombre correctement éclairée par rebond garde un peu de
 * couleur ; une chroma proche de 0 partout signale une ombre écrasée à un gris/noir
 * plat (pas de bounce light).
 */
export function sampleShadowChroma(pixels: Uint8Array | number[]): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    sum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    count++;
  }
  if (count === 0) throw new Error("sampleShadowChroma : échantillon vide");
  return sum / count;
}
