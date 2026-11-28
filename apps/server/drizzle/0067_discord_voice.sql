CREATE TABLE "discord_bridge_voice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bridge_id" uuid NOT NULL,
	"discord_channel_id" text NOT NULL,
	"discord_channel_name" text NOT NULL,
	"nebula_id" uuid NOT NULL,
	"status_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bridge_voice_discord_channel_id_unique" UNIQUE("discord_channel_id"),
	CONSTRAINT "discord_bridge_voice_nebula_id_unique" UNIQUE("nebula_id")
);
--> statement-breakpoint
ALTER TABLE "discord_bridge_voice" ADD CONSTRAINT "discord_bridge_voice_bridge_id_discord_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."discord_bridges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridge_voice" ADD CONSTRAINT "discord_bridge_voice_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_bridge_voice_bridge_idx" ON "discord_bridge_voice" USING btree ("bridge_id");