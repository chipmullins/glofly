import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverSettings } from "../db/schema";

// "Pause Glofly" (Control → Server): the kill switch. While paused, nobody can use Glofly:
//   - every live connection is closed and new ones are refused (realtime.ts)
//   - every request answers 503 { error: "paused", message }, except Glofly Control (/admin),
//     /health and /status (which apps ask while showing "Glofly is paused")
//   - the pages opened from emails (/reset, /confirm, /welcome, /join) show the message instead
//   - no push notifications go out, and calls are ended when the pause starts
// Apps from 0.4.0 show a full-screen "Glofly is paused" and check back every 30 seconds. Older
// apps (0.3.x) just see a server error and keep retrying their connection, then carry on by
// themselves once Glofly is back.

export const DEFAULT_PAUSE_MESSAGE = "Glofly is paused for maintenance. Back soon.";
export const PAUSE_MESSAGE_MAX = 200;

export type PauseState = { paused: boolean; message: string; since: string | null };

const OFF: PauseState = { paused: false, message: DEFAULT_PAUSE_MESSAGE, since: null };

// Checked on every request, so it's kept in memory and re-read every few seconds (there is one
// server process; flipping the switch updates this copy at once).
let cached: { state: PauseState; at: number } | null = null;

function fromRow(value: unknown): PauseState {
  const v = value as { paused?: unknown; message?: unknown; since?: unknown } | undefined;
  return {
    paused: v?.paused === true,
    message: typeof v?.message === "string" && v.message.trim() ? v.message : DEFAULT_PAUSE_MESSAGE,
    since: typeof v?.since === "string" ? v.since : null,
  };
}

export async function getPause(): Promise<PauseState> {
  if (cached && Date.now() - cached.at < 5000) return cached.state;
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "pause"));
    const state = row ? fromRow(row.value) : OFF;
    cached = { state, at: Date.now() };
    return state;
  } catch {
    // The database is having a moment: keep whatever we knew (a pause stays a pause).
    return cached?.state ?? OFF;
  }
}

/** Is Glofly paused right now? (Cheap: from memory almost always.) */
export const isPaused = async (): Promise<boolean> => (await getPause()).paused;

export async function setPause(paused: boolean, message: string): Promise<PauseState> {
  const state: PauseState = { paused, message, since: paused ? new Date().toISOString() : null };
  await db
    .insert(serverSettings)
    .values({ key: "pause", value: state })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value: state, updatedAt: new Date() } });
  cached = { state, at: Date.now() };
  return state;
}

/** What apps are told while paused. */
export const pausedBody = (state: PauseState) => ({ error: "paused", message: state.message, since: state.since });

// Paths that keep working while paused.
const OPEN = /^\/(admin(\/|$)|health$|status$)/;
// The pages people open from emails; they show the pause message as a page.
const PAGES = /^\/(reset|confirm|welcome|join|i\/[^/]+)$/;

/**
 * In front of every route: refuses everything but Control while paused. `pausedPage` draws the
 * web pages' version (from web/pages.ts, so it looks like the rest of them).
 */
export function refuseWhilePaused(pausedPage: (res: Parameters<RequestHandler>[1], message: string) => void): RequestHandler {
  return async (req, res, next) => {
    if (OPEN.test(req.path)) return next();
    const state = await getPause();
    if (!state.paused) return next();
    res.set("Retry-After", "30");
    if (PAGES.test(req.path)) {
      pausedPage(res.status(503), state.message);
      return;
    }
    res.status(503).json(pausedBody(state));
  };
}
