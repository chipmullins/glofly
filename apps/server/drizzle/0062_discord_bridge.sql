CREATE TABLE "discord_bridge_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bridge_id" uuid NOT NULL,
	"discord_channel_id" text NOT NULL,
	"discord_channel_name" text NOT NULL,
	"nebula_id" uuid NOT NULL,
	"webhook_id" text NOT NULL,
	"webhook_token" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bridge_channels_discord_channel_id_unique" UNIQUE("discord_channel_id"),
	CONSTRAINT "discord_bridge_channels_nebula_id_unique" UNIQUE("nebula_id")
);
--> statement-breakpoint
CREATE TABLE "discord_bridge_messages" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"discord_message_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_bridges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"guild_icon" text,
	"api_key_id" uuid,
	"bot_user_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lost_at" timestamp with time zone,
	CONSTRAINT "discord_bridges_constellation_id_unique" UNIQUE("constellation_id"),
	CONSTRAINT "discord_bridges_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "bridged" jsonb;--> statement-breakpoint
ALTER TABLE "discord_bridge_channels" ADD CONSTRAINT "discord_bridge_channels_bridge_id_discord_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."discord_bridges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridge_channels" ADD CONSTRAINT "discord_bridge_channels_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridge_messages" ADD CONSTRAINT "discord_bridge_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridge_messages" ADD CONSTRAINT "discord_bridge_messages_channel_id_discord_bridge_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."discord_bridge_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridges" ADD CONSTRAINT "discord_bridges_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridges" ADD CONSTRAINT "discord_bridges_api_key_id_constellation_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."constellation_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridges" ADD CONSTRAINT "discord_bridges_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_bridges" ADD CONSTRAINT "discord_bridges_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_bridge_channels_bridge_idx" ON "discord_bridge_channels" USING btree ("bridge_id");--> statement-breakpoint
CREATE INDEX "discord_bridge_messages_discord_idx" ON "discord_bridge_messages" USING btree ("discord_message_id");