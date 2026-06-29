import { execSync } from "node:child_process";

/** Applique les migrations Drizzle avant la suite e2e (idempotent). */
export default function globalSetup() {
  try {
    execSync("pnpm --filter server db:migrate", { stdio: "inherit" });
  } catch (err) {
    console.warn("⚠ Migrations e2e non appliquées (base injoignable ?) :", (err as Error).message);
  }
}
