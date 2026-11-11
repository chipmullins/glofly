CREATE TABLE "constellation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ban_created_at" timestamp with time zone NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reply" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"reported_user_id" uuid,
	"reporter_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"reason" text NOT NULL,
	"excerpt" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automod_held" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automod_held" ADD COLUMN "dismissed_by" uuid;--> statement-breakpoint
ALTER TABLE "constellation_bans" ADD COLUMN "appeals" text DEFAULT 'now' NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "raid_hold" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "safety" jsonb;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "joins_paused_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "raid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellation_appeals" ADD CONSTRAINT "constellation_appeals_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_appeals" ADD CONSTRAINT "constellation_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_appeals" ADD CONSTRAINT "constellation_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_reports" ADD CONSTRAINT "constellation_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_appeals_queue_idx" ON "constellation_appeals" USING btree ("constellation_id","status","created_at");--> statement-breakpoint
CREATE INDEX "constellation_appeals_user_idx" ON "constellation_appeals" USING btree ("user_id","constellation_id");--> statement-breakpoint
CREATE INDEX "constellation_reports_queue_idx" ON "constellation_reports" USING btree ("constellation_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_reports_open_message_idx" ON "constellation_reports" USING btree ("message_id") WHERE "constellation_reports"."status" = 'open';--> statement-breakpoint
ALTER TABLE "automod_held" ADD CONSTRAINT "automod_held_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_audit_target_idx" ON "constellation_audit_log" USING btree ("constellation_id","target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "constellation_audit_action_idx" ON "constellation_audit_log" USING btree ("constellation_id","action","created_at");