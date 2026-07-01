import { ilike } from "drizzle-orm";
import { db, pool } from "./db/client.ts";
import { companies } from "./db/schema.ts";

// Nettoie les entreprises laissées par les tests (intégration + e2e), qui ne
// suppriment jamais ce qu'ils créent : "Studio Intégration" et "Studio E2E <ts>".
const deleted = await db
  .delete(companies)
  .where(ilike(companies.name, "studio%"))
  .returning({ name: companies.name });

console.log(`${deleted.length} entreprise(s) de test supprimée(s) :`, deleted.map((c) => c.name));

await pool.end();
