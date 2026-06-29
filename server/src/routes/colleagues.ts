import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues, companies } from "../db/schema.ts";
import { requireUser } from "../session.ts";
import { newGraveSeed } from "../lib/random.ts";

export async function colleagueRoutes(app: FastifyInstance) {
  // Liste des collègues (tombes) d'un cimetière.
  app.get("/api/companies/:id/colleagues", async (request, reply) => {
    const { id } = request.params as { id: string };

    const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
    if (!company) {
      return reply.code(404).send({ error: "Cimetière introuvable." });
    }

    const rows = await db
      .select({
        id: colleagues.id,
        name: colleagues.name,
        quote: colleagues.quote,
        departedOn: colleagues.departedOn,
        graveSeed: colleagues.graveSeed,
        voteScore: colleagues.voteScore,
        maintenance: colleagues.maintenance,
        createdAt: colleagues.createdAt,
      })
      .from(colleagues)
      .where(eq(colleagues.companyId, id))
      .orderBy(asc(colleagues.createdAt));

    // Karma = somme des voteScores (issue #3) pour l'affichage de la jauge dans le HUD.
    const karma = rows.reduce((sum, c) => sum + c.voteScore, 0);

    return { company, colleagues: rows, karma };
  });

  // Ajout d'un collègue (auth requise).
  app.post(
    "/api/companies/:id/colleagues",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "quote"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            quote: { type: "string", minLength: 1, maxLength: 1000 },
            departedOn: { type: "string", format: "date" },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { id } = request.params as { id: string };
      const { name, quote, departedOn } = request.body as {
        name: string;
        quote: string;
        departedOn?: string;
      };

      const [company] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
      if (!company) {
        return reply.code(404).send({ error: "Cimetière introuvable." });
      }

      const graveSeed = newGraveSeed();

      const [created] = await db
        .insert(colleagues)
        .values({
          companyId: id,
          name,
          quote,
          departedOn: departedOn ?? null,
          graveSeed,
          addedBy: user.id,
        })
        .returning();

      return reply.code(201).send(created);
    },
  );
}
