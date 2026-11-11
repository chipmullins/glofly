import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, lte, gte, sql } from "drizzle-orm";
import {
  DEFAULT_PROGRESS,
  EMPTY_LOOT,
  EMPTY_STATS,
  HOMEBREW_KINDS,
  HUB_LIMITS,
  normalizeHomebrew,
  normalizeLoot,
  normalizeProgress,
  normalizeSheet,
  normalizeStats,
  recapDraft,
  splitCoins,
  totalLevel,
  type CampaignHub,
  type CampfireSession,
  type Homebrew,
  type HomebrewKind,
  type JournalEntry,
  type PartyLoot,
  type PartyMember,
  type Quest,
  type SessionStats,
} from "@glofly/shared";
import { db } from "../db";
import {
  campfireCampaigns,
  campfireCharacters,
  campfireFiles,
  campfireHomebrew,
  campfireJournal,
  campfireMembers,
  campfireQuests,
  campfireRsvps,
  campfireSessions,
} from "../db/schema";
import { bad, cleanText, firstIssue, idParam, limiter, me, notFound, tableOr } from "./http";
import { campaignRow, tableFor, type CampaignRow, type Table } from "./perms";
import { openCallOf } from "./live";
import { broadcast, emitCharacter } from "./state";
import { notifySessionReminder } from "../push/notify";
import { setSessionNoter } from "./sessionHook";

// Campfire Round A (Nov 2026): the campaign hub. Sessions (planned times, RSVPs, recaps drafted
// from what the server counted while it was played), quests, the NPC and place journal, party
// loot with an even split, the campaign's own homebrew, and switching over mid-campaign.
//
//   GET    /campfire/campaigns/:id/hub                 everything above (players: no hidden things)
//   PATCH  /campfire/campaigns/:id/hub                 { pitch?, bannerFileId?, progress? } (GM)
//   POST   /campfire/campaigns/:id/continue            { sessionsBefore, level, story, quests[] } (GM)
//   POST   /campfire/campaigns/:id/sessions            { title?, startsAt? } (GM)
//   PATCH  /campfire/sessions/:id                      { title?, startsAt?, recap?, post? } (GM)
//   DELETE /campfire/sessions/:id                      (GM)
//   PUT    /campfire/sessions/:id/rsvp                 { answer: yes | maybe | no }
//   POST   /campfire/sessions/:id/draft                → { draft } (GM)
//   POST   /campfire/campaigns/:id/quests · PATCH/DELETE /campfire/quests/:id   (GM)
//   POST   /campfire/campaigns/:id/journal · PATCH/DELETE /campfire/journal/:id (GM)
//   PUT    /campfire/campaigns/:id/loot                { loot } (GM)
//   POST   /campfire/campaigns/:id/loot/split          { characterIds? } → coins to each PC (GM)
//   POST   /campfire/campaigns/:id/loot/give           { itemId, characterId } (GM)
//   GET    /campfire/campaigns/:id/homebrew?kind=      (players: shared ones)
//   POST   /campfire/campaigns/:id/homebrew            { kind, name, data, shared? } (GM)
//   PATCH/DELETE /campfire/homebrew/:id · POST /campfire/homebrew/:id/copy { campaignId } (GM in both)

export const hubRouter = Router();

const changeLimiter = limiter("campfire:hub", 300, 60 * 1000, "That's a lot of changes. Wait a moment and try again.");
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const longText = (max: number) =>
  z
    .string()
    .max(max, `That can be up to ${max.toLocaleString()} characters.`)
    .transform((s) => s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""));

/** Tells everyone at the table the hub changed (their apps reload it if it's open). */
const tellHub = (campaign: CampaignRow, reason: string) => broadcast(campaign, "campfire:hub", () => ({ reason }));

// ───────────── Reading the hub ─────────────

type SessionRow = typeof campfireSessions.$inferSelect;
function sessionOut(row: SessionRow, rsvps: { userId: string; answer: string }[], gm: boolean): CampfireSession {
  const posted = !!row.recapPostedAt;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    startsAt: iso(row.startsAt),
    // Players see a recap once the GM posts it (the draft and its counts stay with GMs until then).
    recap: gm || posted ? row.recap : "",
    recapPostedAt: iso(row.recapPostedAt),
    stats: gm || posted ? normalizeStats(row.stats ?? EMPTY_STATS) : { ...EMPTY_STATS },
    rsvps: rsvps.map((r) => ({ userId: r.userId, answer: r.answer === "yes" || r.answer === "no" ? r.answer : "maybe" })),
    ...(row.before ? { before: true } : {}),
  };
}

