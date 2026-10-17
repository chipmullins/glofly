CREATE TABLE "glows" (
	"user_low" uuid NOT NULL,
	"user_high" uuid NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"best" integer DEFAULT 0 NOT NULL,
	"last_day" date,
	"low_wrote_on" date,
	"high_wrote_on" date,
	CONSTRAINT "glows_user_low_user_high_pk" PRIMARY KEY("user_low","user_high")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_message_id_user_id_option_pk" PRIMARY KEY("message_id","user_id","option")
);
--> statement-breakpoint
CREATE TABLE "stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "video" jsonb;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "sticker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "link_preview" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "poll" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "game" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "lantern" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "lantern_fade_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "share_birthday" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hang_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "glows" ADD CONSTRAINT "glows_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glows" ADD CONSTRAINT "glows_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stickers" ADD CONSTRAINT "stickers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stickers_owner_idx" ON "stickers" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_lantern_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE "messages"."lantern" and "messages"."deleted_at" is null;