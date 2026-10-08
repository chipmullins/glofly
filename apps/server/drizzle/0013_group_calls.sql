ALTER TABLE "call_participants" ALTER COLUMN "joined_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "call_participants" ALTER COLUMN "joined_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "call_participants" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_participants" ADD COLUMN "declined_at" timestamp with time zone;