const questOut = (q: typeof campfireQuests.$inferSelect): Quest => ({
  id: q.id,
  title: q.title,
  detail: q.detail,
  giver: q.giver,
  status: q.status === "done" || q.status === "failed" ? q.status : "open",
  hidden: q.hidden,
  sort: q.sort,
});

function journalOut(j: typeof campfireJournal.$inferSelect, gm: boolean): JournalEntry {
  const kind = j.kind === "place" || j.kind === "item" || j.kind === "lore" ? j.kind : "npc";
  return { id: j.id, kind, name: j.name, text: j.text, hidden: j.hidden, ...(gm ? { gmNotes: j.gmNotes } : {}), pictureFileId: j.pictureFileId };
}

const homebrewOut = (h: typeof campfireHomebrew.$inferSelect): Homebrew => ({
  id: h.id,
  kind: (HOMEBREW_KINDS as readonly string[]).includes(h.kind) ? (h.kind as HomebrewKind) : "item",
  name: h.name,
  shared: h.shared,
  data: h.data,
  updatedAt: h.updatedAt.toISOString(),
});

async function partyOf(campaignId: string): Promise<PartyMember[]> {
  const rows = await db
    .select()
    .from(campfireCharacters)
    .where(and(eq(campfireCharacters.campaignId, campaignId), eq(campfireCharacters.kind, "pc")))
    .orderBy(asc(campfireCharacters.createdAt));
  return rows.map((c) => {
    const sheet = normalizeSheet(c.sheet);
    const classes = sheet.classes.map((k) => `${k.name} ${k.level}`).join(" / ");
    return {
      characterId: c.id,
      ownerId: c.ownerId,
      name: c.name,
      portraitFileId: c.portraitFileId,
      line: [sheet.race, classes].filter((x) => x.trim()).join(" · "),
      level: Math.max(1, totalLevel(sheet)),
    };
  });
}

export async function hubFor(t: Table): Promise<CampaignHub> {
  const c = t.campaign;
  const sessions = await db.select().from(campfireSessions).where(eq(campfireSessions.campaignId, c.id)).orderBy(desc(campfireSessions.number));
  const rsvps = sessions.length
    ? await db.select().from(campfireRsvps).where(inArray(campfireRsvps.sessionId, sessions.map((s) => s.id)))
    : [];
  const quests = await db.select().from(campfireQuests).where(eq(campfireQuests.campaignId, c.id)).orderBy(asc(campfireQuests.sort), asc(campfireQuests.createdAt));
  const journal = await db.select().from(campfireJournal).where(eq(campfireJournal.campaignId, c.id)).orderBy(asc(campfireJournal.name));
  const counts = await db
    .select({ kind: campfireHomebrew.kind, n: sql<number>`count(*)::int` })
    .from(campfireHomebrew)
    .where(and(eq(campfireHomebrew.campaignId, c.id), ...(t.gm ? [] : [eq(campfireHomebrew.shared, true)])))
    .groupBy(campfireHomebrew.kind);
  return {
    campaignId: c.id,
    pitch: c.pitch,
    bannerFileId: c.bannerFileId,
    progress: normalizeProgress(c.progress ?? DEFAULT_PROGRESS),
    sessions: sessions.map((s) => sessionOut(s, rsvps.filter((r) => r.sessionId === s.id), t.gm)),
    // Hidden quests and journal entries are the GM's (players never receive them).
    quests: quests.filter((q) => t.gm || !q.hidden).map(questOut),
    journal: journal.filter((j) => t.gm || !j.hidden).map((j) => journalOut(j, t.gm)),
    loot: c.loot ? normalizeLoot(c.loot) : { ...EMPTY_LOOT, coins: { ...EMPTY_LOOT.coins } },
    party: await partyOf(c.id),
    homebrewCounts: Object.fromEntries(counts.map((r) => [r.kind, r.n])),
  };
}

