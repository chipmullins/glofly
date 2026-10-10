CREATE TYPE "public"."announcement_tone" AS ENUM('info', 'important');--> statement-breakpoint
CREATE TYPE "public"."report_outcome" AS ENUM('dismissed', 'removed', 'warned', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"tone" "announcement_tone" DEFAULT 'info' NOT NULL,
	"link_url" text,
	"link_label" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"reported_user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"snapshot" jsonb NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"outcome" "report_outcome",
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'warning' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "group_position" integer;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "mentions" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notices" ADD CONSTRAINT "user_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_reported_user_idx" ON "reports" USING btree ("reported_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_open_per_message_idx" ON "reports" USING btree ("reporter_id","message_id") WHERE "reports"."status" = 'open' and "reports"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "user_notices_user_idx" ON "user_notices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_mentions_idx" ON "messages" USING gin ("mentions");