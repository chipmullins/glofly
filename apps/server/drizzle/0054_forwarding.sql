ALTER TABLE "constellations" ADD COLUMN "forwarding_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "forwarded" jsonb;