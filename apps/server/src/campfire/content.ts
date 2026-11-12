import { isSoundFile } from "./roundB";
import express, { Router } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  CAMPFIRE_LIMITS,
  creditFor,
  isRulesSet,
  rulesOf,
  longRest,
  normalizeSheet,
  shortRest,
  type MusicState,
  type RulesSet,
} from "@glofly/shared";
import { db } from "../db";
import {
  campfireCampaigns,
  campfireCharacters,
  campfireFiles,
  campfireHandouts,
  campfireJournal,
  campfireScenes,
  campfireTokens,
  campfireTracks,
} from "../db/schema";
import { sendStream, storage } from "../storage";
import { inHome, type Table } from "./perms";
import { bad, cleanText, firstIssue, idParam, limiter, notFound, tableOr, uuidList } from "./http";
import { broadcast, charactersInfo, emitCharacter, sceneRow } from "./state";
import { characterOut, handoutOut, handoutSummary, handoutVisible, tokenVisible, trackOut, type HandoutRow } from "./view";
import { fileOut, isFileKind, maxBytesFor, removeStored, saveUpload, UploadProblem, type FileRow } from "./files";
import { syncTokensFromSheet } from "./sync";
import { builderData, isSrdSlug, monsterBySlug, searchItems, searchMonsters, searchSpells, spellBySlug } from "./srd";

// Campfire content: character sheets, uploaded files, handouts, the jukebox and the SRD
// compendium.
//
//   POST   /campfire/campaigns/:id/characters      { kind, name, sheet?, srdMonster?, ownerId?, portraitFileId?, ddbUrl? }
//   GET/PATCH/DELETE /campfire/characters/:id      · POST /campfire/characters/:id/rest { kind: short | long }
//   POST   /campfire/campaigns/:id/files?kind=…    the file is the body · GET/DELETE /campfire/files/:id
//   GET/POST /campfire/campaigns/:id/handouts      · GET/PATCH/DELETE …/handouts/:handoutId
//   POST   /campfire/campaigns/:id/tracks          { fileId, title? } · DELETE /campfire/tracks/:id
//   POST   /campfire/campaigns/:id/music           { op: play | pause | seek | stop, trackId?, position?, loop?, volume? }
//   GET    /campfire/srd/monsters?q= · /srd/monsters/:slug · /srd/spells?q=&level=&class= · /srd/spells/:slug

export const contentRouter = Router();

const changeLimiter = limiter("campfire:content", 300, 60 * 1000, "That's a lot of changes. Wait a moment and try again.");
const uploadLimiter = limiter("campfire:upload", 30, 10 * 60 * 1000, "That's a lot of uploads. Wait a few minutes and try again.");
const srdLimiter = limiter("campfire:srd", 120, 60 * 1000, "That's a lot of searching. Try again in a minute.");

/** The biggest a sheet may be (stored as JSON). */
const SHEET_MAX_BYTES = 128 * 1024;

const fileIn = async (campaignId: string, fileId: string, kinds: string[]): Promise<FileRow | null> => {
  const [f] = await db.select().from(campfireFiles).where(and(eq(campfireFiles.id, fileId), eq(campfireFiles.campaignId, campaignId)));
  return f && kinds.includes(f.kind) ? f : null;
};

/**
 * A picture someone may use as a character's portrait. Players: only pictures they uploaded
 * (a PC's portrait is shown to everyone, so pointing one at a GM's picture, like a hidden
 * monster's token, would hand it out).
 */
const portraitFor = async (t: Table, fileId: string): Promise<FileRow | null> => {
  const f = await fileIn(t.campaign.id, fileId, ["portrait", "token"]);
  return f && (t.gm || f.uploadedBy === t.userId) ? f : null;
};

/** A D&D Beyond character link (opened in the browser; nothing is imported). */
const ddbUrl = z
  .string()
  .max(300)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && (u.hostname === "www.dndbeyond.com" || u.hostname === "dndbeyond.com" || u.hostname === "ddb.ac");
    } catch {
      return false;
    }
  }, "That doesn't look like a D&D Beyond character link.")
  .nullable();

