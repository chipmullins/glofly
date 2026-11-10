import { randomInt } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { DiceRng, RollResult, RollVisibility } from "@glofly/shared";
import { CAMPFIRE_LIMITS } from "@glofly/shared";
import { db } from "../db";
import { campfireRolls } from "../db/schema";
import { rateLimit, takeSlot } from "../rateLimit";
import { tableFor, type CampaignRow, type Table } from "./perms";
import { broadcast } from "./state";
import { rollOut, rollVisible } from "./view";

// Small pieces every Campfire route uses: who's asking, answering errors, rate limits, the
// table check, and recording rolls.

export type Me = { id: string; username: string; displayName: string };
export const me = (res: Response): Me => res.locals.user as Me;

export const idParam = z.uuid();
export const bad = (res: Response, message: string, status = 400, error?: string) =>
  res.status(status).json({ error: error ?? (status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "limit" : "invalid"), message });
export const notFound = (res: Response, what = "That isn't available.") => bad(res, what, 404);
export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "That didn't work. Try again.";

export const limiter = (name: string, limit: number, windowMs: number, message: string) =>
  rateLimit(name, {
    windowMs,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message },
  });

/** The server's dice: crypto randomness, a number in [0, 1). */
const RNG_RANGE = 2 ** 48 - 1;
export const serverRng: DiceRng = () => randomInt(0, RNG_RANGE) / RNG_RANGE;

const memorySlots = new Map<string, number[]>();
/** A sliding-window limit in Redis (in this server's memory while Redis is away). */
export async function slot(key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    return await takeSlot(windowMs, [{ key: `rl:${key}`, limit }]);
  } catch {
    const now = Date.now();
    const list = (memorySlots.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= limit) return false;
    list.push(now);
    memorySlots.set(key, list);
    if (memorySlots.size > 50_000) memorySlots.clear();
    return true;
  }
}

/** Rolls: 60 a minute per person (the table and /roll in chats together). */
export const rollSlot = (userId: string) => slot(`campfire:rolls:${userId}`, CAMPFIRE_LIMITS.rollsPerMinute, 60_000);
export const TOO_MANY_ROLLS = "That's a lot of rolling. Wait a moment and try again.";

/**
 * The table for this request's campaign, or null after answering (404 for anyone who can't be at
 * it, 403 for players doing GM things or anyone read-only changing things).
 */
export async function tableOr(res: Response, campaignId: unknown, opts: { write?: boolean; gm?: boolean } = {}): Promise<Table | null> {
  const id = idParam.safeParse(campaignId);
  const t = id.success ? await tableFor(id.data, me(res).id) : null;
  if (!t) {
    notFound(res, "That campaign isn't available.");
    return null;
  }
  if ((opts.write || opts.gm) && t.readOnly) {
    bad(res, t.readOnly, 403);
    return null;
  }
  if (opts.gm && !t.gm) {
    bad(res, "Only the game master can do that.", 403);
    return null;
  }
  return t;
}

export const uuidList = (max: number) => z.array(z.uuid()).max(max).transform((l) => [...new Set(l)]);
export const cleanText = (max: number, label: string) =>
  z
    .string()
    .transform((s) => s.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `${label} can't be empty.`).max(max, `${label} can be up to ${max} characters.`));

/** Records a roll in the campaign's history, keeps the newest 2,000, and tells the table. */
export async function recordRoll(
  campaign: CampaignRow,
  input: { userId: string | null; characterId: string | null; result: RollResult; visibility: RollVisibility; whisperTo?: string[] },
) {
  const [row] = await db
    .insert(campfireRolls)
    .values({
      campaignId: campaign.id,
      userId: input.userId,
      characterId: input.characterId,
      label: input.result.label,
      expression: input.result.expression,
      result: input.result,
      total: input.result.total,
      visibility: input.visibility,
      whisperTo: input.visibility === "whisper" ? (input.whisperTo ?? []) : [],
    })
    .returning();
  await db.execute(sql`
    delete from campfire_rolls where campaign_id = ${campaign.id} and id in (
      select id from campfire_rolls where campaign_id = ${campaign.id} order by created_at desc offset ${CAMPFIRE_LIMITS.rollsKept})`);
  const roll = rollOut(row);
  await broadcast(campaign, "campfire:roll", (v) => (rollVisible(row, v) ? { roll } : null));
  return roll;
}

