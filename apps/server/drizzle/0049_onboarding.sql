ALTER TABLE "constellation_members" ADD COLUMN "onboarding_answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD COLUMN "shown_nebulas" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "onboarding" jsonb;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;