// ───────────── Characters ─────────────

const characterInput = z.object({
  kind: z.enum(["pc", "npc"]).optional(),
  name: cleanText(CAMPFIRE_LIMITS.characterName, "The name").optional(),
  sheet: z.unknown().optional(),
  srdMonster: z.string().refine(isSrdSlug).optional(),
  ownerId: z.uuid().nullable().optional(),
  portraitFileId: z.uuid().nullable().optional(),
  ddbUrl: ddbUrl.optional(),
});

const tooBig = (sheet: unknown) => sheet !== undefined && JSON.stringify(sheet).length > SHEET_MAX_BYTES;

contentRouter.post("/campaigns/:id/characters", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = characterInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const kind = d.kind ?? "pc";
  if (!t.gm && (kind !== "pc" || d.srdMonster || (d.ownerId && d.ownerId !== t.userId))) return bad(res, "Players can make their own characters only.", 403);
  if (tooBig(d.sheet)) return bad(res, "That sheet is too big.", 413, "too_large");
  let ownerId: string | null = kind === "npc" ? null : t.gm ? (d.ownerId ?? null) : t.userId;
  if (ownerId && ownerId !== t.userId && !(await inHome(t.campaign, [ownerId])).length) return bad(res, "They can't be at this table.");
  if (kind === "pc" && !ownerId) ownerId = t.userId;
  if (d.portraitFileId && !(await portraitFor(t, d.portraitFileId))) return bad(res, "Upload that portrait to this campaign first.");
  let sheet = normalizeSheet(d.sheet);
  let name = d.name;
  if (d.srdMonster) {
    const m = monsterBySlug(d.srdMonster, rulesOf(t.campaign.settings as { rules?: unknown }));
    if (!m) return bad(res, "That monster isn't in the compendium.");
    sheet = m.sheet;
    name ||= m.name;
  }
  if (!name) return bad(res, "Give them a name.");
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: campfireCampaigns.id }).from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(campfireCharacters).where(eq(campfireCharacters.campaignId, t.campaign.id));
    if (n >= CAMPFIRE_LIMITS.characters) return null;
    const [row] = await tx
      .insert(campfireCharacters)
      .values({ campaignId: t.campaign.id, ownerId, kind, name: name!, sheet, portraitFileId: d.portraitFileId ?? null, ddbUrl: d.ddbUrl ?? null, srdMonster: d.srdMonster ?? null })
      .returning();
    return row;
  });
  if (!row) return bad(res, `A campaign can have up to ${CAMPFIRE_LIMITS.characters} characters.`, 409);
  await emitCharacter(t.campaign, row.id);
  res.status(201).json(characterOut(row, t));
});

/** A character and its table; players only reach their own and other PCs. */
async function characterTable(res: Parameters<typeof tableOr>[0], id: unknown, opts: { write?: boolean; play?: boolean } = {}) {
  const cid = idParam.safeParse(id);
  const [row] = cid.success ? await db.select().from(campfireCharacters).where(eq(campfireCharacters.id, cid.data)) : [];
  if (!row) {
    notFound(res);
    return null;
  }
  const t = await tableOr(res, row.campaignId, opts);
  if (!t) return null;
  const view = characterOut(row, t);
  if (!view) {
    notFound(res);
    return null;
  }
  return { t, row, mine: t.gm || (row.ownerId !== null && row.ownerId === t.userId) };
}

contentRouter.get("/characters/:id", async (req, res) => {
  const found = await characterTable(res, req.params.id);
  if (found) res.json(characterOut(found.row, found.t));
});