hubRouter.get("/campaigns/:id/hub", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  res.json(await hubFor(t));
});

/** A picture of this campaign a GM uploaded (banner, journal pictures). */
async function gmPicture(t: Table, fileId: string): Promise<boolean> {
  const [f] = await db.select().from(campfireFiles).where(and(eq(campfireFiles.id, fileId), eq(campfireFiles.campaignId, t.campaign.id)));
  return !!f && f.kind !== "audio";
}

hubRouter.patch("/campaigns/:id/hub", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z
    .object({
      pitch: z.string().max(HUB_LIMITS.pitch, `The pitch can be up to ${HUB_LIMITS.pitch} characters.`).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).optional(),
      bannerFileId: z.uuid().nullable().optional(),
      progress: z.object({ sessionsBefore: z.number().int().min(0).max(999), level: z.number().int().min(1).max(20) }).optional(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.bannerFileId && !(await gmPicture(t, d.bannerFileId))) return bad(res, "Upload that picture to this campaign first.");
  const [row] = await db
    .update(campfireCampaigns)
    .set({
      ...(d.pitch !== undefined ? { pitch: d.pitch } : {}),
      ...(d.bannerFileId !== undefined ? { bannerFileId: d.bannerFileId } : {}),
      ...(d.progress ? { progress: normalizeProgress(d.progress) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(campfireCampaigns.id, t.campaign.id))
    .returning();
  await tellHub(row, "campaign");
  res.json(await hubFor({ ...t, campaign: row }));
});

// ───────────── Switching over mid-campaign ─────────────

hubRouter.post("/campaigns/:id/continue", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z
    .object({
      sessionsBefore: z.number().int().min(0).max(999),
      level: z.number().int().min(1).max(20),
      story: longText(HUB_LIMITS.recap).optional(),
      quests: z.array(cleanText(HUB_LIMITS.title, "A quest")).max(30).optional(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const row = await db.transaction(async (tx) => {
    const [c] = await tx
      .update(campfireCampaigns)
      .set({ progress: { sessionsBefore: d.sessionsBefore, level: d.level }, updatedAt: new Date() })
      .where(eq(campfireCampaigns.id, t.campaign.id))
      .returning();
    // The story so far becomes "Before Campfire" (session 0), posted so players see it.
    const story = d.story?.trim();
    const [existing] = await tx.select().from(campfireSessions).where(and(eq(campfireSessions.campaignId, c.id), eq(campfireSessions.before, true)));
    if (story && existing) await tx.update(campfireSessions).set({ recap: story, recapPostedAt: new Date() }).where(eq(campfireSessions.id, existing.id));
    else if (story) await tx.insert(campfireSessions).values({ campaignId: c.id, number: 0, title: "Before Campfire", recap: story, recapPostedAt: new Date(), before: true });
    const quests = (d.quests ?? []).filter(Boolean);
    if (quests.length) await tx.insert(campfireQuests).values(quests.map((title, i) => ({ campaignId: c.id, title, sort: i })));
    return c;
  });
  await tellHub(row, "continue");
  res.json(await hubFor({ ...t, campaign: row }));
});

// ───────────── Sessions ─────────────

const when = z.iso.datetime({ offset: true }).transform((s) => new Date(s)).nullable();

/** The next number: after the highest one, counting sessions played before Campfire. */
async function nextNumber(campaign: CampaignRow): Promise<number> {
  const [top] = await db.select({ n: sql<number>`coalesce(max(${campfireSessions.number}), 0)::int` }).from(campfireSessions).where(eq(campfireSessions.campaignId, campaign.id));
  const before = normalizeProgress(campaign.progress ?? DEFAULT_PROGRESS).sessionsBefore;
  return Math.max(top?.n ?? 0, before) + 1;
}

hubRouter.post("/campaigns/:id/sessions", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ title: z.string().max(HUB_LIMITS.title).optional(), startsAt: when.optional() }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const count = await db.select({ n: sql<number>`count(*)::int` }).from(campfireSessions).where(eq(campfireSessions.campaignId, t.campaign.id));
  if ((count[0]?.n ?? 0) >= HUB_LIMITS.sessions) return bad(res, "This campaign has a lot of sessions already.", 409);
  const [row] = await db
    .insert(campfireSessions)
    .values({ campaignId: t.campaign.id, number: await nextNumber(t.campaign), title: (parsed.data.title ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim(), startsAt: parsed.data.startsAt ?? null })
    .returning();
  await tellHub(t.campaign, "session");
  res.status(201).json(sessionOut(row, [], true));
});

async function sessionTable(res: Parameters<typeof tableOr>[0], id: unknown, opts: { gm?: boolean; write?: boolean } = {}) {
  const sid = idParam.safeParse(id);
  const [row] = sid.success ? await db.select().from(campfireSessions).where(eq(campfireSessions.id, sid.data)) : [];
  if (!row) {
    notFound(res, "That session isn't available.");
    return null;
  }
  const t = await tableOr(res, row.campaignId, opts);
  return t ? { t, row } : null;
}

hubRouter.patch("/sessions/:id", changeLimiter, async (req, res) => {
  const found = await sessionTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, row } = found;
  const parsed = z
    .object({ title: z.string().max(HUB_LIMITS.title).optional(), startsAt: when.optional(), recap: longText(HUB_LIMITS.recap).optional(), post: z.boolean().optional() })
    .strict()
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const [next] = await db
    .update(campfireSessions)
    .set({
      ...(d.title !== undefined ? { title: d.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim() } : {}),
      // A new time means new reminders.
      ...(d.startsAt !== undefined ? { startsAt: d.startsAt, reminded: [] } : {}),
      ...(d.recap !== undefined ? { recap: d.recap } : {}),
      ...(d.post === true ? { recapPostedAt: row.recapPostedAt ?? new Date() } : d.post === false ? { recapPostedAt: null } : {}),
    })
    .where(eq(campfireSessions.id, row.id))
    .returning();
  await tellHub(t.campaign, "session");
  const rsvps = await db.select().from(campfireRsvps).where(eq(campfireRsvps.sessionId, row.id));
  res.json(sessionOut(next, rsvps, true));
});

hubRouter.delete("/sessions/:id", changeLimiter, async (req, res) => {
  const found = await sessionTable(res, req.params.id, { gm: true });
  if (!found) return;
  await db.delete(campfireSessions).where(eq(campfireSessions.id, found.row.id));
  await tellHub(found.t.campaign, "session");
  res.json({ ok: true });
});

hubRouter.put("/sessions/:id/rsvp", changeLimiter, async (req, res) => {
  const found = await sessionTable(res, req.params.id, { write: true });
  if (!found) return;
  const parsed = z.object({ answer: z.enum(["yes", "maybe", "no"]) }).safeParse(req.body);
  if (!parsed.success) return bad(res, "Answer yes, maybe or no.");
  if (found.row.before) return bad(res, "That's the story so far, not a session to go to.");
  await db
    .insert(campfireRsvps)
    .values({ sessionId: found.row.id, userId: found.t.userId, answer: parsed.data.answer })
    .onConflictDoUpdate({ target: [campfireRsvps.sessionId, campfireRsvps.userId], set: { answer: parsed.data.answer, updatedAt: new Date() } });
  await tellHub(found.t.campaign, "rsvp");
  res.json({ ok: true, answer: parsed.data.answer });
});

hubRouter.post("/sessions/:id/draft", changeLimiter, async (req, res) => {
  const found = await sessionTable(res, req.params.id, { gm: true });
  if (!found) return;
  res.json({ draft: recapDraft(normalizeStats(found.row.stats ?? EMPTY_STATS)) });
});

// ───────────── Counting what happens at the table (for the recap draft) ─────────────

const SESSION_WINDOW_BEFORE = 2 * 60 * 60 * 1000;
const SESSION_WINDOW_AFTER = 14 * 60 * 60 * 1000;

/**
 * The session being played now: a planned one that started (or starts within 2 hours) up to 14
 * hours ago. With none planned, a table lit in a call starts "Session N" itself. Otherwise
 * nothing is counted (a GM preparing alone isn't a session).
 */
async function currentSession(campaign: CampaignRow): Promise<SessionRow | null> {
  const now = Date.now();
  const [planned] = await db
    .select()
    .from(campfireSessions)
    .where(
      and(
        eq(campfireSessions.campaignId, campaign.id),
        eq(campfireSessions.before, false),
        lte(campfireSessions.startsAt, new Date(now + SESSION_WINDOW_BEFORE)),
        gte(campfireSessions.startsAt, new Date(now - SESSION_WINDOW_AFTER)),
      ),
    )
    .orderBy(desc(campfireSessions.startsAt))
    .limit(1);
  if (planned) return planned;
  if (!openCallOf(campaign.id)) return null;
  const [row] = await db
    .insert(campfireSessions)
    .values({ campaignId: campaign.id, number: await nextNumber(campaign), startsAt: new Date(now), reminded: ["day", "soon"] })
    .returning();
  return row;
}

/** Adds to the current session's counts (never throws: counting is a nicety). */
export async function noteSession(campaign: CampaignRow, change: (s: SessionStats) => SessionStats): Promise<void> {
  try {
    const session = await currentSession(campaign);
    if (!session) return;
    await db.transaction(async (tx) => {
      const [row] = await tx.select({ stats: campfireSessions.stats }).from(campfireSessions).where(eq(campfireSessions.id, session.id)).for("update");
      if (!row) return;
      await tx.update(campfireSessions).set({ stats: normalizeStats(change(normalizeStats(row.stats ?? EMPTY_STATS))) }).where(eq(campfireSessions.id, session.id));
    });
  } catch (err) {
    console.error("Campfire session counts:", err);
  }
}

setSessionNoter(noteSession);

// ───────────── Quests and the journal ─────────────

const questInput = z
  .object({
    title: cleanText(HUB_LIMITS.title, "The quest").optional(),
    detail: longText(2000).optional(),
    giver: z.string().max(80).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).optional(),
    status: z.enum(["open", "done", "failed"]).optional(),
    hidden: z.boolean().optional(),
    sort: z.number().int().min(-10000).max(10000).optional(),
  })
  .strict();

hubRouter.post("/campaigns/:id/quests", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = questInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  if (!parsed.data.title) return bad(res, "Give the quest a name.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireQuests).where(eq(campfireQuests.campaignId, t.campaign.id));
  if (n >= HUB_LIMITS.quests) return bad(res, "That's a lot of quests. Remove some finished ones first.", 409);
  const [row] = await db.insert(campfireQuests).values({ campaignId: t.campaign.id, ...parsed.data, title: parsed.data.title }).returning();
  await tellHub(t.campaign, "quest");
  res.status(201).json(questOut(row));
});

async function rowTable<T extends { campaignId: string }>(res: Parameters<typeof tableOr>[0], id: unknown, load: (id: string) => Promise<T | undefined>) {
  const rid = idParam.safeParse(id);
  const row = rid.success ? await load(rid.data) : undefined;
  if (!row) {
    notFound(res);
    return null;
  }
  const t = await tableOr(res, row.campaignId, { gm: true });
  return t ? { t, row } : null;
}
const questById = async (id: string) => (await db.select().from(campfireQuests).where(eq(campfireQuests.id, id)))[0];
const journalById = async (id: string) => (await db.select().from(campfireJournal).where(eq(campfireJournal.id, id)))[0];
const homebrewById = async (id: string) => (await db.select().from(campfireHomebrew).where(eq(campfireHomebrew.id, id)))[0];

hubRouter.patch("/quests/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, questById);
  if (!found) return;
  const parsed = questInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const [row] = await db.update(campfireQuests).set({ ...parsed.data, updatedAt: new Date() }).where(eq(campfireQuests.id, found.row.id)).returning();
  await tellHub(found.t.campaign, "quest");
  res.json(questOut(row));
});

hubRouter.delete("/quests/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, questById);
  if (!found) return;
  await db.delete(campfireQuests).where(eq(campfireQuests.id, found.row.id));
  await tellHub(found.t.campaign, "quest");
  res.json({ ok: true });
});

