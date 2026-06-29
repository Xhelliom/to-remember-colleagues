ALTER TABLE "colleagues" ADD COLUMN "vote_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "colleagues" ADD COLUMN "maintenance" real DEFAULT 0.8 NOT NULL;