contentRouter.patch("/characters/:id", changeLimiter, async (req, res) => {
  const found = await characterTable(res, req.params.id, { write: true });
  if (!found) return;
  const { t, row, mine } = found;
  if (!mine) return bad(res, "That character isn't yours.", 403);
  const parsed = characterInput.omit({ srdMonster: true }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!t.gm && (d.kind !== undefined || d.ownerId !== undefined)) return bad(res, "Only the game master can change that.", 403);
  if (tooBig(d.sheet)) return bad(res, "That sheet is too big.", 413, "too_large");
  if (d.portraitFileId && d.portraitFileId !== row.portraitFileId && !(await portraitFor(t, d.portraitFileId))) return bad(res, "Upload that portrait to this campaign first.");
  if (d.ownerId && !(await inHome(t.campaign, [d.ownerId])).length) return bad(res, "They can't be at this table.");
  const before = normalizeSheet(row.sheet);
  let sheet = d.sheet !== undefined ? normalizeSheet(d.sheet) : undefined;
  if (sheet && !t.gm) {
    // A locked sheet keeps its HP max and AC (and players never lock or unlock it).
    sheet.locked = before.locked;
    if (before.locked) {
      sheet.ac = before.ac;
      sheet.speed = before.speed;
      sheet.hp = { ...sheet.hp, max: before.hp.max, current: Math.min(sheet.hp.current, before.hp.max) };
    }
  }
  const kind = d.kind ?? row.kind;
  const [updated] = await db
    .update(campfireCharacters)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(sheet ? { sheet } : {}),
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.ownerId !== undefined || d.kind === "npc" ? { ownerId: kind === "npc" ? null : (d.ownerId ?? row.ownerId) } : {}),
      ...(d.portraitFileId !== undefined ? { portraitFileId: d.portraitFileId } : {}),
      ...(d.ddbUrl !== undefined ? { ddbUrl: d.ddbUrl } : {}),
      updatedAt: new Date(),
    })
    .where(eq(campfireCharacters.id, row.id))
    .returning();
  if (sheet) await syncTokensFromSheet(t.campaign, row.id, sheet);
  await emitCharacter(t.campaign, row.id);
  res.json(characterOut(updated, t));
});

contentRouter.delete("/characters/:id", changeLimiter, async (req, res) => {
  const found = await characterTable(res, req.params.id, { write: true });
  if (!found) return;
  if (!found.mine) return bad(res, "That character isn't yours.", 403);
  await db.delete(campfireCharacters).where(eq(campfireCharacters.id, found.row.id));
  await emitCharacter(found.t.campaign, found.row.id, { kind: found.row.kind, ownerId: found.row.ownerId });
  res.json({ ok: true });
});

contentRouter.post("/characters/:id/rest", changeLimiter, async (req, res) => {
  const found = await characterTable(res, req.params.id, { write: true, play: true });
  if (!found) return;
  if (!found.mine) return bad(res, "That character isn't yours.", 403);
  const kind = z.enum(["short", "long"]).safeParse(req.body?.kind);
  if (!kind.success) return bad(res, "Pick a short or a long rest.");
  const before = normalizeSheet(found.row.sheet);
  const sheet = kind.data === "short" ? shortRest(before) : longRest(before);
  const [updated] = await db.update(campfireCharacters).set({ sheet, updatedAt: new Date() }).where(eq(campfireCharacters.id, found.row.id)).returning();
  await syncTokensFromSheet(found.t.campaign, found.row.id, sheet);
  await emitCharacter(found.t.campaign, found.row.id);
  res.json(characterOut(updated, found.t));
});

// ───────────── Files ─────────────

/** Players may upload portraits and token pictures; everything else is the GM's. */
// The body is read only up to that kind's limit (bigger: 413 "That file is too big.").
const rawFor = Object.fromEntries(
  (["map", "token", "portrait", "handout", "audio"] as const).map((k) => [k, express.raw({ type: () => true, limit: maxBytesFor(k) + 1024 })]),
) as unknown as Record<"map" | "token" | "portrait" | "handout" | "audio", express.RequestHandler>;
const PLAYER_KINDS = ["portrait", "token"];