const journalInput = z
  .object({
    kind: z.enum(["npc", "place", "item", "lore"]).optional(),
    name: cleanText(HUB_LIMITS.title, "The name").optional(),
    text: longText(HUB_LIMITS.text).optional(),
    hidden: z.boolean().optional(),
    gmNotes: longText(HUB_LIMITS.text).optional(),
    pictureFileId: z.uuid().nullable().optional(),
  })
  .strict();

hubRouter.post("/campaigns/:id/journal", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = journalInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!d.name) return bad(res, "Give it a name.");
  if (d.pictureFileId && !(await gmPicture(t, d.pictureFileId))) return bad(res, "Upload that picture to this campaign first.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireJournal).where(eq(campfireJournal.campaignId, t.campaign.id));
  if (n >= HUB_LIMITS.journal) return bad(res, "The journal is full.", 409);
  const [row] = await db.insert(campfireJournal).values({ campaignId: t.campaign.id, kind: d.kind ?? "npc", ...d, name: d.name }).returning();
  await tellHub(t.campaign, "journal");
  res.status(201).json(journalOut(row, true));
});

hubRouter.patch("/journal/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, journalById);
  if (!found) return;
  const parsed = journalInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  if (parsed.data.pictureFileId && !(await gmPicture(found.t, parsed.data.pictureFileId))) return bad(res, "Upload that picture to this campaign first.");
  const [row] = await db.update(campfireJournal).set({ ...parsed.data, updatedAt: new Date() }).where(eq(campfireJournal.id, found.row.id)).returning();
  await tellHub(found.t.campaign, "journal");
  res.json(journalOut(row, true));
});

