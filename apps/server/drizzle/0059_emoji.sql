CREATE TABLE "constellation_emoji" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"outside" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "emojis" jsonb;--> statement-breakpoint
ALTER TABLE "constellation_emoji" ADD CONSTRAINT "constellation_emoji_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_emoji" ADD CONSTRAINT "constellation_emoji_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_emoji_idx" ON "constellation_emoji" USING btree ("constellation_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_emoji_name_idx" ON "constellation_emoji" USING btree ("constellation_id",lower("name")) WHERE "constellation_emoji"."kind" = 'emoji';--> statement-breakpoint
-- Communities round 2: Admins can manage emoji & stickers; Admins and Moderators can manage stages.
UPDATE "constellation_roles" SET "permissions" = array_append("permissions", 'manageEmoji')
  WHERE "kind" = 'admin' AND NOT ('manageEmoji' = ANY("permissions"));--> statement-breakpoint
UPDATE "constellation_roles" SET "permissions" = array_append("permissions", 'manageStages')
  WHERE "kind" IN ('admin', 'moderator') AND NOT ('manageStages' = ANY("permissions"));
