CREATE TYPE "public"."conversation_kind" AS ENUM('dm', 'group');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" "conversation_kind" DEFAULT 'dm' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "event" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;