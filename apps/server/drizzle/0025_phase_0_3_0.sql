CREATE TABLE "friend_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friend_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "online_alerts" (
	"owner_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_alerts_owner_id_target_id_pk" PRIMARY KEY("owner_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "online_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_alerts" ADD CONSTRAINT "online_alerts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_alerts" ADD CONSTRAINT "online_alerts_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_invites_inviter_idx" ON "friend_invites" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "friend_invites_email_idx" ON "friend_invites" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "online_alerts_target_idx" ON "online_alerts" USING btree ("target_id");