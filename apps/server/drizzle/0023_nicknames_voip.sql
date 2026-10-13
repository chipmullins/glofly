CREATE TABLE "nicknames" (
	"owner_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nicknames_owner_id_target_id_pk" PRIMARY KEY("owner_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD COLUMN "voip_token" text;--> statement-breakpoint
ALTER TABLE "nicknames" ADD CONSTRAINT "nicknames_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nicknames" ADD CONSTRAINT "nicknames_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;