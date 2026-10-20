CREATE TABLE "automod_held" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"body" text NOT NULL,
	"reply_to_id" uuid,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" uuid,
	"released_message_id" uuid
);
--> statement-breakpoint
CREATE TABLE "constellation_automod" (
	"constellation_id" uuid PRIMARY KEY NOT NULL,
	"words_on" boolean DEFAULT false NOT NULL,
	"words" text[] DEFAULT '{}'::text[] NOT NULL,
	"link_guard_on" boolean DEFAULT false NOT NULL,
	"slow_mode_on" boolean DEFAULT false NOT NULL,
	"slow_mode" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_member_wait_minutes" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellation_event_rsvps" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constellation_event_rsvps_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "constellation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"nebula_id" uuid NOT NULL,
	"message_id" uuid,
	"voice_nebula_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"time_zone" text,
	"host_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_reads" (
	"user_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_reads_user_id_item_key_pk" PRIMARY KEY("user_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "inbox_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cleared_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "rules_agreed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellation_roles" ADD COLUMN "self_assign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "accent" text;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "banner_version" text;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "rules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "welcome" jsonb;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "celebrated_members" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "celebrated_years" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_released_message_id_messages_id_fk" FOREIGN KEY ("released_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_automod" ADD CONSTRAINT "constellation_automod_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_automod" ADD CONSTRAINT "constellation_automod_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_event_rsvps" ADD CONSTRAINT "constellation_event_rsvps_event_id_constellation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."constellation_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_event_rsvps" ADD CONSTRAINT "constellation_event_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_events" ADD CONSTRAINT "constellation_events_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_events" ADD CONSTRAINT "constellation_events_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_events" ADD CONSTRAINT "constellation_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_events" ADD CONSTRAINT "constellation_events_voice_nebula_id_nebulas_id_fk" FOREIGN KEY ("voice_nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_events" ADD CONSTRAINT "constellation_events_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_reads" ADD CONSTRAINT "inbox_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_state" ADD CONSTRAINT "inbox_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automod_held_constellation_idx" ON "automod_held" USING btree ("constellation_id","created_at");--> statement-breakpoint
CREATE INDEX "constellation_event_rsvps_user_idx" ON "constellation_event_rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "constellation_events_constellation_idx" ON "constellation_events" USING btree ("constellation_id","starts_at");--> statement-breakpoint
CREATE INDEX "constellation_events_due_idx" ON "constellation_events" USING btree ("starts_at") WHERE "constellation_events"."cancelled_at" is null and "constellation_events"."started_at" is null;--> statement-breakpoint
-- Data backfills (hand-added): existing members never see the new welcome steps,
-- milestones and birthdays already passed are not posted late, and the existing
-- built-in roles get the new "events" permission.
UPDATE "constellation_members" SET "welcomed_at" = "joined_at";--> statement-breakpoint
UPDATE "constellations" c SET "celebrated_members" = coalesce((SELECT max(m) FROM unnest(ARRAY[10,50,100,250,500,1000]) AS m WHERE m <= (SELECT count(*) FROM "constellation_members" cm WHERE cm."constellation_id" = c."id")), 0);--> statement-breakpoint
UPDATE "constellations" SET "celebrated_years" = floor(extract(epoch from (now() - "created_at")) / 31557600)::int;--> statement-breakpoint
UPDATE "constellation_roles" SET "permissions" = array_append("permissions", 'events') WHERE "kind" IN ('admin','moderator','member') AND NOT ('events' = ANY("permissions"));