hubRouter.delete("/journal/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, journalById);
  if (!found) return;
  await db.delete(campfireJournal).where(eq(campfireJournal.id, found.row.id));
  await tellHub(found.t.campaign, "journal");
  res.json({ ok: true });
});

// ───────────── Party loot ─────────────

hubRouter.put("/campaigns/:id/loot", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const loot = normalizeLoot(req.body?.loot);
  const [row] = await db.update(campfireCampaigns).set({ loot, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
  await tellHub(row, "loot");
  res.json(loot);
});

/** The campaign's PCs (only those), for splitting and giving. */
async function pcsOf(campaignId: string, ids?: string[]) {
  const rows = await db
    .select()
    .from(campfireCharacters)
    .where(and(eq(campfireCharacters.campaignId, campaignId), eq(campfireCharacters.kind, "pc"), ...(ids?.length ? [inArray(campfireCharacters.id, ids)] : [])));
  return rows;
}

hubRouter.post("/campaigns/:id/loot/split", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ characterIds: z.array(z.uuid()).max(20).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const pot: PartyLoot = c?.loot ? normalizeLoot(c.loot) : { ...EMPTY_LOOT };
    const pcs = await pcsOf(t.campaign.id, parsed.data.characterIds);
    if (!pcs.length) return null;
    const { each, left } = splitCoins(pot.coins, pcs.length);
    for (const pc of pcs) {
      const sheet = normalizeSheet(pc.sheet);
      const had = sheet.coins ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      sheet.coins = { cp: had.cp + each.cp, sp: had.sp + each.sp, ep: had.ep + each.ep, gp: had.gp + each.gp, pp: had.pp + each.pp };
      await tx.update(campfireCharacters).set({ sheet: normalizeSheet(sheet), updatedAt: new Date() }).where(eq(campfireCharacters.id, pc.id));
    }
    const loot = { ...pot, coins: left };
    const [row] = await tx.update(campfireCampaigns).set({ loot, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
    return { row, each, people: pcs.map((p) => p.id), loot };
  });
  if (!result) return bad(res, "There are no player characters to split it between yet.");
  for (const id of result.people) await emitCharacter(result.row, id);
  await tellHub(result.row, "loot");
  res.json({ each: result.each, loot: result.loot });
});

