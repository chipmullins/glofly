import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// `constellations` branch only (take this out when 2.0 goes into `dev`): if the glofly folder has a
// `.env.constellations` file, its DATABASE_URL wins over the one in `.env`. That way this branch
// runs on its own test database and `dev` keeps its own, so neither one's migrations trip up the
// other's (see CLAUDE.md). Git ignores the file. Never used on the live server.
export function branchDatabaseUrl(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const file = join(__dirname, "../../../../.env.constellations");
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  const url = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
  return url || undefined;
}
