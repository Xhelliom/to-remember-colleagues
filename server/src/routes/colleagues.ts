import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues, companies, companyMembers } from "../db/schema.ts";
import { getSessionUser, requireUser } from "../session.ts";
import { newGraveSeed } from "../lib/random.ts";
import { ID_PARAM_SCHEMA } from "../lib/schemas.ts";
import { activeOfferingCounts } from "../lib/offerings.ts";
import { effectiveMaintenance } from "../lib/maintenance.ts";
import { deterministicAnagram } from "../lib/anagram.ts";

/** Vérifie si l'utilisateur de la requête est membre d'un cimetière donné. */
async function isCemeteryMember(companyId: string, request: FastifyRequest): Promise<boolean> {
  const sessionUser = await getSessionUser(request);
  if (!sessionUser) return false;
  const rows = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, sessionUser.id)))
    .limit(1);
  return rows.length > 0;
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
        maintainedAt: colleagues.maintainedAt,
        createdAt: colleagues.createdAt,
      })
      .from(colleagues)
      .where(eq(colleagues.companyId, id))
      .orderBy(asc(colleagues.createdAt));

    // Karma = somme des voteScores (issue #3) pour l'affichage de la jauge dans le HUD.
    const karma = rows.reduce((sum, c) => sum + c.voteScore, 0);

    // Offrandes actives + entretien effectif (issues #7 et #14).
    const now = new Date();
    const counts = await activeOfferingCounts(rows.map((r) => r.id), now);

    // Vérifier si l'utilisateur courant est membre (issue #22).
    const isMember = await isCemeteryMember(id, request);

    const enriched = rows.map((r) => {
      const construction = r.departedOn !== null && new Date(r.departedOn) > now;
      return {
        id: r.id,
        // Noms anonymisés pour les non-membres (issue #22).
        name: isMember ? r.name : deterministicAnagram(r.name),
        quote: r.quote,
        departedOn: r.departedOn,
        graveSeed: r.graveSeed,
        voteScore: r.voteScore,
        // Maintenance effective = base décroissante depuis la dernière action (issue #14).
        maintenance: effectiveMaintenance(r.maintenance, r.maintainedAt ?? r.createdAt, now),
        createdAt: r.createdAt,
        offeringCounts: counts.get(r.id) ?? { flower: 0, candle: 0, stone: 0 },
        // Départ annoncé mais pas encore survenu (issue #21).
        construction,
      };
    });

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
      if (!company) {
        return reply.code(404).send({ error: "Cimetière introuvable." });
      }
      if (company.closedAt) {
        return reply.code(403).send({ error: "Ce cimetière est fermé — aucune nouvelle tombe possible." });
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
    const counts = await activeOfferingCounts([id], now);
    const [karmaRow] = await db
      .select({ karma: sql<number>`coalesce(sum(${colleagues.voteScore}), 0)::int` })
      .from(colleagues)
      .where(eq(colleagues.companyId, row.companyId));

    const isMember = await isCemeteryMember(row.companyId, request);
    const construction = row.departedOn !== null && new Date(row.departedOn) > now;

    return {
      id: row.id,
      name: isMember ? row.name : deterministicAnagram(row.name),
      quote: row.quote,
      departedOn: row.departedOn,
      graveSeed: row.graveSeed,
      voteScore: row.voteScore,
      maintenance: effectiveMaintenance(row.maintenance, row.maintainedAt ?? row.createdAt, now),
      createdAt: row.createdAt,
      offeringCounts: counts.get(id) ?? { flower: 0, candle: 0, stone: 0 },
      construction,
      company: { id: row.companyId, name: row.companyName, slug: row.companySlug, closed: row.companyClosed !== null },
      karma: karmaRow?.karma ?? 0,
      anonymized: !isMember,
    };
  });
}
