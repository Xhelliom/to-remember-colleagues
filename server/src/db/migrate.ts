import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.ts";

async function main() {
  console.log("Application des migrations Drizzle…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations appliquées.");
  await pool.end();
}

main().catch((err) => {
  console.error("Échec des migrations :", err);
  process.exit(1);
});
