import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { graveVotes, colleagues } from "../db/schema.ts";
import { getSessionUser, requireUser } from "../session.ts";

export async function voteRoutes(app: FastifyInstance) {
  // Vote de l'utilisateur courant sur une tombe : +1, -1 ou 0 pour retirer.
  app.post(
    "/api/colleagues/:id/vote",
    {
      schema: {
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

      const [colleague] = await db.select().from(colleagues).where(eq(colleagues.id, id)).limit(1);
      if (!colleague) return reply.code(404).send({ error: "Tombe introuvable." });

      if (value === 0) {
        await db
          .delete(graveVotes)
          .where(and(eq(graveVotes.colleagueId, id), eq(graveVotes.userId, user.id)));
      } else {
        await db
          .insert(graveVotes)
          .values({ colleagueId: id, userId: user.id, value })
          .onConflictDoUpdate({
            target: [graveVotes.colleagueId, graveVotes.userId],
            set: { value },
          });
      }

      // Recalcule le voteScore agrégé et met à jour la colonne dénormalisée.
      const [{ total }] = await db
        .select({ total: sql<number>`coalesce(sum(${graveVotes.value}), 0)::int` })
        .from(graveVotes)
        .where(eq(graveVotes.colleagueId, id));

      await db.update(colleagues).set({ voteScore: total }).where(eq(colleagues.id, id));

      return { voteScore: total };
    },
  );

  // Vote actuel de l'utilisateur sur une tombe (0 si pas de vote ou non connecté).
  app.get("/api/colleagues/:id/vote", async (request) => {
    const { id } = request.params as { id: string };
    const user = await getSessionUser(request);
    if (!user) return { value: 0 };

    const [vote] = await db
      .select({ value: graveVotes.value })
      .from(graveVotes)
      .where(and(eq(graveVotes.colleagueId, id), eq(graveVotes.userId, user.id)))
      .limit(1);

    return { value: vote?.value ?? 0 };
  });
}
