import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { colleagues } from "../db/schema.ts";
import { requireUser } from "../session.ts";
import { ID_PARAM_SCHEMA } from "../lib/schemas.ts";
import { effectiveMaintenance, MAINTAIN_BOOST } from "../lib/maintenance.ts";

export async function maintenanceRoutes(app: FastifyInstance) {
  // Entretient une tombe : augmente son niveau de soin (auth requise, issue #14).
  app.post(
    "/api/colleagues/:id/maintain",
    { schema: { params: ID_PARAM_SCHEMA } },
    async (request, reply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const { id } = request.params as { id: string };
      const [row] = await db
        .select({
          id: colleagues.id,
          maintenance: colleagues.maintenance,
          maintainedAt: colleagues.maintainedAt,
          createdAt: colleagues.createdAt,
        })
        .from(colleagues)
        .where(eq(colleagues.id, id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "Tombe introuvable." });

      const now = new Date();
      const reference = row.maintainedAt ?? row.createdAt;
      const current = effectiveMaintenance(row.maintenance, reference, now);
      const newBase = Math.min(1, current + MAINTAIN_BOOST);

      await db
        .update(colleagues)
        .set({ maintenance: newBase, maintainedAt: now })
        .where(eq(colleagues.id, id));

      return { maintenance: newBase };
    },
  );
}
