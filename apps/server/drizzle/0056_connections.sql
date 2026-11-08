CREATE TABLE "linked_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"profile_url" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"live" jsonb,
	"synced_at" timestamp with time zone,
	"game_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_watches" (
	"provider" text NOT NULL,
	"channel_id" text NOT NULL,
	"subscription_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"renew_at" timestamp with time zone,
	"live" jsonb,
	"seen" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stream_watches_provider_channel_id_pk" PRIMARY KEY("provider","channel_id")
);
--> statement-breakpoint
ALTER TABLE "user_games" ADD COLUMN "steam_app_id" integer;--> statement-breakpoint
ALTER TABLE "user_games" ADD COLUMN "steam_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "muted_live_alerts" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linked_accounts_user_provider_idx" ON "linked_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_accounts_external_idx" ON "linked_accounts" USING btree ("provider","external_id");