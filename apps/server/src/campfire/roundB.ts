import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  BUILTIN_SOUNDS,
  NO_LIVE,
  isBuiltinSound,
  moveBudget,
  normalizeBuilt,
  normalizeSheet,
  pathCost,
  speedFor,
  tickConditions,
  tokenCenter,
  type CombatEntry,
  type CombatState,
  type Point,
  type Sheet5e,
  type TableLive,
} from "@glofly/shared";
import { db } from "../db";
import { campfireCampaigns, campfireCharacters, campfireFiles, campfireMembers, campfireSounds, campfireTokens } from "../db/schema";
import { leaveTable, sendCampfire } from "./live";
import { forgetCachedTable } from "./tableCache";
import { liveOf } from "./liveState";
export { liveOf };
import { inHome, recordedGms, settingsOf, tableFor, type CampaignRow, type Table } from "./perms";
import { bad, cleanText, firstIssue, idParam, limiter, notFound, tableOr } from "./http";
import { broadcast, charactersInfo, emitCombat, emitToken, forgetAudience, membersOf, tokensWithScenes } from "./state";
import { builtForPlayers, controls, fogOf, shownName, tokenVisible, type SceneRow, type TokenRow } from "./view";

// Campfire Round B (Nov 2026): movement on your turn (speed, Dash, difficult terrain, undo), the
// game master's table controls (pause, spotlight, move everyone's view, remove someone), voice
// (whisper notices) and the sound board. Movement uses the shared `pathCost`, like every app.
//
//   POST   /campfire/campaigns/:id/pause                { on, message? }       (GM)
//   POST   /campfire/campaigns/:id/spotlight            { userId | null }      (GM)
//   POST   /campfire/campaigns/:id/view                 { sceneId, x, y }      (GM)
//   POST   /campfire/campaigns/:id/members/:userId/remove { removed }          (GM; players only)
//   POST   /campfire/campaigns/:id/whisper              { to, on }             (GM)
//   GET    /campfire/campaigns/:id/sounds · POST (GM) { fileId, name } · DELETE /campfire/sounds/:id (GM)
//   POST   /campfire/campaigns/:id/sound                { builtin } | { soundId }, volume?  (GM)
//   live:  campfire:live · campfire:view · campfire:sound · campfire:whisper · campfire:notice · campfire:removed

export const roundBRouter = Router();

const changeLimiter = limiter("campfire:table", 300, 60 * 1000, "That's a lot of changes. Wait a moment and try again.");
const soundLimiter = limiter("campfire:sound", 30, 60 * 1000, "That's a lot of sounds. Wait a moment.");

export const SOUND_MAX_SECONDS = 15;
export const SOUNDS_PER_CAMPAIGN = 40;

// ───────────── Live state (pause, spotlight) ─────────────

export const PAUSED = "The game master paused the table. It'll pick up again soon.";
/** Players can't move, roll at the table or act while the GM has paused it. */
export const pausedFor = (t: Table): boolean => !t.gm && !!liveOf(t.campaign).paused;

async function setLive(t: Table, live: TableLive): Promise<CampaignRow> {
  const [row] = await db.update(campfireCampaigns).set({ live, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
  await broadcast(row, "campfire:live", () => ({ live }));
  return row;
}

roundBRouter.post("/campaigns/:id/pause", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z
    .object({ on: z.boolean(), message: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), cleanText(120, "The message").optional()) })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const live = liveOf(t.campaign);
  live.paused = parsed.data.on ? { by: t.userId, message: parsed.data.message ?? "", at: new Date().toISOString() } : null;
  await setLive(t, live);
  res.json({ live });
});

roundBRouter.post("/campaigns/:id/spotlight", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ userId: z.uuid().nullable() }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  if (parsed.data.userId && !(await atTable(t.campaign, parsed.data.userId))) return bad(res, "They aren't at this table.");
  const live = { ...liveOf(t.campaign), spotlight: parsed.data.userId };
  await setLive(t, live);
  res.json({ live });
});

roundBRouter.post("/campaigns/:id/view", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const coord = z.number().finite().min(-100_000).max(100_000).transform(Math.round);
  const parsed = z.object({ sceneId: z.uuid(), x: coord, y: coord }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  // Players only ever see the active scene: moving the view to another one would tell them nothing.
  if (parsed.data.sceneId !== t.campaign.activeSceneId) return bad(res, "Show that scene to the players first.", 409);
  await broadcast(t.campaign, "campfire:view", () => ({ ...parsed.data, by: t.userId }));
  res.json({ ok: true });
});