hubRouter.post("/campaigns/:id/loot/give", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ itemId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), characterId: z.uuid() }).safeParse(req.body);
  if (!parsed.success) return bad(res, "Pick an item and who gets it.");
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const pot = c?.loot ? normalizeLoot(c.loot) : { ...EMPTY_LOOT };
    const item = pot.items.find((i) => i.id === parsed.data.itemId);
    const [pc] = await tx.select().from(campfireCharacters).where(and(eq(campfireCharacters.id, parsed.data.characterId), eq(campfireCharacters.campaignId, t.campaign.id)));
    if (!item || !pc) return null;
    const sheet = normalizeSheet(pc.sheet);
    let extra = {};
    if (item.homebrewId) {
      const [hb] = await tx.select().from(campfireHomebrew).where(and(eq(campfireHomebrew.id, item.homebrewId), eq(campfireHomebrew.campaignId, t.campaign.id)));
      if (hb?.kind === "item") extra = itemFromHomebrew(hb.data as never, hb.id);
    }
    sheet.inventory = [...sheet.inventory, { id: `i${Date.now().toString(36)}`, name: item.name, qty: item.qty, notes: item.notes, ...extra }];
    await tx.update(campfireCharacters).set({ sheet: normalizeSheet(sheet), updatedAt: new Date() }).where(eq(campfireCharacters.id, pc.id));
    const loot = { ...pot, items: pot.items.filter((i) => i.id !== item.id) };
    const [row] = await tx.update(campfireCampaigns).set({ loot, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
    return { row, loot, pcId: pc.id };
  });
  if (!result) return notFound(res, "That item or character isn't here anymore.");
  await emitCharacter(result.row, result.pcId);
  await tellHub(result.row, "loot");
  res.json({ loot: result.loot });
});

