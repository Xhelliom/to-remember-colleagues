import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { companies, colleagues } from "../db/schema.ts";
import { requireUser } from "../session.ts";
import { slugify, uniqueSlug } from "../lib/slug.ts";

const createCompanySchema = {
  body: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 2000 },
    },
  },
} as const;

export async function companyRoutes(app: FastifyInstance) {
  // Liste des cimetières (entreprises) avec le nombre de tombes.
  app.get("/api/companies", async () => {
    return db
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
  });

  // Création d'un cimetière (auth requise).
  app.post("/api/companies", { schema: createCompanySchema }, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const { name, description } = request.body as { name: string; description?: string };
    const base = slugify(name);

    const taken = await db
      .select({ slug: companies.slug })
      .from(companies)
      .where(sql`${companies.slug} = ${base} or ${companies.slug} like ${base + "-%"}`);
    const slug = uniqueSlug(
      base,
      taken.map((row) => row.slug),
    );

    const [created] = await db
      .insert(companies)
      .values({ name, description: description ?? null, slug, createdBy: user.id })
      .returning();
    return reply.code(201).send(created);
  });
}
