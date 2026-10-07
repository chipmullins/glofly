CREATE TYPE "public"."user_status" AS ENUM('online', 'away', 'dnd', 'invisible');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_preference" "user_status" DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_text" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;