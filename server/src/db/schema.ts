import { pgTable, uuid, varchar, text, integer, real, date, timestamp, index, unique } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.ts";

// Ré-export des tables Better Auth pour que drizzle-kit les inclue dans les migrations.
export { user, session, account, verification } from "./auth-schema.ts";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  description: text("description"),
  // null = ouvert ; non-null = fermé (issue #6 cycle de vie)
  closedAt: timestamp("closed_at", { withTimezone: true }),
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

// Livre d'or (#9) : messages laissés sur une tombe par les visiteurs.
export const graveMessages = pgTable(
  "grave_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    colleagueId: uuid("colleague_id")
      .notNull()
      .references(() => colleagues.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 160 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("grave_messages_colleague_idx").on(table.colleagueId)],
);

// Votes (#2) : upvote/downvote d'une tombe (1 vote par utilisateur par tombe).
export const graveVotes = pgTable(
  "grave_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    colleagueId: uuid("colleague_id")
      .notNull()
      .references(() => colleagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    value: integer("value").notNull(), // +1 ou -1
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("grave_votes_colleague_idx").on(table.colleagueId),
    unique("grave_votes_unique").on(table.colleagueId, table.userId),
  ],
);

// Offrandes éphémères déposées sur une tombe (issue #7).
export const graveOfferings = pgTable(
  "grave_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    colleagueId: uuid("colleague_id")
      .notNull()
      .references(() => colleagues.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    authorName: varchar("author_name", { length: 160 }).notNull(),
    // 'flower' (7j) | 'candle' (24h) | 'stone' (permanent)
    type: varchar("type", { length: 20 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("grave_offerings_colleague_idx").on(table.colleagueId)],
);

export type Company = typeof companies.$inferSelect;
export type Colleague = typeof colleagues.$inferSelect;
export type GraveMessage = typeof graveMessages.$inferSelect;
export type GraveVote = typeof graveVotes.$inferSelect;
export type GraveOffering = typeof graveOfferings.$inferSelect;
