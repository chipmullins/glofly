CREATE TABLE "nebula_pins" (
	"user_id" uuid NOT NULL,
	"nebula_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nebula_pins_user_id_nebula_id_pk" PRIMARY KEY("user_id","nebula_id")
);
--> statement-breakpoint
ALTER TABLE "nebula_pins" ADD CONSTRAINT "nebula_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebula_pins" ADD CONSTRAINT "nebula_pins_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;