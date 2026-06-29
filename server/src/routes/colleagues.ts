import type { FastifyInstance } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues, companies, companyMembers } from "../db/schema.ts";
import { getSessionUser, requireUser } from "../session.ts";
import { newGraveSeed } from "../lib/random.ts";
import { ID_PARAM_SCHEMA } from "../lib/schemas.ts";
import { activeOfferingCounts, type OfferingCounts } from "../lib/offerings.ts";
import { effectiveMaintenance } from "../lib/maintenance.ts";
import { deterministicAnagram } from "../lib/anagram.ts";

/** Vérifie si un utilisateur est membre d'un cimetière donné. */
async function isCemeteryMember(companyId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const rows = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

type ColleagueRow = {
  id: string; name: string; quote: string; departedOn: string | null;
  graveSeed: number; voteScore: number; maintenance: number;
  maintainedAt: Date | null; createdAt: Date;
};

/** Sérialise une ligne de tombe avec anonymisation, maintenance effective et offrandes. */
function serializeColleague(r: ColleagueRow, isMember: boolean, now: Date, offeringCounts: OfferingCounts) {
  return {
    id: r.id,
    name: isMember ? r.name : deterministicAnagram(r.name),
    quote: r.quote,
    departedOn: r.departedOn,
    graveSeed: r.graveSeed,
    voteScore: r.voteScore,
    maintenance: effectiveMaintenance(r.maintenance, r.maintainedAt ?? r.createdAt, now),
    createdAt: r.createdAt,
    offeringCounts,
    construction: r.departedOn !== null && new Date(r.departedOn) > now,
  };
}

export async function colleagueRoutes(app: FastifyInstance) {
  // Liste des collègues (tombes) d'un cimetière.
  app.get("/api/companies/:id/colleagues", { schema: { params: ID_PARAM_SCHEMA } }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [company] = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        description: companies.description,
        createdAt: companies.createdAt,
      })
      .from(companies)
      .where(eq(companies.id, id))
      .limit(1);
    if (!company) return reply.code(404).send({ error: "Cimetière introuvable." });

    const rows = await db
      .select({
        id: colleagues.id,
        name: colleagues.name,
        quote: colleagues.quote,
        departedOn: colleagues.departedOn,
        graveSeed: colleagues.graveSeed,
        voteScore: colleagues.voteScore,
        maintenance: colleagues.maintenance,
        maintainedAt: colleagues.maintainedAt,
        createdAt: colleagues.createdAt,
      })
      .from(colleagues)
      .where(eq(colleagues.companyId, id))
      .orderBy(asc(colleagues.createdAt));

    // Karma = somme des voteScores (issue #3).
    const karma = rows.reduce((sum, c) => sum + c.voteScore, 0);

    const now = new Date();
    const sessionUser = await getSessionUser(request);
    const [counts, isMember] = await Promise.all([
      activeOfferingCounts(rows.map((r) => r.id), now),
      isCemeteryMember(id, sessionUser?.id ?? null),
    ]);

    const enriched = rows.map((r) =>
      serializeColleague(r, isMember, now, counts.get(r.id) ?? { flower: 0, candle: 0, stone: 0 }),
    );

    return { company, colleagues: enriched, karma, anonymized: !isMember };
  });

  // Ajout d'un collègue (auth requise).
  app.post(
    "/api/companies/:id/colleagues",
    {
      schema: {
        params: ID_PARAM_SCHEMA,
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

      const [company] = await db
        .select({ id: companies.id, closedAt: companies.closedAt })
        .from(companies)
        .where(eq(companies.id, id))
        .limit(1);
      if (!company) return reply.code(404).send({ error: "Cimetière introuvable." });
      if (company.closedAt) {
        return reply.code(403).send({ error: "Ce cimetière est fermé — aucune nouvelle tombe possible." });
      }

      const graveSeed = newGraveSeed();
      const [created] = await db
        .insert(colleagues)
        .values({ companyId: id, name, quote, departedOn: departedOn ?? null, graveSeed, addedBy: user.id })
        .returning();

      // L'ajouteur devient membre du cimetière (issue #22).
      await db.insert(companyMembers).values({ companyId: id, userId: user.id }).onConflictDoNothing();

      const now = new Date();
      const construction = created!.departedOn !== null && new Date(created!.departedOn) > now;
      return reply.code(201).send({ ...created, construction, offeringCounts: { flower: 0, candle: 0, stone: 0 } });
    },
  );

  // Détail d'un collègue par son id (issue #18 : lien de partage vers une tombe).
  app.get("/api/colleagues/:id", { schema: { params: ID_PARAM_SCHEMA } }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [row] = await db
      .select({
        id: colleagues.id,
        name: colleagues.name,
        quote: colleagues.quote,
        departedOn: colleagues.departedOn,
        graveSeed: colleagues.graveSeed,
        voteScore: colleagues.voteScore,
        maintenance: colleagues.maintenance,
        maintainedAt: colleagues.maintainedAt,
        createdAt: colleagues.createdAt,
        companyId: colleagues.companyId,
        companyName: companies.name,
        companySlug: companies.slug,
        companyClosed: companies.closedAt,
      })
      .from(colleagues)
      .innerJoin(companies, eq(companies.id, colleagues.companyId))
      .where(eq(colleagues.id, id))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "Tombe introuvable." });

    const now = new Date();
    const sessionUser = await getSessionUser(request);
    const [counts, karmaResult, isMember] = await Promise.all([
      activeOfferingCounts([id], now),
      db.select({ karma: sql<number>`coalesce(sum(${colleagues.voteScore}), 0)::int` })
        .from(colleagues).where(eq(colleagues.companyId, row.companyId)),
      isCemeteryMember(row.companyId, sessionUser?.id ?? null),
    ]);

    return {
      ...serializeColleague(row, isMember, now, counts.get(id) ?? { flower: 0, candle: 0, stone: 0 }),
      company: { id: row.companyId, name: row.companyName, slug: row.companySlug, closed: row.companyClosed !== null },
      karma: karmaResult[0]?.karma ?? 0,
      anonymized: !isMember,
    };
  });
}
