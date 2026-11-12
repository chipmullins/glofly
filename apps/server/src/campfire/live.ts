import type { Request } from "express";
import { CAMPFIRE_FEATURE, CAMPFIRE_HIDE_FEATURE, type CampaignRole } from "@glofly/shared";
import { emitToCampfire } from "../realtime";

// Campfire's live side: who is at each table, which call a table is lit in, and the per-person
// event sequence. Kept in this server's memory (like Watch Together): a restart forgets who's
// at the table (apps say so again within 30 s) and which call it was lit in (the GM lights it
// again). Events only go to devices whose app sent the `campfire` feature.
//
// `seq` is per campaign AND per person: everyone gets different events (a player never hears
// about hidden things), so each person's apps count only their own. A gap (or a restart, which
// starts again from 1) tells the app to load the table again.

/** Apps that know Campfire send it in X-Glofly-Features (requests) as well as on the live connection. */
export const knowsCampfire = (req: Request): boolean =>
  new RegExp(`(^|[\\s,])${CAMPFIRE_FEATURE}($|[\\s,])`).test(String(req.headers["x-glofly-features"] ?? ""));

/** 0.11.2: apps that know hidden map pieces and layers (older ones save maps without them). */
export const knowsHiding = (req: Request): boolean =>
  new RegExp(`(^|[\\s,])${CAMPFIRE_HIDE_FEATURE}($|[\\s,])`).test(String(req.headers["x-glofly-features"] ?? ""));

const seqs = new Map<string, number>();
const seqKey = (campaignId: string, userId: string) => `${campaignId}:${userId}`;

/** The last seq this person's apps were sent for a campaign (what GET …/campaigns/:id reports). */
export const currentSeq = (campaignId: string, userId: string): number => seqs.get(seqKey(campaignId, userId)) ?? 0;

/** Sends one person a Campfire event (numbered in their own sequence). */
export function sendCampfire(userId: string, campaignId: string, event: string, payload: Record<string, unknown>): void {
  const key = seqKey(campaignId, userId);
  const seq = (seqs.get(key) ?? 0) + 1;
  seqs.set(key, seq);
  emitToCampfire(userId, event, { ...payload, campaignId, seq });
}

// ───────────── Who's at the table ─────────────

/** How long a presence ping counts (apps send one every 30 s). */
export const PRESENCE_MS = 75_000;
type Seat = { at: number; role: CampaignRole };
const tables = new Map<string, Map<string, Seat>>();

/** Notes that someone is at the table. True when they just arrived. */
export function notePresence(campaignId: string, userId: string, role: CampaignRole): boolean {
  let seats = tables.get(campaignId);
  if (!seats) tables.set(campaignId, (seats = new Map()));
  // A seat whose last ping is too old (not swept yet) counts as just arriving too, so the cached
  // audience is worked out again and they hear the very next event.
  const seat = seats.get(userId);
  const fresh = !seat || Date.now() - seat.at >= PRESENCE_MS;
  seats.set(userId, { at: Date.now(), role });
  return fresh;
}

export function leaveTable(campaignId: string, userId: string): boolean {
  return tables.get(campaignId)?.delete(userId) ?? false;
}

/** Who's at the table now. */
export function presentAt(campaignId: string): string[] {
  const seats = tables.get(campaignId);
  if (!seats) return [];
  const now = Date.now();
  return [...seats].filter(([, s]) => now - s.at < PRESENCE_MS).map(([id]) => id);
}

/** Drops people whose app stopped saying they're there. Returns the campaigns that changed. */
export function sweepPresence(): string[] {
  const now = Date.now();
  const changed: string[] = [];
  for (const [campaignId, seats] of tables) {
    let gone = false;
    for (const [userId, s] of seats) {
      if (now - s.at >= PRESENCE_MS) {
        seats.delete(userId);
        gone = true;
      }
    }
    if (gone) changed.push(campaignId);
    if (!seats.size) tables.delete(campaignId);
  }
  return changed;
}

/** Forgets a campaign (deleted). */
export function forgetCampaign(campaignId: string): void {
  tables.delete(campaignId);
  openIn.delete(campaignId);
  for (const key of seqs.keys()) if (key.startsWith(campaignId + ":")) seqs.delete(key);
}

// ───────────── Lit in a call ─────────────

const openIn = new Map<string, string>();
export const openCallOf = (campaignId: string): string | null => openIn.get(campaignId) ?? null;
export function setOpenCall(campaignId: string, callId: string | null): void {
  if (callId) openIn.set(campaignId, callId);
  else openIn.delete(campaignId);
}
