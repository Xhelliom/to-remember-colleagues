// Capture déterministe d'un screenshot du harnais (canvas WebGL), en dehors du
// test-runner Playwright — utile en boucle d'itération manuelle ou pour régénérer
// une baseline. Voir plan/README.md § Infrastructure de test partagée.
//
//   node --experimental-strip-types tools/shot.ts --out foo.png \
//     [--cam x,y,z,yaw,pitch[,fov]] [--seed N] [--T heures] [--preset low|high|ultra] \
//     [--url http://localhost:5173/?testCluster=42]
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { harnessUrl, waitForReady, type CamPose } from "../e2e/helpers/harness.ts";

// Route déterministe existante (sans auth/DB) servant de scène de harnais par
// défaut — voir runClusterTest dans web/src/main.ts.
const DEFAULT_BASE_URL = "http://localhost:5173/?testCluster=42";
const CHROME_PATH = process.env.PW_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const VIEWPORT = { width: 512, height: 512 };
const USAGE =
  "usage: shot.ts --out foo.png [--cam x,y,z,yaw,pitch[,fov]] [--seed N] [--T heures] " +
  "[--preset low|high|ultra] [--url http://...]";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

function parseCamArg(raw?: string): CamPose | undefined {
  if (!raw) return undefined;
  const [x, y, z, yaw, pitch, fov] = raw.split(",").map(Number);
  return fov !== undefined && !Number.isNaN(fov) ? { x, y, z, yaw, pitch, fov } : { x, y, z, yaw, pitch };
}

function resolveUrl(args: Record<string, string>): string {
  if (args.url) return args.url;
  return harnessUrl(DEFAULT_BASE_URL, {
    cam: parseCamArg(args.cam),
    seed: args.seed !== undefined ? Number(args.seed) : undefined,
    T: args.T !== undefined ? Number(args.T) : undefined,
    preset: args.preset,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    console.error(USAGE);
    process.exit(2);
  }

  const url = resolveUrl(args);
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on("pageerror", (e) => console.error("PAGEERROR:", e.message));
    await page.goto(url);
    await waitForReady(page);
    const dataUrl = await page.evaluate(
      () => (document.querySelector("#scene") as HTMLCanvasElement).toDataURL("image/png"),
    );
    writeFileSync(args.out, Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`capture écrite : ${args.out} (${url})`);
  } finally {
    await browser.close();
  }
}

void main();
