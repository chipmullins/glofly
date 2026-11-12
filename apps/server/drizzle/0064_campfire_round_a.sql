CREATE TABLE "campfire_homebrew" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"gm_notes" text DEFAULT '' NOT NULL,
	"picture_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"giver" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_rsvps" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campfire_rsvps_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campfire_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"recap" text DEFAULT '' NOT NULL,
	"recap_posted_at" timestamp with time zone,
	"stats" jsonb,
	"before" boolean DEFAULT false NOT NULL,
	"reminded" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD COLUMN "pitch" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD COLUMN "banner_file_id" uuid;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD COLUMN "loot" jsonb;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "campfire_homebrew" ADD CONSTRAINT "campfire_homebrew_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_homebrew" ADD CONSTRAINT "campfire_homebrew_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_journal" ADD CONSTRAINT "campfire_journal_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_journal" ADD CONSTRAINT "campfire_journal_picture_file_id_campfire_files_id_fk" FOREIGN KEY ("picture_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_quests" ADD CONSTRAINT "campfire_quests_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_rsvps" ADD CONSTRAINT "campfire_rsvps_session_id_campfire_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."campfire_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_rsvps" ADD CONSTRAINT "campfire_rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_sessions" ADD CONSTRAINT "campfire_sessions_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campfire_homebrew_campaign_idx" ON "campfire_homebrew" USING btree ("campaign_id","kind");--> statement-breakpoint
CREATE INDEX "campfire_journal_campaign_idx" ON "campfire_journal" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_quests_campaign_idx" ON "campfire_quests" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_sessions_campaign_idx" ON "campfire_sessions" USING btree ("campaign_id","number");--> statement-breakpoint
CREATE INDEX "campfire_sessions_starts_idx" ON "campfire_sessions" USING btree ("starts_at");--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD CONSTRAINT "campfire_campaigns_banner_file_id_campfire_files_id_fk" FOREIGN KEY ("banner_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;