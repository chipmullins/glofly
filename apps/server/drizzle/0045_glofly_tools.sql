CREATE TABLE "constellation_giveaways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"nebula_id" uuid NOT NULL,
	"message_id" uuid,
	"prize" text NOT NULL,
	"winners" integer NOT NULL,
	"role_id" uuid,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"winner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "constellation_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"nebula_id" uuid,
	"opener_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "constellation_tools" (
	"constellation_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "constellation_tools_constellation_id_tool_pk" PRIMARY KEY("constellation_id","tool")
);
--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"giveaway_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giveaway_entries_giveaway_id_user_id_pk" PRIMARY KEY("giveaway_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "constellations" ADD COLUMN "tool_bot_id" uuid;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "constellation_giveaways" ADD CONSTRAINT "constellation_giveaways_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_giveaways" ADD CONSTRAINT "constellation_giveaways_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_giveaways" ADD CONSTRAINT "constellation_giveaways_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_tickets" ADD CONSTRAINT "constellation_tickets_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_tickets" ADD CONSTRAINT "constellation_tickets_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_tickets" ADD CONSTRAINT "constellation_tickets_opener_id_users_id_fk" FOREIGN KEY ("opener_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constellation_tools" ADD CONSTRAINT "constellation_tools_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveaway_id_constellation_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."constellation_giveaways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constellation_giveaways_open_idx" ON "constellation_giveaways" USING btree ("ends_at") WHERE ended_at is null;--> statement-breakpoint
CREATE INDEX "constellation_tickets_constellation_idx" ON "constellation_tickets" USING btree ("constellation_id");