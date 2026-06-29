import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://cimetiere:cimetiere@localhost:5499/cimetiere";

export const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema, casing: "snake_case" });

export { schema };
