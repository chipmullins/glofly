ALTER TABLE "conversation_members" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discord_bridges" ADD COLUMN "new_channels" jsonb DEFAULT '[]'::jsonb NOT NULL;