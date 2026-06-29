import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues, graveOfferings } from "../db/schema.ts";
import { requireUser } from "../session.ts";
import { ID_PARAM_SCHEMA } from "../lib/schemas.ts";
import { activeOfferingCounts, OFFERING_DURATIONS } from "../lib/offerings.ts";

export async function offeringRoutes(app: FastifyInstance) {
  // Liste les offrandes actives d'une tombe.
  app.get(
    "/api/colleagues/:id/offerings",
    { schema: { params: ID_PARAM_SCHEMA } },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      const now = new Date();
      return db
        .select({
          id: graveOfferings.id,
          type: graveOfferings.type,
          authorName: graveOfferings.authorName,
          expiresAt: graveOfferings.expiresAt,
          createdAt: graveOfferings.createdAt,
        })
        .from(graveOfferings)
        .where(
          and(
            eq(graveOfferings.colleagueId, id),
            or(isNull(graveOfferings.expiresAt), gt(graveOfferings.expiresAt, now)),
          ),
        )
        .orderBy(asc(graveOfferings.createdAt));
    },
  );

  // Dépose une offrande sur une tombe (auth requise).
  app.post(
    "/api/colleagues/:id/offerings",
    {
      schema: {
        params: ID_PARAM_SCHEMA,
        body: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["flower", "candle", "stone"] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { id } = request.params as { id: string };
      const { type } = request.body as { type: "flower" | "candle" | "stone" };

      const [exists] = await db
        .select({ id: colleagues.id })
        .from(colleagues)
        .where(eq(colleagues.id, id))
        .limit(1);
      if (!exists) return reply.code(404).send({ error: "Tombe introuvable." });

      const durationMs = OFFERING_DURATIONS[type];
      const expiresAt = durationMs !== null ? new Date(Date.now() + durationMs) : null;

      await db.insert(graveOfferings).values({
        colleagueId: id,
        userId: user.id,
        authorName: user.name,
        type,
        expiresAt,
      });

      const now = new Date();
      const countsMap = await activeOfferingCounts([id], now);
      return reply.code(201).send(countsMap.get(id) ?? { flower: 0, candle: 0, stone: 0 });
    },
  );
}
