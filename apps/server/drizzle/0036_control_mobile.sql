CREATE TABLE "admin_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"push_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_ip" text
);
--> statement-breakpoint
CREATE TABLE "team_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "uptime_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"details" jsonb
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "invites_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_notices" ADD COLUMN "allow_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notices" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "admin_devices" ADD CONSTRAINT "admin_devices_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_replies" ADD CONSTRAINT "team_replies_notice_id_user_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."user_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_replies" ADD CONSTRAINT "team_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_alerts_created_idx" ON "admin_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_devices_admin_idx" ON "admin_devices" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "team_replies_user_idx" ON "team_replies" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "team_replies_unread_idx" ON "team_replies" USING btree ("created_at") WHERE "team_replies"."read_at" is null;--> statement-breakpoint
CREATE INDEX "uptime_events_started_idx" ON "uptime_events" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_device_id_admin_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."admin_devices"("id") ON DELETE cascade ON UPDATE no action;