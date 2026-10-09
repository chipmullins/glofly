CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "messages_body_trgm_idx" ON "messages" USING gin ("body" gin_trgm_ops);