roundBRouter.post("/campaigns/:id/members/:userId/remove", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const who = idParam.safeParse(req.params.userId);
  const parsed = z.object({ removed: z.boolean() }).strict().safeParse(req.body);
  if (!who.success || !parsed.success) return bad(res, "Who?");
  if (who.data === t.userId) return bad(res, "You can't remove yourself.");
  if ((await recordedGms(t.campaign)).includes(who.data)) return bad(res, "Game masters can't be removed. Make them a player first.", 403);
  const [m] = await db.select().from(campfireMembers).where(and(eq(campfireMembers.campaignId, t.campaign.id), eq(campfireMembers.userId, who.data)));
  if (!m) return notFound(res, "They haven't been at this table.");
  if (m.role === "gm") return bad(res, "Game masters can't be removed. Make them a player first.", 403);
  // Constellation members with "Run Campfire games" are game masters wherever they sit.
  const asGm = await tableFor(t.campaign, who.data);
  if (asGm?.gm) return bad(res, "They run games in this constellation, so they can't be removed here.", 403);
  if (parsed.data.removed) sendCampfire(who.data, t.campaign.id, "campfire:removed", { userId: who.data });
  await db
    .update(campfireMembers)
    .set({ removedAt: parsed.data.removed ? new Date() : null })
    .where(and(eq(campfireMembers.campaignId, t.campaign.id), eq(campfireMembers.userId, who.data)));
  forgetAudience(t.campaign.id);
  forgetCachedTable(t.campaign.id, who.data);
  if (parsed.data.removed) leaveTable(t.campaign.id, who.data);
  const members = await membersOf(t.campaign);
  await broadcast(t.campaign, "campfire:members", () => ({ members }));
  res.json({ members });
});

roundBRouter.post("/campaigns/:id/whisper", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ to: z.uuid(), on: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  if (!(await atTable(t.campaign, parsed.data.to))) return bad(res, "They aren't at this table.");
  const payload = { from: t.userId, to: parsed.data.to, on: parsed.data.on };
  // Only the two of them hear about it (the call does the audio itself).
  await broadcast(t.campaign, "campfire:whisper", () => payload, [parsed.data.to, t.userId]);
  res.json({ ok: true });
});

/** Someone who may be at this table now (in its home, not removed). */
async function atTable(campaign: CampaignRow, userId: string): Promise<boolean> {
  return !!(await tableFor(campaign, userId));
}

// ───────────── Sound board ─────────────

const soundOut = (r: typeof campfireSounds.$inferSelect) => ({ id: r.id, name: r.name, fileId: r.fileId });

roundBRouter.get("/campaigns/:id/sounds", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  const rows = await db.select().from(campfireSounds).where(eq(campfireSounds.campaignId, t.campaign.id)).orderBy(asc(campfireSounds.createdAt));
  res.json({ builtin: BUILTIN_SOUNDS, sounds: t.gm ? rows.map(soundOut) : [] });
});

roundBRouter.post("/campaigns/:id/sounds", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ fileId: z.uuid(), name: cleanText(40, "The name") }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const [file] = await db.select().from(campfireFiles).where(and(eq(campfireFiles.id, parsed.data.fileId), eq(campfireFiles.campaignId, t.campaign.id), eq(campfireFiles.kind, "audio")));
  if (!file) return bad(res, "Upload that sound to this campaign first.");
  if (!file.durationSec || file.durationSec > SOUND_MAX_SECONDS) return bad(res, `Sounds can be up to ${SOUND_MAX_SECONDS} seconds long. Add longer ones as music.`);
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: campfireCampaigns.id }).from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(campfireSounds).where(eq(campfireSounds.campaignId, t.campaign.id));
    if (n >= SOUNDS_PER_CAMPAIGN) return null;
    const [r] = await tx.insert(campfireSounds).values({ campaignId: t.campaign.id, fileId: file.id, name: parsed.data.name || "Sound" }).returning();
    return r;
  });
  if (!row) return bad(res, `A campaign can have up to ${SOUNDS_PER_CAMPAIGN} sounds.`, 409);
  res.status(201).json(soundOut(row));
});

roundBRouter.delete("/sounds/:id", changeLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [row] = id.success ? await db.select().from(campfireSounds).where(eq(campfireSounds.id, id.data)) : [];
  if (!row) return notFound(res);
  const t = await tableOr(res, row.campaignId, { gm: true });
  if (!t) return;
  await db.delete(campfireSounds).where(eq(campfireSounds.id, row.id));
  res.json({ ok: true });
});

roundBRouter.post("/campaigns/:id/sound", soundLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z
    .object({ builtin: z.string().refine(isBuiltinSound, "That sound isn't one of Campfire's.").optional(), soundId: z.uuid().optional(), volume: z.number().min(0).max(1).optional() })
    .strict()
    .refine((d) => !!d.builtin !== !!d.soundId, "Pick one sound.")
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  let fileId: string | null = null;
  if (parsed.data.soundId) {
    const [row] = await db.select().from(campfireSounds).where(and(eq(campfireSounds.id, parsed.data.soundId), eq(campfireSounds.campaignId, t.campaign.id)));
    if (!row) return notFound(res, "That sound isn't in this campaign.");
    fileId = row.fileId;
  }
  await broadcast(t.campaign, "campfire:sound", () => ({ builtin: parsed.data.builtin ?? null, fileId, volume: parsed.data.volume ?? 0.7 }));
  res.json({ ok: true });
});

