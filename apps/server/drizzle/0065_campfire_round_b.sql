CREATE TABLE "campfire_sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD COLUMN "live" jsonb;--> statement-breakpoint
ALTER TABLE "campfire_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD COLUMN "elevation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD COLUMN "condition_timers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campfire_sounds" ADD CONSTRAINT "campfire_sounds_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_sounds" ADD CONSTRAINT "campfire_sounds_file_id_campfire_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."campfire_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campfire_sounds_campaign_idx" ON "campfire_sounds" USING btree ("campaign_id");