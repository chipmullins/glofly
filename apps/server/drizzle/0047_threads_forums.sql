ALTER TYPE "public"."nebula_kind" ADD VALUE 'forum';--> statement-breakpoint
CREATE TABLE "nebula_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"constellation_id" uuid NOT NULL,
	"nebula_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"parent_message_id" uuid,
	"title" text NOT NULL,
	"tag_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"author_id" uuid,
	"first_message_id" uuid,
	"answer_message_id" uuid,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"pinned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "thread_follows" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"following" boolean DEFAULT true NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_follows_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "also_in_nebula" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "threads_staff_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "thread_close_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "forum_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "forum_guidelines" text;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "forum_require_tag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nebulas" ADD COLUMN "forum_sort" text DEFAULT 'activity' NOT NULL;--> statement-breakpoint
ALTER TABLE "nebula_threads" ADD CONSTRAINT "nebula_threads_constellation_id_constellations_id_fk" FOREIGN KEY ("constellation_id") REFERENCES "public"."constellations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebula_threads" ADD CONSTRAINT "nebula_threads_nebula_id_nebulas_id_fk" FOREIGN KEY ("nebula_id") REFERENCES "public"."nebulas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebula_threads" ADD CONSTRAINT "nebula_threads_parent_message_id_messages_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nebula_threads" ADD CONSTRAINT "nebula_threads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_thread_id_nebula_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."nebula_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_follows" ADD CONSTRAINT "thread_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nebula_threads_nebula_idx" ON "nebula_threads" USING btree ("nebula_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nebula_threads_parent_idx" ON "nebula_threads" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "thread_follows_user_idx" ON "thread_follows" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_nebula_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."nebula_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id","created_at") WHERE "messages"."thread_id" is not null;