/** Players may download a sound board clip of a campaign they're at (it's played for everyone). */
export async function isSoundFile(campaignId: string, fileId: string): Promise<boolean> {
  return (await db.select({ id: campfireSounds.id }).from(campfireSounds).where(and(eq(campfireSounds.campaignId, campaignId), eq(campfireSounds.fileId, fileId)))).length > 0;
}

// ───────────── Movement ─────────────

async function sheetFor(token: TokenRow): Promise<Sheet5e | null> {
  if (!token.characterId) return null;
  const [ch] = await db.select({ sheet: campfireCharacters.sheet }).from(campfireCharacters).where(eq(campfireCharacters.id, token.characterId));
  return ch ? normalizeSheet(ch.sheet) : null;
}

/** Where the token's move this turn is counted from (its spot when the turn began, or after its last move). */
const anchorOf = (e: CombatEntry & { anchor?: { x: number; y: number } | null }, token: TokenRow) => e.anchor ?? { x: token.x, y: token.y };
type Entry = CombatEntry & { anchor?: { x: number; y: number } | null };

/** What a move costs this turn and whether it fits (null: not counted, the token isn't taking its turn). */
export async function moveCheck(
  t: Table,
  token: TokenRow,
  scene: SceneRow,
  to: { x: number; y: number },
  path: Point[] = [],
): Promise<{ cost: number; left: number; budget: number; enforce: boolean; error: string | null } | null> {
  const combat = t.campaign.combat;
  const entry = combat?.entries[combat.turn] as Entry | undefined;
  if (!combat || !entry || entry.tokenId !== token.id) return null;
  const grid = (scene.grid as { size?: number } | null)?.size ? (scene.grid as never) : null;
  if (!grid) return null;
  const from = anchorOf(entry, token);
  const size = { x: 0, y: 0, w: token.w, h: token.h };
  const centre = (p: { x: number; y: number }): Point => tokenCenter({ ...size, x: p.x, y: p.y }, grid);
  // Players' moves price only the ground they can see (difficult ground under fog counts as plain,
  // so a refusal can't map it), and turns must lie on the map.
  const terrain = (t.gm ? normalizeBuilt(scene.built) : builtForPlayers(scene, fogOf(scene), grid)).terrain ?? [];
  const settings = settingsOf(t.campaign.settings);
  const margin = (grid as { size: number }).size * 2;
  const onMap = (p: Point) => p[0] >= -margin && p[1] >= -margin && p[0] <= scene.widthPx + margin && p[1] <= scene.heightPx + margin;
  if (!path.every(onMap)) return { cost: Number.MAX_SAFE_INTEGER, left: 0, budget: 0, enforce: !t.gm, error: t.gm ? null : "That path leaves the map." };
  const cost = pathCost([centre(from), ...path.slice(0, 50), centre(to)], grid, terrain, settings.diagonal ?? "5");
  const budget = moveBudget(speedFor(await sheetFor(token), token.conditions), !!entry.dashed);
  const left = budget - (entry.moved ?? 0);
  const enforce = !t.gm && !!settings.moveOnTurn;
  const tooFar = cost >= Number.MAX_SAFE_INTEGER ? "That's too far for one move." : `That's ${cost} ft; ${Math.max(0, left)} ft left this turn.`;
  return { cost, left, budget, enforce, error: enforce && cost > left ? (left <= 0 ? "No movement left this turn. Dash for more, or end your turn." : tooFar) : null };
}

/**
 * Counts a committed move on the turn's entry (for the ring, Dash and Undo), under the campaign's
 * row lock. `budget` (players with "move on your turn") re-checks the movement left there, so two
 * moves sent at once can't both spend the same feet: "too_far" means nothing was counted.
 * A game master moving someone else's token (a shove, a fix) isn't charged and can't be undone by
 * them: the turn just counts on from the new spot.
 */
