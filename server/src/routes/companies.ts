import type { FastifyInstance } from "fastify";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { companies, colleagues } from "../db/schema.ts";
import { requireUser } from "../session.ts";
import { slugify, uniqueSlug } from "../lib/slug.ts";
import { companyStatus } from "../lib/company-status.ts";
import { ID_PARAM_SCHEMA } from "../lib/schemas.ts";

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
  // Liste des cimetières (entreprises) avec nombre de tombes, karma et statut.
  app.get("/api/companies", async () => {
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        description: companies.description,
        closedAt: companies.closedAt,
        createdAt: companies.createdAt,
        graveCount: sql<number>`count(${colleagues.id})::int`,
        // Karma = somme des votes des tombes (axe 2, issue #25).
        karma: sql<number>`coalesce(sum(${colleagues.voteScore}), 0)::int`,
        // Dernière inhumation, pour dériver le statut d'activité (issue #5).
        lastBurial: sql<string | null>`max(${colleagues.createdAt})`,
      })
      .from(companies)
      .leftJoin(colleagues, eq(colleagues.companyId, companies.id))
      .groupBy(companies.id)
      .orderBy(asc(companies.name));

    const now = Date.now();
    return rows.map(({ lastBurial, closedAt, ...row }) => ({
      ...row,
      status: companyStatus(row.graveCount, lastBurial, now, closedAt?.toISOString()),
    }));
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

  // Fermeture d'un cimetière (issue #6) : plus d'ajout de tombe possible.
  app.post(
    "/api/companies/:id/close",
    { schema: { params: ID_PARAM_SCHEMA } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { id } = request.params as { id: string };
      const [row] = await db
        .update(companies)
        .set({ closedAt: new Date() })
        .where(eq(companies.id, id))
        .returning({ id: companies.id });
      if (!row) return reply.code(404).send({ error: "Cimetière introuvable." });
      return { closed: true };
    },
  );

  // Réouverture d'un cimetière fermé (issue #6).
  app.post(
    "/api/companies/:id/reopen",
    { schema: { params: ID_PARAM_SCHEMA } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;
      const { id } = request.params as { id: string };
      const [row] = await db
        .update(companies)
        .set({ closedAt: null })
        .where(eq(companies.id, id))
        .returning({ id: companies.id });
      if (!row) return reply.code(404).send({ error: "Cimetière introuvable." });
      return { closed: false };
    },
  );
}