contentRouter.post(
  "/campaigns/:id/files",
  uploadLimiter,
  // Checked before the body is read, so nobody can make the server read 25 MB they can't send.
  async (req, res, next) => {
    const t = await tableOr(res, req.params.id, { write: true });
    if (!t) return;
    const kind = req.query.kind;
    if (!isFileKind(kind)) return bad(res, "Say what the file is for (map, token, portrait, handout or audio).");
    if (!t.gm && !PLAYER_KINDS.includes(kind)) return bad(res, "Only the game master can upload that.", 403);
    res.locals.campfireTable = t;
    res.locals.campfireKind = kind;
    next();
  },
  (req, res, next) => rawFor[res.locals.campfireKind as keyof typeof rawFor](req, res, next),
  async (req, res) => {
    const t = res.locals.campfireTable as Table;
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      const file = await saveUpload(t.campaign.id, t.userId, res.locals.campfireKind, data);
      res.status(201).json(fileOut(file));
    } catch (err) {
      if (err instanceof UploadProblem) return bad(res, err.message, err.status, err.error);
      throw err;
    }
  },
);

/** May a player have this file? (GMs may have any of the campaign's.) */
async function playerMayHave(t: Table, f: FileRow): Promise<boolean> {
  if (f.uploadedBy === t.userId) return true;
  // Round A: the campaign's banner, and pictures of journal entries players can see.
  if (t.campaign.bannerFileId === f.id) return true;
  if ((await db.select({ id: campfireJournal.id }).from(campfireJournal).where(and(eq(campfireJournal.campaignId, t.campaign.id), eq(campfireJournal.pictureFileId, f.id), eq(campfireJournal.hidden, false)))).length) return true;
  const active = t.campaign.activeSceneId;
  if (f.kind === "map") {
    return !!active && (await db.select({ id: campfireScenes.id }).from(campfireScenes).where(and(eq(campfireScenes.id, active), eq(campfireScenes.backgroundFileId, f.id)))).length > 0;
  }
  if (f.kind === "audio") return (await db.select({ id: campfireTracks.id }).from(campfireTracks).where(eq(campfireTracks.fileId, f.id))).length > 0 || (await isSoundFile(t.campaign.id, f.id));
  if (f.kind === "handout") {
    const rows = await db.select().from(campfireHandouts).where(and(eq(campfireHandouts.campaignId, t.campaign.id), eq(campfireHandouts.imageFileId, f.id)));
    return rows.some((h) => handoutVisible(h, t));
  }
  // Pictures: a PC's portrait, or a token they can see on the map right now.
  const portraits = await db
    .select({ kind: campfireCharacters.kind, ownerId: campfireCharacters.ownerId })
    .from(campfireCharacters)
    .where(and(eq(campfireCharacters.campaignId, t.campaign.id), eq(campfireCharacters.portraitFileId, f.id)));
  if (portraits.some((c) => c.kind === "pc" || c.ownerId === t.userId)) return true;
  if (!active) return false;
  const scene = await sceneRow(active);
  const tokens = await db.select().from(campfireTokens).where(and(eq(campfireTokens.sceneId, active), eq(campfireTokens.imageFileId, f.id)));
  if (!scene || !tokens.length) return false;
  const chars = await charactersInfo(t.campaign.id);
  return tokens.some((tk) => tokenVisible(tk, scene, t, chars));
}

