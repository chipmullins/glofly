ALTER TABLE "users" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "header_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "header_focus" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_board" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_privacy" jsonb;