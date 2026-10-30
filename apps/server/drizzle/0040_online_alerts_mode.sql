ALTER TABLE "users" ADD COLUMN "online_alerts_mode" text DEFAULT 'selected' NOT NULL;--> statement-breakpoint
-- Hand-added: anyone who had "Friends coming online" turned off keeps it off.
UPDATE "users" SET "online_alerts_mode" = 'none' WHERE "online_alerts" = false;
