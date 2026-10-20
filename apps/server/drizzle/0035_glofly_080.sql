CREATE TABLE "friend_link_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"signed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "constellation_categories" ADD COLUMN "visibility" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_categories" ADD COLUMN "role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "visibility" text DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_text_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_link_uses" ADD CONSTRAINT "friend_link_uses_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_link_uses" ADD CONSTRAINT "friend_link_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_link_uses_inviter_idx" ON "friend_link_uses" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "friend_link_uses_code_idx" ON "friend_link_uses" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_search_recent_idx" ON "messages" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "messages"."deleted_at" is null and "messages"."event" is null;--> statement-breakpoint
CREATE INDEX "users_status_text_expires_idx" ON "users" USING btree ("status_text_expires_at") WHERE "users"."status_text_expires_at" is not null;