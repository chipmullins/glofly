-- 0.8.0 roles-templates track: role-only nebulas and categories (item 9).
-- Who can see a role-only nebula is kept in its conversation's members (constellations/access.ts);
-- nothing is role-only yet, so no backfill is needed.
ALTER TABLE "constellation_categories" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'everyone' NOT NULL;
ALTER TABLE "constellation_categories" ADD COLUMN IF NOT EXISTS "role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
ALTER TABLE "nebulas" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'everyone' NOT NULL;
ALTER TABLE "nebulas" ADD COLUMN IF NOT EXISTS "role_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
