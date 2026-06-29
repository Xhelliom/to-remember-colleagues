import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { companies, colleagues } from "../db/schema.ts";
import { requireUser } from "../session.ts";

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

export async function companyRoutes(app: FastifyInstance) {
  // Liste des cimetières (entreprises) avec le nombre de tombes.
  app.get("/api/companies", async () => {
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        description: companies.description,
        createdAt: companies.createdAt,
        graveCount: sql<number>`count(${colleagues.id})::int`,
      })
      .from(companies)
      .leftJoin(colleagues, eq(colleagues.companyId, companies.id))
      .groupBy(companies.id)
      .orderBy(asc(companies.name));
    return rows;
  });

  // Création d'un cimetière (auth requise).
  app.post(
    "/api/companies",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 160 },
            description: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { name, description } = request.body as { name: string; description?: string };
      let slug = slugify(name);
      if (!slug) slug = "cimetiere";

      // Garantit l'unicité du slug en cas de doublon.
      const existing = await db
        .select({ slug: companies.slug })
        .from(companies)
        .where(sql`${companies.slug} = ${slug} or ${companies.slug} like ${slug + "-%"}`);
      if (existing.some((row) => row.slug === slug)) {
        slug = `${slug}-${existing.length + 1}`;
      }

      const [created] = await db
        .insert(companies)
        .values({ name, description: description ?? null, slug, createdBy: user.id })
        .returning();
      return reply.code(201).send(created);
    },
  );
}
