CREATE TABLE "game_link_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"key_id" uuid,
	"game" text NOT NULL,
	"identity" text NOT NULL,
	"extra_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"player_name" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"constellation_id" uuid NOT NULL,
	"key_id" uuid,
	"server_name" text NOT NULL,
	"game" text NOT NULL,
	"identity" text NOT NULL,
	"extra_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"player_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_link_codes" ADD CONSTRAINT "game_link_codes_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_link_codes" ADD CONSTRAINT "game_link_codes_key_id_constellation_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."constellation_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_links" ADD CONSTRAINT "game_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_links" ADD CONSTRAINT "game_links_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_links" ADD CONSTRAINT "game_links_key_id_constellation_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."constellation_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_link_codes_hash_idx" ON "game_link_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "game_link_codes_player_idx" ON "game_link_codes" USING btree ("constellation_id","game","identity");--> statement-breakpoint
CREATE INDEX "game_link_codes_expires_idx" ON "game_link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_links_player_idx" ON "game_links" USING btree ("constellation_id","game","identity");--> statement-breakpoint
CREATE UNIQUE INDEX "game_links_user_idx" ON "game_links" USING btree ("user_id","constellation_id","game");