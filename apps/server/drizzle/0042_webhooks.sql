CREATE TABLE "constellation_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"nebula_id" uuid,
	"bot_user_id" uuid,
	"token_hash" text,
	"url" text,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"signing_secret" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_status" integer,
	"failures" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "constellation_webhooks" ADD CONSTRAINT "constellation_webhooks_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_webhooks" ADD CONSTRAINT "constellation_webhooks_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_webhooks" ADD CONSTRAINT "constellation_webhooks_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_webhooks" ADD CONSTRAINT "constellation_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_webhooks_constellation_idx" ON "constellation_webhooks" USING btree ("constellation_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_webhooks_token_idx" ON "constellation_webhooks" USING btree ("token_hash");