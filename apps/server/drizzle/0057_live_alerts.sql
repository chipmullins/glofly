CREATE TABLE "constellation_live_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"site" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_login" text NOT NULL,
	"channel_name" text NOT NULL,
	"nebula_id" uuid NOT NULL,
	"ping" text,
	"message" text NOT NULL,
	"watch_nebula_id" uuid,
	"created_by" uuid,
	"last_alert_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "live_card" jsonb;--> statement-breakpoint
ALTER TABLE "constellation_live_alerts" ADD CONSTRAINT "constellation_live_alerts_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_live_alerts" ADD CONSTRAINT "constellation_live_alerts_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_live_alerts" ADD CONSTRAINT "constellation_live_alerts_watch_nebula_id_nebulas_id_fk" FOREIGN KEY ("watch_nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_live_alerts" ADD CONSTRAINT "constellation_live_alerts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_alerts_channel_idx" ON "constellation_live_alerts" USING btree ("constellation_id","site","channel_id");--> statement-breakpoint
CREATE INDEX "live_alerts_watch_idx" ON "constellation_live_alerts" USING btree ("site","channel_id");