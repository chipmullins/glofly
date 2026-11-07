ALTER TABLE "oauth_apps" ADD COLUMN "privacy_url" text;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD COLUMN "dev_terms_version" text;--> statement-breakpoint
ALTER TABLE "oauth_apps" ADD COLUMN "dev_terms_accepted_at" timestamp with time zone;