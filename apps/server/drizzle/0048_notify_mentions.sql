ALTER TABLE "constellation_members" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "ignore_everyone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "ignore_roles" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "follow_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_roles" ADD COLUMN "mentionable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mention_everyone" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mention_roles" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "group_mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_group_mentions_idx" ON "messages" USING gin ("group_mentions");--> statement-breakpoint
-- Hand-added backfill: Admins and Moderators may mention @everyone, @here and all roles (board 24:
-- off for Members by default).
UPDATE "constellation_roles" SET "permissions" = array_append("permissions", 'mentionEveryone')
  WHERE "kind" IN ('admin', 'moderator') AND NOT ('mentionEveryone' = ANY("permissions"));
