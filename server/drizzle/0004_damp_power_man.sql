CREATE TABLE "grave_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"colleague_id" uuid NOT NULL,
	"user_id" text,
	"author_name" varchar(160) NOT NULL,
	"type" varchar(20) NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grave_offerings" ADD CONSTRAINT "grave_offerings_colleague_id_colleagues_id_fk" FOREIGN KEY ("colleague_id") REFERENCES "public"."colleagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grave_offerings" ADD CONSTRAINT "grave_offerings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grave_offerings_colleague_idx" ON "grave_offerings" USING btree ("colleague_id");