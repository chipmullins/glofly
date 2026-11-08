CREATE TABLE "game_art" (
	"game_key" text PRIMARY KEY NOT NULL,
	"igdb_id" integer,
	"name" text NOT NULL,
	"cover_id" text,
	"year" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
