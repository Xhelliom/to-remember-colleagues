import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { graveMessages, colleagues } from "../db/schema.ts";
import { requireUser } from "../session.ts";

const MAX_CONTENT = 500;

export async function messageRoutes(app: FastifyInstance) {
  // Messages du livre d'or d'une tombe.
  app.get("/api/colleagues/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [colleague] = await db.select().from(colleagues).where(eq(colleagues.id, id)).limit(1);
    if (!colleague) return reply.code(404).send({ error: "Tombe introuvable." });

    return db
      .select({
        id: graveMessages.id,
        authorName: graveMessages.authorName,
        content: graveMessages.content,
        createdAt: graveMessages.createdAt,
      })
      .from(graveMessages)
      .where(eq(graveMessages.colleagueId, id))
      .orderBy(asc(graveMessages.createdAt));
  });

  // Laisser un message dans le livre d'or (auth requise).
  app.post(
    "/api/colleagues/:id/messages",
    {
      schema: {
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: MAX_CONTENT },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { id } = request.params as { id: string };
      const { content } = request.body as { content: string };

      const [colleague] = await db.select().from(colleagues).where(eq(colleagues.id, id)).limit(1);
      if (!colleague) return reply.code(404).send({ error: "Tombe introuvable." });

      const [created] = await db
        .insert(graveMessages)
        .values({ colleagueId: id, authorId: user.id, authorName: user.name, content })
        .returning({
          id: graveMessages.id,
          authorName: graveMessages.authorName,
          content: graveMessages.content,
          createdAt: graveMessages.createdAt,
        });

      return reply.code(201).send(created);
    },
  );
}
