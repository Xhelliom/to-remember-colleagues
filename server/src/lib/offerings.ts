import { and, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { graveOfferings } from "../db/schema.ts";

export type OfferingCounts = { flower: number; candle: number; stone: number };

/** Durées de vie des offrandes en millisecondes (null = permanent). */
export const OFFERING_DURATIONS: Record<string, number | null> = {
  flower: 7 * 24 * 3600 * 1000,
  candle: 24 * 3600 * 1000,
  stone: null,
};

/** Compte les offrandes actives par type pour un ensemble de tombes. */
export async function activeOfferingCounts(
  colleagueIds: string[],
  now: Date,
): Promise<Map<string, OfferingCounts>> {
  const map = new Map<string, OfferingCounts>();
  if (colleagueIds.length === 0) return map;

  const rows = await db
    .select({
      colleagueId: graveOfferings.colleagueId,
      type: graveOfferings.type,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(graveOfferings)
    .where(
      and(
        inArray(graveOfferings.colleagueId, colleagueIds),
        or(isNull(graveOfferings.expiresAt), gt(graveOfferings.expiresAt, now)),
      ),
    )
    .groupBy(graveOfferings.colleagueId, graveOfferings.type);

  for (const r of rows) {
    if (!map.has(r.colleagueId)) {
      map.set(r.colleagueId, { flower: 0, candle: 0, stone: 0 });
    }
    const counts = map.get(r.colleagueId)!;
    if (r.type === "flower") counts.flower = r.count;
    else if (r.type === "candle") counts.candle = r.count;
    else if (r.type === "stone") counts.stone = r.count;
  }
  return map;
}
