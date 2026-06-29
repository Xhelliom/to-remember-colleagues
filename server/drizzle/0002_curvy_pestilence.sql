CREATE TABLE "grave_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"colleague_id" uuid NOT NULL,
	"author_id" text,
	"author_name" varchar(160) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grave_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"colleague_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grave_votes_unique" UNIQUE("colleague_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "grave_messages" ADD CONSTRAINT "grave_messages_colleague_id_colleagues_id_fk" FOREIGN KEY ("colleague_id") REFERENCES "public"."colleagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grave_messages" ADD CONSTRAINT "grave_messages_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grave_votes" ADD CONSTRAINT "grave_votes_colleague_id_colleagues_id_fk" FOREIGN KEY ("colleague_id") REFERENCES "public"."colleagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grave_votes" ADD CONSTRAINT "grave_votes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grave_messages_colleague_idx" ON "grave_messages" USING btree ("colleague_id");--> statement-breakpoint
CREATE INDEX "grave_votes_colleague_idx" ON "grave_votes" USING btree ("colleague_id");