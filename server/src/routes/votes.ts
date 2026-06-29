import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { graveVotes, colleagues } from "../db/schema.ts";
import { getSessionUser, requireUser } from "../session.ts";

const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const ID_PARAM_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: UUID_PATTERN } },
} as const;

export async function voteRoutes(app: FastifyInstance) {
  // Vote de l'utilisateur courant sur une tombe : +1, -1 ou 0 pour retirer.
  app.post(
    "/api/colleagues/:id/vote",
    {
      schema: {
        params: ID_PARAM_SCHEMA,
        body: {
          type: "object",
          required: ["value"],
          properties: {
            value: { type: "integer", enum: [-1, 0, 1] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { id } = request.params as { id: string };
      const { value } = request.body as { value: -1 | 0 | 1 };

      const [colleague] = await db.select({ id: colleagues.id }).from(colleagues).where(eq(colleagues.id, id)).limit(1);
      if (!colleague) return reply.code(404).send({ error: "Tombe introuvable." });

      // Mutation + recalcul agrégé dans une transaction pour éviter la corruption concurrente du voteScore.
      const total = await db.transaction(async (tx) => {
        if (value === 0) {
          await tx
            .delete(graveVotes)
            .where(and(eq(graveVotes.colleagueId, id), eq(graveVotes.userId, user.id)));
        } else {
          await tx
            .insert(graveVotes)
            .values({ colleagueId: id, userId: user.id, value })
            .onConflictDoUpdate({
              target: [graveVotes.colleagueId, graveVotes.userId],
              set: { value },
            });
        }

        const [{ sum }] = await tx
          .select({ sum: sql<number>`coalesce(sum(${graveVotes.value}), 0)::int` })
          .from(graveVotes)
          .where(eq(graveVotes.colleagueId, id));

        await tx.update(colleagues).set({ voteScore: sum }).where(eq(colleagues.id, id));
        return sum;
      });

      return { voteScore: total };
    },
  );

  // Vote actuel de l'utilisateur sur une tombe (0 si pas de vote ou non connecté).
  app.get(
    "/api/colleagues/:id/vote",
    { schema: { params: ID_PARAM_SCHEMA } },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const [colleague] = await db.select({ id: colleagues.id }).from(colleagues).where(eq(colleagues.id, id)).limit(1);
      if (!colleague) return reply.code(404).send({ error: "Tombe introuvable." });

      const user = await getSessionUser(request);
      if (!user) return { value: 0 };

      const [vote] = await db
        .select({ value: graveVotes.value })
        .from(graveVotes)
        .where(and(eq(graveVotes.colleagueId, id), eq(graveVotes.userId, user.id)))
        .limit(1);

      return { value: vote?.value ?? 0 };
    },
  );
}
