import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues } from "../db/schema.ts";

/** Renvoie la tombe si elle existe, null sinon. */
export async function findColleague(id: string): Promise<{ id: string } | null> {
  const [row] = await db.select({ id: colleagues.id }).from(colleagues).where(eq(colleagues.id, id)).limit(1);
  return row ?? null;
}
