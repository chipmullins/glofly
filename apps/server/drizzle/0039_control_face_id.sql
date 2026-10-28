ALTER TABLE "admin_devices" ADD COLUMN "remember_hash" text;--> statement-breakpoint
ALTER TABLE "admin_devices" ADD COLUMN "remember_until" timestamp with time zone;