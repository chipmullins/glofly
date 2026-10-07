CREATE TYPE "public"."friend_requests_from" AS ENUM('everyone', 'nobody');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "friend_requests" "friend_requests_from" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "delete_after" timestamp with time zone;