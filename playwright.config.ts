import { defineConfig, devices } from "@playwright/test";

const WEB_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000";

// Chromium pré-installé dans l'environnement (pas de téléchargement). Surchargable via PW_CHROME.
const CHROME_PATH = process.env.PW_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const serverEnv = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://cimetiere@localhost:5432/cimetiere",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-at-least-32-characters-long",
  BETTER_AUTH_URL: API_URL,
  PORT: "3000",
  CORS_ORIGIN: WEB_URL,
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: WEB_URL,
    headless: true,
    launchOptions: {
      executablePath: CHROME_PATH,
      args: ["--use-gl=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter server dev",
      url: `${API_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: serverEnv,
    },
    {
      command: "pnpm --filter web dev",
      url: WEB_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