/** A homebrew item as an inventory entry's extra fields. */
export function itemFromHomebrew(data: { itemKind?: string; weight?: number; attunement?: boolean; rarity?: string; acBonus?: number; armor?: { base: number; dex: boolean; maxDex: number | null } }, id: string) {
  return {
    kind: data.itemKind === "armor" || data.itemKind === "shield" || data.itemKind === "weapon" || data.itemKind === "gear" ? data.itemKind : "magic",
    weight: data.weight ?? 0,
    ...(data.attunement ? { attunement: true } : {}),
    ...(data.rarity ? { rarity: data.rarity } : {}),
    ...(typeof data.acBonus === "number" ? { acBonus: data.acBonus } : {}),
    ...(data.armor ? { armor: data.armor } : {}),
    homebrewId: id,
  } as const;
}

// ───────────── Homebrew ─────────────

hubRouter.get("/campaigns/:id/homebrew", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  const kind = typeof req.query.kind === "string" && (HOMEBREW_KINDS as readonly string[]).includes(req.query.kind) ? req.query.kind : null;
  const rows = await db
    .select()
    .from(campfireHomebrew)
    .where(and(eq(campfireHomebrew.campaignId, t.campaign.id), ...(kind ? [eq(campfireHomebrew.kind, kind)] : []), ...(t.gm ? [] : [eq(campfireHomebrew.shared, true)])))
    .orderBy(asc(campfireHomebrew.name));
  res.json({ homebrew: rows.map(homebrewOut) });
});

const homebrewInput = z
  .object({
    kind: z.enum(HOMEBREW_KINDS as unknown as ["item", ...HomebrewKind[]]).optional(),
    name: cleanText(HUB_LIMITS.title, "The name").optional(),
    data: z.unknown().optional(),
    shared: z.boolean().optional(),
  })
  .strict();

hubRouter.post("/campaigns/:id/homebrew", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = homebrewInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!d.kind || !d.name) return bad(res, "Say what it is and give it a name.");
  if (JSON.stringify(d.data ?? {}).length > 64_000) return bad(res, "That's too big.", 413, "too_large");
  const data = normalizeHomebrew(d.kind, d.data ?? {});
  if (!data) return bad(res, "Some of that doesn't fit this kind of homebrew.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireHomebrew).where(eq(campfireHomebrew.campaignId, t.campaign.id));
  if (n >= HUB_LIMITS.homebrew) return bad(res, "This campaign has a lot of homebrew already.", 409);
  const [row] = await db.insert(campfireHomebrew).values({ campaignId: t.campaign.id, kind: d.kind, name: d.name, data, shared: d.shared ?? false, createdBy: t.userId }).returning();
  await tellHub(t.campaign, "homebrew");
  res.status(201).json(homebrewOut(row));
});

