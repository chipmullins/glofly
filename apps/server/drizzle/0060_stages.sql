ALTER TYPE "public"."nebula_kind" ADD VALUE 'stage';--> statement-breakpoint
ALTER TYPE "public"."nebula_kind" ADD VALUE 'announcement';--> statement-breakpoint
CREATE TABLE "announcement_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_nebula_id" uuid NOT NULL,
	"target_nebula_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crosspost_copies" (
	"copy_message_id" uuid PRIMARY KEY NOT NULL,
	"source_message_id" uuid NOT NULL,
	"follow_id" uuid
);
--> statement-breakpoint
CREATE TABLE "stage_people" (
	"stage_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"speaker" boolean DEFAULT false NOT NULL,
	"invited" boolean DEFAULT false NOT NULL,
	"hand_at" timestamp with time zone,
	"up_at" timestamp with time zone,
	CONSTRAINT "stage_people_stage_id_user_id_pk" PRIMARY KEY("stage_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nebula_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"hands_on" boolean DEFAULT true NOT NULL,
	"listener_chat" boolean DEFAULT false NOT NULL,
	"speaker_limit" integer DEFAULT 25 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "crosspost" jsonb;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "stage_speaker_limit" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement_follows" ADD CONSTRAINT "announcement_follows_source_nebula_id_nebulas_id_fk" FOREIGN KEY ("source_nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_follows" ADD CONSTRAINT "announcement_follows_target_nebula_id_nebulas_id_fk" FOREIGN KEY ("target_nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_follows" ADD CONSTRAINT "announcement_follows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspost_copies" ADD CONSTRAINT "crosspost_copies_copy_message_id_messages_id_fk" FOREIGN KEY ("copy_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspost_copies" ADD CONSTRAINT "crosspost_copies_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crosspost_copies" ADD CONSTRAINT "crosspost_copies_follow_id_announcement_follows_id_fk" FOREIGN KEY ("follow_id") REFERENCES "public"."announcement_follows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_people" ADD CONSTRAINT "stage_people_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_people" ADD CONSTRAINT "stage_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_follows_pair_idx" ON "announcement_follows" USING btree ("source_nebula_id","target_nebula_id");--> statement-breakpoint
CREATE INDEX "announcement_follows_target_idx" ON "announcement_follows" USING btree ("target_nebula_id");--> statement-breakpoint
CREATE INDEX "crosspost_copies_source_idx" ON "crosspost_copies" USING btree ("source_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stages_live_idx" ON "stages" USING btree ("nebula_id") WHERE "stages"."ended_at" is null;