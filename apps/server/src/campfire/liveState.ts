import { NO_LIVE, type TableLive } from "@glofly/shared";

// Round B: a campaign's live table state (pause, spotlight), read the same way everywhere.
// A leaf module (no other Campfire imports) so view.ts can use it without an import cycle.

export function liveOf(c: { live: unknown }): TableLive {
  const raw = c.live as Partial<TableLive> | null;
  if (!raw || typeof raw !== "object") return { ...NO_LIVE };
  const p = raw.paused;
  return {
    paused: p && typeof p === "object" && typeof p.by === "string" ? { by: p.by, message: typeof p.message === "string" ? p.message : "", at: typeof p.at === "string" ? p.at : new Date().toISOString() } : null,
    spotlight: typeof raw.spotlight === "string" ? raw.spotlight : null,
  };
}