export async function noteMove(
  campaignId: string,
  tokenId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  cost: number,
  opts: { charge: boolean; budget: number | null },
): Promise<CampaignRow | "too_far" | null> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(campfireCampaigns).where(eq(campfireCampaigns.id, campaignId)).for("update");
    const combat = c?.combat;
    const entry = combat?.entries[combat.turn] as Entry | undefined;
    if (!c || !combat || !entry || entry.tokenId !== tokenId) return null;
    const moved = entry.moved ?? 0;
    if (opts.budget !== null && moved + cost > opts.budget) return "too_far";
    const entries = [...combat.entries] as Entry[];
    entries[combat.turn] = opts.charge
      ? { ...entry, moved: Math.min(moved + cost, 99_999), lastMove: { x: from.x, y: from.y, cost: Math.min(cost, 99_999) }, anchor: { x: to.x, y: to.y } }
      : { ...entry, lastMove: null, anchor: { x: to.x, y: to.y } };
    const [row] = await tx.update(campfireCampaigns).set({ combat: { ...combat, entries } }).where(eq(campfireCampaigns.id, c.id)).returning();
    return row;
  });
}

/**
 * A creature's turn begins: its movement starts fresh (counted from where it stands), it gets its
 * legendary actions back, and its timed conditions lose a round (ended ones come off, with a line).
 */
export async function startTurn(campaign: CampaignRow, combat: CombatState): Promise<CombatState> {
  const entry = combat.entries[combat.turn] as Entry | undefined;
  if (!entry) return combat;
  const [found] = await tokensWithScenes([entry.tokenId]);
  const entries = [...combat.entries] as Entry[];
  entries[combat.turn] = { ...entry, moved: 0, dashed: false, lastMove: null, legendaryUsed: 0, anchor: found ? { x: found.token.x, y: found.token.y } : null };
  if (found && Object.keys(found.token.conditionTimers ?? {}).length) {
    const tick = tickConditions(found.token.conditions, found.token.conditionTimers ?? {});
    const [row] = await db
      .update(campfireTokens)
      .set({ conditions: tick.conditions, conditionTimers: tick.timers, updatedAt: new Date() })
      .where(eq(campfireTokens.id, found.token.id))
      .returning();
    if (row) {
      await emitToken(campaign, found.scene, found.token, row);
      if (tick.ended.length) {
        const chars = await charactersInfo(campaign.id);
        const ended = tick.ended.map((c) => c[0].toUpperCase() + c.slice(1)).join(", ");
        // Only people who can see the token (and its place in the order) hear about it, by the name they see.
        await broadcast(campaign, "campfire:notice", (v) => {
          if (!v.gm && (entry.hidden || !tokenVisible(row, found.scene, v, chars))) return null;
          const name = shownName(row, v, chars);
          return { text: name ? `${ended} ended on ${name}` : `${ended} ended` };
        });
      }
    }
  }
  return { ...combat, entries };
}

/** Dash / Undo last move for the token taking its turn (its controller or a GM). */
export async function turnMoveOp(t: Table, op: "dash" | "undoMove"): Promise<{ error: string; status?: number } | { combat: CombatState }> {
  const first = t.campaign.combat?.entries[t.campaign.combat.turn] as Entry | undefined;
  if (!first) return { error: "Start combat first.", status: 409 };
  const [found] = await tokensWithScenes([first.tokenId]);
  if (!found) return { error: "That token isn't on the map anymore.", status: 404 };
  if (!t.gm) {
    if (!controls(found.token, t.userId, await charactersInfo(t.campaign.id))) return { error: "It isn't your turn.", status: 403 };
    if (op === "undoMove" && (found.token.locked || settingsOf(t.campaign.settings).tokensLocked)) return { error: "The game master locked this token.", status: 403 };
  }
  // Read and write the turn under the campaign's row lock (moves and Dash sent at once don't undo each other).
  const out = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const combat = c?.combat;
    const entry = combat?.entries[combat.turn] as Entry | undefined;
    if (!c || !combat || !entry || entry.tokenId !== first.tokenId) return { error: "The turn moved on.", status: 409 } as const;
    const entries = [...combat.entries] as Entry[];
    let token: TokenRow | null = null;
    if (op === "dash") {
      if (entry.dashed) return { error: "Already dashing this turn." } as const;
      entries[combat.turn] = { ...entry, dashed: true };
    } else {
      const last = entry.lastMove;
      if (!last) return { error: "Nothing to undo this turn." } as const;
      [token] = await tx.update(campfireTokens).set({ x: last.x, y: last.y, updatedAt: new Date() }).where(eq(campfireTokens.id, found.token.id)).returning();
      entries[combat.turn] = { ...entry, moved: Math.max(0, (entry.moved ?? 0) - last.cost), lastMove: null, anchor: { x: last.x, y: last.y } };
    }
    const next = { ...combat, entries };
    const [row] = await tx.update(campfireCampaigns).set({ combat: next, updatedAt: new Date() }).where(eq(campfireCampaigns.id, c.id)).returning();
    return { row, next, token };
  });
  if (!("row" in out) || !out.row) return { error: out.error ?? "That didn't work.", ...(out.status ? { status: out.status } : {}) };
  if (out.token) await emitToken(t.campaign, found.scene, found.token, out.token);
  await emitCombat(out.row);
  return { combat: out.next! };
}
