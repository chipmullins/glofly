CREATE TABLE "campfire_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"constellation_id" uuid,
	"conversation_id" uuid,
	"home_conversation_id" uuid,
	"created_by" uuid,
	"active_scene_id" uuid,
	"settings" jsonb NOT NULL,
	"combat" jsonb,
	"music" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"portrait_file_id" uuid,
	"sheet" jsonb NOT NULL,
	"ddb_url" text,
	"srd_monster" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" integer,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_handouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_file_id" uuid,
	"shared" text DEFAULT 'gm' NOT NULL,
	"shared_with" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_members" (
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campfire_members_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campfire_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"attacker_token_id" uuid,
	"target_token_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"damage_type" text,
	"kind" text NOT NULL,
	"crit" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_rolls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid,
	"character_id" uuid,
	"label" text,
	"expression" text NOT NULL,
	"result" jsonb NOT NULL,
	"total" integer NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"whisper_to" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"width_px" integer DEFAULT 2100 NOT NULL,
	"height_px" integer DEFAULT 1400 NOT NULL,
	"grid" jsonb NOT NULL,
	"background_file_id" uuid,
	"theme" text DEFAULT 'stone' NOT NULL,
	"built" jsonb NOT NULL,
	"fog" jsonb NOT NULL,
	"music_track_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scene_id" uuid NOT NULL,
	"layer" text DEFAULT 'tokens' NOT NULL,
	"character_id" uuid,
	"name" text NOT NULL,
	"image_file_id" uuid,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"w" integer DEFAULT 1 NOT NULL,
	"h" integer DEFAULT 1 NOT NULL,
	"rotation" integer DEFAULT 0 NOT NULL,
	"bars" jsonb NOT NULL,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"aura" jsonb,
	"show_name" boolean DEFAULT true NOT NULL,
	"controlled_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"z" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campfire_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"duration_sec" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "roll" jsonb;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD CONSTRAINT "campfire_campaigns_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD CONSTRAINT "campfire_campaigns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD CONSTRAINT "campfire_campaigns_home_conversation_id_conversations_id_fk" FOREIGN KEY ("home_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_campaigns" ADD CONSTRAINT "campfire_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_characters" ADD CONSTRAINT "campfire_characters_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_characters" ADD CONSTRAINT "campfire_characters_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_characters" ADD CONSTRAINT "campfire_characters_portrait_file_id_campfire_files_id_fk" FOREIGN KEY ("portrait_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_files" ADD CONSTRAINT "campfire_files_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_files" ADD CONSTRAINT "campfire_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_handouts" ADD CONSTRAINT "campfire_handouts_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_handouts" ADD CONSTRAINT "campfire_handouts_image_file_id_campfire_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_handouts" ADD CONSTRAINT "campfire_handouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_members" ADD CONSTRAINT "campfire_members_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_members" ADD CONSTRAINT "campfire_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_pending" ADD CONSTRAINT "campfire_pending_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_pending" ADD CONSTRAINT "campfire_pending_attacker_token_id_campfire_tokens_id_fk" FOREIGN KEY ("attacker_token_id") REFERENCES "public"."campfire_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_pending" ADD CONSTRAINT "campfire_pending_target_token_id_campfire_tokens_id_fk" FOREIGN KEY ("target_token_id") REFERENCES "public"."campfire_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_pending" ADD CONSTRAINT "campfire_pending_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_rolls" ADD CONSTRAINT "campfire_rolls_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_rolls" ADD CONSTRAINT "campfire_rolls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_rolls" ADD CONSTRAINT "campfire_rolls_character_id_campfire_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."campfire_characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_scenes" ADD CONSTRAINT "campfire_scenes_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_scenes" ADD CONSTRAINT "campfire_scenes_background_file_id_campfire_files_id_fk" FOREIGN KEY ("background_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_scenes" ADD CONSTRAINT "campfire_scenes_music_track_id_campfire_tracks_id_fk" FOREIGN KEY ("music_track_id") REFERENCES "public"."campfire_tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD CONSTRAINT "campfire_tokens_scene_id_campfire_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."campfire_scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD CONSTRAINT "campfire_tokens_character_id_campfire_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."campfire_characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_tokens" ADD CONSTRAINT "campfire_tokens_image_file_id_campfire_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."campfire_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_tracks" ADD CONSTRAINT "campfire_tracks_campaign_id_campfire_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campfire_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campfire_tracks" ADD CONSTRAINT "campfire_tracks_file_id_campfire_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."campfire_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campfire_campaigns_constellation_idx" ON "campfire_campaigns" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "campfire_campaigns_conversation_idx" ON "campfire_campaigns" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "campfire_campaigns_home_idx" ON "campfire_campaigns" USING btree ("home_conversation_id");--> statement-breakpoint
CREATE INDEX "campfire_characters_campaign_idx" ON "campfire_characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_files_campaign_idx" ON "campfire_files" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_files_uploader_idx" ON "campfire_files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "campfire_handouts_campaign_idx" ON "campfire_handouts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_members_user_idx" ON "campfire_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campfire_pending_campaign_idx" ON "campfire_pending" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_rolls_campaign_idx" ON "campfire_rolls" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "campfire_scenes_campaign_idx" ON "campfire_scenes" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campfire_tokens_scene_idx" ON "campfire_tokens" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "campfire_tokens_character_idx" ON "campfire_tokens" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "campfire_tracks_campaign_idx" ON "campfire_tracks" USING btree ("campaign_id");--> statement-breakpoint
-- Hand-added backfill: Admins may run Campfire games (the Owner always can).
UPDATE "constellation_roles" SET "permissions" = array_append("permissions", 'runGames')
  WHERE "kind" = 'admin' AND NOT ('runGames' = ANY("permissions"));
