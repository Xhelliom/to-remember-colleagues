import { pgTable, uuid, varchar, text, integer, real, date, timestamp, index } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.ts";

// Ré-export des tables Better Auth pour que drizzle-kit les inclue dans les migrations.
export { user, session, account, verification } from "./auth-schema.ts";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  description: text("description"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const colleagues = pgTable(
  "colleagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    quote: text("quote").notNull(),
    departedOn: date("departed_on"),
    graveSeed: integer("grave_seed").notNull(),
    // Axe 2 (issue #25) : solde des votes, hanté (négatif) ↔ paradisiaque (positif).
    voteScore: integer("vote_score").notNull().default(0),
    // Axe 3 (issue #25) : état d'entretien, 0 = négligé, 1 = impeccablement fleuri.
    maintenance: real("maintenance").notNull().default(0.8),
    addedBy: text("added_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("colleagues_company_idx").on(table.companyId)],
);

export type Company = typeof companies.$inferSelect;
export type Colleague = typeof colleagues.$inferSelect;
