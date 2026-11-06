CREATE TABLE "constellation_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"bot_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"post_nebula_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"read_nebula_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"allowed_ips" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reset_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text
);
--> statement-breakpoint
CREATE TABLE "integration_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"key_id" uuid,
	"key_name" text,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"details" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_api_keys" ADD CONSTRAINT "constellation_api_keys_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_api_keys" ADD CONSTRAINT "constellation_api_keys_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_api_keys" ADD CONSTRAINT "constellation_api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_key_id_constellation_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."constellation_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_activity" ADD CONSTRAINT "integration_activity_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_api_keys_hash_idx" ON "constellation_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "constellation_api_keys_constellation_idx" ON "constellation_api_keys" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "integration_activity_constellation_idx" ON "integration_activity" USING btree ("constellation_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_activity_created_idx" ON "integration_activity" USING btree ("created_at");