const fileLimiter = limiter("campfire:files", 600, 60 * 1000, "That's a lot of files. Wait a moment.");
contentRouter.get("/files/:id", fileLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [f] = id.success ? await db.select().from(campfireFiles).where(eq(campfireFiles.id, id.data)) : [];
  if (!f) return res.status(404).end();
  const t = await tableOr(res, f.campaignId);
  if (!t) return;
  if (!t.gm && !(await playerMayHave(t, f))) return res.status(404).end();
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("Accept-Ranges", "bytes");
  // Music is played as it loads, so it answers byte ranges.
  const range = typeof req.headers.range === "string" ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, f.bytes - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : f.bytes - 1;
    end = Math.min(end, f.bytes - 1);
    if (start > end || start >= f.bytes) {
      res.setHeader("Content-Range", `bytes */${f.bytes}`);
      return res.status(416).end();
    }
    start = Math.max(0, start);
    const stream = await storage.getRange(f.storageKey, start, end);
    if (!stream) return res.status(404).end();
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${f.bytes}`);
    res.setHeader("Content-Length", String(end - start + 1));
    return sendStream(stream, res);
  }
  const file = await storage.get(f.storageKey);
  if (!file) return res.status(404).end();
  res.setHeader("Content-Length", String(file.size));
  sendStream(file.stream, res);
});

contentRouter.delete("/files/:id", changeLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [f] = id.success ? await db.select().from(campfireFiles).where(eq(campfireFiles.id, id.data)) : [];
  if (!f) return notFound(res);
  const t = await tableOr(res, f.campaignId, { write: true });
  if (!t) return;
  if (!t.gm && f.uploadedBy !== t.userId) return bad(res, "Only the game master can delete that.", 403);
  // Scenes, tokens, sheets and handouts using it let go of it (the database sets them to none).
  await db.delete(campfireFiles).where(eq(campfireFiles.id, f.id));
  await removeStored([f.storageKey]);
  await broadcast(t.campaign, "campfire:state", () => ({ reason: "file" }));
  res.json({ ok: true });
});

// ───────────── Handouts ─────────────

const handoutInput = z.object({
  title: cleanText(CAMPFIRE_LIMITS.handoutTitle, "The title").optional(),
  body: z
    .string()
    .max(CAMPFIRE_LIMITS.handoutBody, `Handouts can be up to ${CAMPFIRE_LIMITS.handoutBody.toLocaleString()} characters.`)
    .transform((s) => s.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""))
    .optional(),
  imageFileId: z.uuid().nullable().optional(),
  shared: z.enum(["all", "gm", "some"]).optional(),
  sharedWith: uuidList(50).optional(),
});

/** A handout changed: people who see it get it, people who just lost it hear it's gone. */
async function emitHandout(t: Table, before: HandoutRow | null, after: HandoutRow | null): Promise<void> {
  await broadcast(t.campaign, "campfire:handout", (v) => {
    const sees = !!after && handoutVisible(after, v);
    if (sees) return { op: "upsert", handout: handoutSummary(after!) };
    if (before && handoutVisible(before, v)) return { op: "delete", handoutId: before.id };
    return null;
  });
}

contentRouter.get("/campaigns/:id/handouts", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  const rows = await db.select().from(campfireHandouts).where(eq(campfireHandouts.campaignId, t.campaign.id)).orderBy(asc(campfireHandouts.createdAt));
  res.json({ handouts: rows.filter((h) => handoutVisible(h, t)).map(handoutSummary) });
});

contentRouter.post("/campaigns/:id/handouts", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = handoutInput.extend({ title: cleanText(CAMPFIRE_LIMITS.handoutTitle, "The title") }).safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.imageFileId && !(await fileIn(t.campaign.id, d.imageFileId, ["handout", "map", "token", "portrait"]))) return bad(res, "Upload that picture to this campaign first.");
  const sharedWith = d.shared === "some" ? await inHome(t.campaign, d.sharedWith ?? []) : [];
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: campfireCampaigns.id }).from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(campfireHandouts).where(eq(campfireHandouts.campaignId, t.campaign.id));
    if (n >= CAMPFIRE_LIMITS.handouts) return null;
    const [row] = await tx
      .insert(campfireHandouts)
      .values({ campaignId: t.campaign.id, title: d.title, body: d.body ?? "", imageFileId: d.imageFileId ?? null, shared: d.shared ?? "gm", sharedWith, createdBy: t.userId })
      .returning();
    return row;
  });
  if (!row) return bad(res, `A campaign can have up to ${CAMPFIRE_LIMITS.handouts} handouts.`, 409);
  await emitHandout(t, null, row);
  res.status(201).json(handoutOut(row, t));
});

async function handoutTable(res: Parameters<typeof tableOr>[0], campaignId: unknown, handoutId: unknown, opts: { gm?: boolean } = {}) {
  const t = await tableOr(res, campaignId, opts);
  if (!t) return null;
  const id = idParam.safeParse(handoutId);
  const [row] = id.success ? await db.select().from(campfireHandouts).where(and(eq(campfireHandouts.id, id.data), eq(campfireHandouts.campaignId, t.campaign.id))) : [];
  if (!row || !handoutVisible(row, t)) {
    notFound(res, "That handout isn't available.");
    return null;
  }
  return { t, row };
}

contentRouter.get("/campaigns/:id/handouts/:handoutId", async (req, res) => {
  const found = await handoutTable(res, req.params.id, req.params.handoutId);
  if (found) res.json(handoutOut(found.row, found.t));
});

contentRouter.patch("/campaigns/:id/handouts/:handoutId", changeLimiter, async (req, res) => {
  const found = await handoutTable(res, req.params.id, req.params.handoutId, { gm: true });
  if (!found) return;
  const { t, row } = found;
  const parsed = handoutInput.strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.imageFileId && !(await fileIn(t.campaign.id, d.imageFileId, ["handout", "map", "token", "portrait"]))) return bad(res, "Upload that picture to this campaign first.");
  const shared = d.shared ?? row.shared;
  const sharedWith = shared === "some" ? (d.sharedWith ? await inHome(t.campaign, d.sharedWith) : row.sharedWith) : [];
  const [updated] = await db
    .update(campfireHandouts)
    .set({
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.imageFileId !== undefined ? { imageFileId: d.imageFileId } : {}),
      shared,
      sharedWith,
      updatedAt: new Date(),
    })
    .where(eq(campfireHandouts.id, row.id))
    .returning();
  await emitHandout(t, row, updated);
  res.json(handoutOut(updated, t));
});

contentRouter.delete("/campaigns/:id/handouts/:handoutId", changeLimiter, async (req, res) => {
  const found = await handoutTable(res, req.params.id, req.params.handoutId, { gm: true });
  if (!found) return;
  await db.delete(campfireHandouts).where(eq(campfireHandouts.id, found.row.id));
  await emitHandout(found.t, found.row, null);
  res.json({ ok: true });
});

// ───────────── Jukebox ─────────────

async function tellMusic(t: Table, music: MusicState | null, withTracks = false): Promise<void> {
  const tracks = withTracks
    ? (await db.select().from(campfireTracks).where(eq(campfireTracks.campaignId, t.campaign.id)).orderBy(asc(campfireTracks.createdAt))).map(trackOut)
    : undefined;
  await broadcast(t.campaign, "campfire:music", () => ({ music, ...(tracks ? { tracks } : {}), serverNow: Date.now() }));
}

contentRouter.post("/campaigns/:id/tracks", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ fileId: z.uuid(), title: cleanText(CAMPFIRE_LIMITS.trackTitle, "The title").optional() }).safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const file = await fileIn(t.campaign.id, parsed.data.fileId, ["audio"]);
  if (!file) return bad(res, "Upload that music to this campaign first.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireTracks).where(eq(campfireTracks.campaignId, t.campaign.id));
  if (n >= CAMPFIRE_LIMITS.tracks) return bad(res, `A campaign can have up to ${CAMPFIRE_LIMITS.tracks} tracks.`, 409);
  const [row] = await db
    .insert(campfireTracks)
    .values({ campaignId: t.campaign.id, fileId: file.id, title: parsed.data.title ?? "Untitled track", durationSec: file.durationSec })
    .returning();
  await tellMusic(t, t.campaign.music, true);
  res.status(201).json(trackOut(row));
});

contentRouter.delete("/tracks/:id", changeLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [track] = id.success ? await db.select().from(campfireTracks).where(eq(campfireTracks.id, id.data)) : [];
  if (!track) return notFound(res);
  const t = await tableOr(res, track.campaignId, { gm: true });
  if (!t) return;
  await db.delete(campfireTracks).where(eq(campfireTracks.id, track.id));
  let music = t.campaign.music;
  if (music?.trackId === track.id) {
    music = null;
    await db.update(campfireCampaigns).set({ music: null }).where(eq(campfireCampaigns.id, t.campaign.id));
  }
  await tellMusic(t, music, true);
  res.json({ ok: true });
});

contentRouter.post("/campaigns/:id/music", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z
    .object({
      op: z.enum(["play", "pause", "seek", "stop"]),
      trackId: z.uuid().optional(),
      position: z.number().finite().min(0).max(24 * 3600).optional(),
      loop: z.boolean().optional(),
      volume: z.number().finite().min(0).max(1).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  const now = Date.now();
  const cur = t.campaign.music;
  // Where the track is right now (the state says where it was when it started playing).
  const at = (m: MusicState) => (m.playing ? m.position + (now - m.startedAt) / 1000 : m.position);
  let music: MusicState | null = cur;
  if (d.op === "stop") music = null;
  else if (d.op === "play") {
    const trackId = d.trackId ?? cur?.trackId;
    if (!trackId) return bad(res, "Pick a track to play.");
    const [track] = await db.select({ id: campfireTracks.id }).from(campfireTracks).where(and(eq(campfireTracks.id, trackId), eq(campfireTracks.campaignId, t.campaign.id)));
    if (!track) return notFound(res, "That track isn't in this campaign.");
    const same = cur?.trackId === trackId;
    music = { trackId, playing: true, startedAt: now, position: d.position ?? (same && cur ? at(cur) : 0), loop: d.loop ?? cur?.loop ?? true, volume: d.volume ?? cur?.volume ?? 0.8 };
  } else {
    if (!cur) return bad(res, "Nothing is playing.", 409);
    if (d.op === "pause") music = { ...cur, playing: false, position: at(cur), startedAt: now };
    else music = { ...cur, position: d.position ?? at(cur), startedAt: now, ...(d.loop !== undefined ? { loop: d.loop } : {}), ...(d.volume !== undefined ? { volume: d.volume } : {}) };
  }
  await db.update(campfireCampaigns).set({ music, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id));
  await tellMusic(t, music);
  res.json({ music, serverNow: now });
});

// ───────────── Compendium (SRD 5.1 = 2014 rules, SRD 5.2 = 2024 rules: `?rules=2024`) ─────────────

/** `?rules=2024` picks SRD 5.2; anything else (older apps send nothing) is SRD 5.1. */
const rulesParam = (req: { query: Record<string, unknown> }): RulesSet => (isRulesSet(req.query.rules) ? req.query.rules : "2014");

contentRouter.get("/srd/monsters", srdLimiter, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
  res.json({ monsters: searchMonsters(q, 50, rulesParam(req)) });
});

contentRouter.get("/srd/monsters/:slug", srdLimiter, (req, res) => {
  const m = isSrdSlug(req.params.slug) ? monsterBySlug(req.params.slug, rulesParam(req)) : null;
  if (!m) return notFound(res, "That monster isn't in the compendium.");
  res.json(m);
});

contentRouter.get("/srd/spells", srdLimiter, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
  const level = typeof req.query.level === "string" && /^[0-9]$/.test(req.query.level) ? Number(req.query.level) : null;
  const cls = typeof req.query.class === "string" && /^[a-z ]{1,20}$/i.test(req.query.class) ? req.query.class : null;
  res.json({ spells: searchSpells(q, level, cls, 100, rulesParam(req)) });
});

contentRouter.get("/srd/spells/:slug", srdLimiter, (req, res) => {
  const s = isSrdSlug(req.params.slug) ? spellBySlug(req.params.slug, rulesParam(req)) : null;
  if (!s) return notFound(res, "That spell isn't in the compendium.");
  res.json(s);
});

// The character builder's data (species, classes, backgrounds, feats), cached by the apps.
contentRouter.get("/srd/builder", srdLimiter, (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json(builderData(rulesParam(req)));
});

// 0.11.4: every item that isn't magic (starting gear and its shop), cached by the builders.
contentRouter.get("/srd/items/mundane", srdLimiter, (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json({ items: searchItems(rulesParam(req), "", null, 10_000).filter((i) => i.kind !== "magic"), credit: creditFor(rulesParam(req)) });
});

contentRouter.get("/srd/items", srdLimiter, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
  const kind = typeof req.query.kind === "string" && /^(armor|shield|weapon|gear|magic|ammo)$/.test(req.query.kind) ? req.query.kind : null;
  res.json({ items: searchItems(rulesParam(req), q, kind), credit: creditFor(rulesParam(req)) });
});