hubRouter.patch("/homebrew/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, homebrewById);
  if (!found) return;
  const parsed = homebrewInput.omit({ kind: true }).safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.data !== undefined && JSON.stringify(d.data).length > 64_000) return bad(res, "That's too big.", 413, "too_large");
  const data = d.data !== undefined ? normalizeHomebrew(found.row.kind as HomebrewKind, d.data) : undefined;
  if (data === null) return bad(res, "Some of that doesn't fit this kind of homebrew.");
  const [row] = await db
    .update(campfireHomebrew)
    .set({ ...(d.name ? { name: d.name } : {}), ...(data ? { data } : {}), ...(d.shared !== undefined ? { shared: d.shared } : {}), updatedAt: new Date() })
    .where(eq(campfireHomebrew.id, found.row.id))
    .returning();
  await tellHub(found.t.campaign, "homebrew");
  res.json(homebrewOut(row));
});

hubRouter.delete("/homebrew/:id", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, homebrewById);
  if (!found) return;
  await db.delete(campfireHomebrew).where(eq(campfireHomebrew.id, found.row.id));
  await tellHub(found.t.campaign, "homebrew");
  res.json({ ok: true });
});

hubRouter.post("/homebrew/:id/copy", changeLimiter, async (req, res) => {
  const found = await rowTable(res, req.params.id, homebrewById);
  if (!found) return;
  const target = idParam.safeParse(req.body?.campaignId);
  const to = target.success ? await tableFor(target.data, me(res).id) : null;
  if (!to) return notFound(res, "That campaign isn't available.");
  if (!to.gm || to.readOnly) return bad(res, "You can copy homebrew only to campaigns you run.", 403);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireHomebrew).where(eq(campfireHomebrew.campaignId, to.campaign.id));
  if (n >= HUB_LIMITS.homebrew) return bad(res, "That campaign has a lot of homebrew already.", 409);
  const { characterId: _c, ...data } = found.row.data as { characterId?: string };
  const [row] = await db
    .insert(campfireHomebrew)
    .values({ campaignId: to.campaign.id, kind: found.row.kind, name: found.row.name, data: data as never, shared: false, createdBy: to.userId })
    .returning();
  await tellHub(to.campaign, "homebrew");
  res.status(201).json(homebrewOut(row));
});

// ───────────── Reminders ─────────────

/**
 * Every minute: the day before (from 24 hours ahead) and 30 minutes ahead of a planned session,
 * a push to the campaign's members who didn't say they can't come.
 */
export async function sweepSessionReminders(): Promise<void> {
  const now = Date.now();
  const due = await db
    .select()
    .from(campfireSessions)
    .where(and(eq(campfireSessions.before, false), gte(campfireSessions.startsAt, new Date(now)), lte(campfireSessions.startsAt, new Date(now + 24 * 60 * 60 * 1000))))
    .limit(200);
  for (const s of due) {
    const left = s.startsAt!.getTime() - now;
    const which = left <= 30 * 60 * 1000 ? "soon" : "day";
    if (s.reminded.includes(which)) continue;
    // Claim it first, so two servers (or a slow push) never remind twice.
    const claimed = await db
      .update(campfireSessions)
      .set({ reminded: [...new Set([...s.reminded, which, ...(which === "soon" ? ["day"] : [])])] })
      .where(and(eq(campfireSessions.id, s.id), sql`not (${which} = any(${campfireSessions.reminded}))`))
      .returning({ id: campfireSessions.id });
    if (!claimed.length) continue;
    const campaign = await campaignRow(s.campaignId);
    if (!campaign || campaign.deletedAt) continue;
    const members = await db.select({ userId: campfireMembers.userId }).from(campfireMembers).where(eq(campfireMembers.campaignId, campaign.id));
    const nos = new Set((await db.select().from(campfireRsvps).where(and(eq(campfireRsvps.sessionId, s.id), eq(campfireRsvps.answer, "no")))).map((r) => r.userId));
    const to: string[] = [];
    for (const m of members) if (!nos.has(m.userId) && (await tableFor(campaign, m.userId))) to.push(m.userId);
    const conversationId = campaign.homeConversationId ?? campaign.conversationId;
    if (!to.length || !conversationId) continue;
    await notifySessionReminder(to, {
      campaignName: campaign.name,
      sessionTitle: s.title || `Session ${s.number}`,
      conversationId,
      nebula: !!campaign.constellationId,
      constellationId: campaign.constellationId,
      minutes: Math.max(1, Math.round(left / 60_000)),
      startsAt: s.startsAt!,
    }).catch((err) => console.error("Campfire reminder:", err));
  }
}

