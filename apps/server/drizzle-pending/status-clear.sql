-- 0.8.0 track status-clear: statuses that clear themselves.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status_text_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_status_text_expires_idx" ON "users" USING btree ("status_text_expires_at") WHERE "users"."status_text_expires_at" is not null;
