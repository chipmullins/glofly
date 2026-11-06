CREATE TABLE "constellation_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constellation_api_keys" ADD COLUMN "interactions_url" text;--> statement-breakpoint
ALTER TABLE "constellation_api_keys" ADD COLUMN "interactions_secret" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "buttons" jsonb;--> statement-breakpoint
ALTER TABLE "constellation_commands" ADD CONSTRAINT "constellation_commands_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_commands" ADD CONSTRAINT "constellation_commands_key_id_constellation_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."constellation_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_commands_name_idx" ON "constellation_commands" USING btree ("constellation_id","name");