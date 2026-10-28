CREATE TABLE "active_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"platform" text NOT NULL,
	CONSTRAINT "active_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "active_days" ADD CONSTRAINT "active_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "active_days_day_idx" ON "active_days" USING btree ("day");--> statement-breakpoint
-- Hand-added: a head start for Control → Insights from the messages already sent (each sender, each
-- day they sent something, in Glofly's default time zone). Which app isn't known for those days.
INSERT INTO "active_days" ("user_id", "day", "platform")
SELECT DISTINCT m."sender_id", (m."created_at" AT TIME ZONE 'America/Chicago')::date, 'unknown'
FROM "messages" m JOIN "users" u ON u."id" = m."sender_id"
WHERE m."sender_id" IS NOT NULL
ON CONFLICT DO NOTHING;
