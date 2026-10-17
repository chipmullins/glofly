CREATE TYPE "public"."constellation_role_kind" AS ENUM('admin', 'moderator', 'member', 'custom');--> statement-breakpoint
CREATE TYPE "public"."constellation_visibility" AS ENUM('invite', 'public', 'approval');--> statement-breakpoint
CREATE TYPE "public"."nebula_kind" AS ENUM('text', 'voice');--> statement-breakpoint
ALTER TYPE "public"."conversation_kind" ADD VALUE 'nebula';--> statement-breakpoint
CREATE TABLE "constellation_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellation_bans" (
	"constellation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constellation_bans_constellation_id_user_id_pk" PRIMARY KEY("constellation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "constellation_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellation_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "constellation_join_requests" (
	"constellation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constellation_join_requests_constellation_id_user_id_pk" PRIMARY KEY("constellation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "constellation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constellation_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "constellation_member_roles" (
	"constellation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "constellation_member_roles_constellation_id_user_id_role_id_pk" PRIMARY KEY("constellation_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "constellation_members" (
	"constellation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"timed_out_until" timestamp with time zone,
	"notify" text DEFAULT 'all' NOT NULL,
	"position" integer,
	CONSTRAINT "constellation_members_constellation_id_user_id_pk" PRIMARY KEY("constellation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "constellation_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"kind" "constellation_role_kind" DEFAULT 'custom' NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"position" integer NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'ember' NOT NULL,
	"icon_version" text,
	"owner_id" uuid NOT NULL,
	"visibility" "constellation_visibility" DEFAULT 'invite' NOT NULL,
	"type" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"taken_down_at" timestamp with time zone,
	"takedown_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nebulas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"category_id" uuid,
	"kind" "nebula_kind" NOT NULL,
	"name" text NOT NULL,
	"topic" text,
	"position" integer NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nebulas_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
CREATE TABLE "user_games" (
	"user_id" uuid NOT NULL,
	"game_key" text NOT NULL,
	"name" text NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"first_played_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_played_at" timestamp with time zone DEFAULT now() NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_games_user_id_game_key_pk" PRIMARY KEY("user_id","game_key")
);
--> statement-breakpoint
ALTER TABLE "conversation_members" ADD COLUMN "notify_level" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "my_games_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_audit_log" ADD CONSTRAINT "constellation_audit_log_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_audit_log" ADD CONSTRAINT "constellation_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_audit_log" ADD CONSTRAINT "constellation_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_bans" ADD CONSTRAINT "constellation_bans_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_bans" ADD CONSTRAINT "constellation_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_bans" ADD CONSTRAINT "constellation_bans_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_categories" ADD CONSTRAINT "constellation_categories_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_invites" ADD CONSTRAINT "constellation_invites_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_invites" ADD CONSTRAINT "constellation_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_invites" ADD CONSTRAINT "constellation_invites_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_join_requests" ADD CONSTRAINT "constellation_join_requests_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_join_requests" ADD CONSTRAINT "constellation_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_links" ADD CONSTRAINT "constellation_links_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_links" ADD CONSTRAINT "constellation_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_member_roles" ADD CONSTRAINT "constellation_member_roles_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_member_roles" ADD CONSTRAINT "constellation_member_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_member_roles" ADD CONSTRAINT "constellation_member_roles_role_id_constellation_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."constellation_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD CONSTRAINT "constellation_members_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_members" ADD CONSTRAINT "constellation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_roles" ADD CONSTRAINT "constellation_roles_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellations" ADD CONSTRAINT "constellations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebulas" ADD CONSTRAINT "nebulas_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebulas" ADD CONSTRAINT "nebulas_category_id_constellation_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."constellation_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebulas" ADD CONSTRAINT "nebulas_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_games" ADD CONSTRAINT "user_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_audit_constellation_idx" ON "constellation_audit_log" USING btree ("constellation_id","created_at");--> statement-breakpoint
CREATE INDEX "constellation_categories_constellation_idx" ON "constellation_categories" USING btree ("constellation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "constellation_invites_pair_idx" ON "constellation_invites" USING btree ("constellation_id","invitee_id");--> statement-breakpoint
CREATE INDEX "constellation_invites_invitee_idx" ON "constellation_invites" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "constellation_links_constellation_idx" ON "constellation_links" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "constellation_member_roles_role_idx" ON "constellation_member_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "constellation_members_user_idx" ON "constellation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "constellation_roles_constellation_idx" ON "constellation_roles" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "constellations_owner_idx" ON "constellations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "constellations_directory_idx" ON "constellations" USING btree ("visibility","last_activity_at") WHERE "constellations"."visibility" <> 'invite' and "constellations"."taken_down_at" is null;--> statement-breakpoint
CREATE INDEX "constellations_name_trgm_idx" ON "constellations" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "constellations_tags_idx" ON "constellations" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "nebulas_constellation_idx" ON "nebulas" USING btree ("constellation_id");