import express, { Router, type NextFunction, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  CONSTELLATION_EMOJI_MAX,
  CONSTELLATION_STICKERS_MAX,
  EMOJI_PER_MESSAGE,
  EMOJI_SIZE,
  EMOJI_UPLOAD_MAX,
  STICKER_NAME_MAX,
  STICKER_SIZE,
  STICKER_UPLOAD_MAX,
  cleanEmojiName,
  emojiNamesIn,
  type ConstellationEmoji,
  type EmojiInfo,
  type EmojiKind,
  type EmojiRef,
  type EmojiSet,
} from "@glofly/shared";
import { db } from "../db";
import { constellationEmoji, constellationMembers, constellations, nebulas } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { sendStream, storage } from "../storage";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { logModeration, memberIdsOf } from "../constellations/activity";
import { publicUsers } from "../constellations/views";
import { emitToUser } from "../realtime";
import { CutoutError, makeSticker } from "../stickers/cutout";
import { access, canPost, cantPostMessage, messageIn, postSpecial } from "../messages/routes";

// Communities round 2 (Nov 11, 2026): custom emoji + stickers per constellation, free (approved
// boards 2a–2c). A message keeps `:name:` in its text (what older apps show) plus `emojis`, the
// pictures those names mean. Anyone signed in can load a picture by its id (it's in a message they
// can see); only members may use them, and outside the constellation only when "outside" is on.
//
//   GET    /emoji/mine                                  the picker: my constellations' emoji + stickers
//   GET    /emoji/:id/image                             the picture (WebP)
//   GET    /emoji/:id/info                              "From Night Raiders" (name hidden if private)
//   POST   /emoji/:id/send { conversationId, replyToId? }   send a constellation sticker
//   GET    /constellations/:id/emoji                    the list (members)
//   POST   /constellations/:id/emoji?kind=&name=&outside=&cutout=   the picture is the body (Manage emoji)
//   PATCH  /constellations/:id/emoji/:eid { name?, outside? } · DELETE

export const emojiRouter = Router();
emojiRouter.use(["/emoji", "/constellations/:id/emoji"], requireAuth);
emojiRouter.use(["/emoji", "/constellations/:id/emoji"], async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "too_many" : "invalid", message });
const limiter = (name: string, limit: number, windowMs: number, message: string) =>
  rateLimit(name, { windowMs, limit, keyGenerator: (_req, res) => me(res).id, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "too_many_requests", message } });
const uploadLimiter = limiter("emoji:upload", 60, 60 * 60 * 1000, "That's a lot of new emoji for one hour. Try again later.");
const sendLimiter = limiter("emoji:send", 30, 60 * 1000, "Slow down a little and try again.");
const imageLimiter = limiter("emoji:image", 3000, 60 * 1000, "Too many pictures at once. Try again in a moment.");

export const emojiKey = (constellationId: string, id: string) => `emoji/${constellationId}/${id}.webp`;
type Row = typeof constellationEmoji.$inferSelect;

function shown(r: Row, people: Map<string, import("@glofly/shared").PublicUser>): ConstellationEmoji {
  return {
    id: r.id,
    kind: r.kind as EmojiKind,
    name: r.name,
    animated: r.animated,
    width: r.width,
    height: r.height,
    outside: r.outside,
    createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// ───────────── Cleaning pictures ─────────────

export class PictureError extends Error {}

/**
 * Re-saves a picture as WebP (metadata gone, size limited), keeping animation. Emoji: 128 px;
 * stickers: 320 px. Still stickers can have their background removed (the 0.5.0 sticker maker).
 */
export async function cleanPicture(input: Buffer, kind: EmojiKind, cutout: boolean): Promise<{ data: Buffer; width: number; height: number; animated: boolean }> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: 20_000_000 }).metadata();
  } catch {
    throw new PictureError("That file isn't a picture Glofly can use. Try a PNG, JPG, GIF or WebP.");
  }
  if (!meta.format || !["png", "jpeg", "gif", "webp"].includes(meta.format)) throw new PictureError("Use a PNG, JPG, GIF or WebP.");
  const pages = meta.pages ?? 1;
  if (pages > 200) throw new PictureError("That animation has too many frames (up to 200).");
  const animated = pages > 1;
  const size = kind === "emoji" ? EMOJI_SIZE : STICKER_SIZE;
  if (kind === "sticker" && cutout && !animated) {
    try {
      const made = await makeSticker(input);
      const out = await sharp(made.data).resize(size, size, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
      return { data: out.data, width: out.info.width, height: out.info.height, animated: false };
    } catch (err) {
      if (err instanceof CutoutError) throw new PictureError(err.message);
      throw err;
    }
  }
  try {
    const out = await sharp(input, { animated, limitInputPixels: 20_000_000 })
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: animated ? 80 : 88, effort: 4, ...(animated ? { loop: 0 } : {}) })
      .toBuffer({ resolveWithObject: true });
    // An animated WebP reports the whole strip's height: one frame's is pageHeight.
    const height = animated ? (out.info.pageHeight ?? Math.round(out.info.height / pages)) : out.info.height;
    if (out.data.length > 1024 * 1024) throw new PictureError("That picture is still too big after shrinking it. Try a shorter animation.");
    return { data: out.data, width: out.info.width, height, animated };
  } catch (err) {
    if (err instanceof PictureError) throw err;
    throw new PictureError("That picture couldn't be read. Try another one.");
  }
}

// ───────────── Using them ─────────────

/** The constellation a chat belongs to (null for DMs and groups). */
async function constellationOfChat(conversationId: string): Promise<string | null> {
  const [n] = await db.select({ cid: nebulas.constellationId }).from(nebulas).where(eq(nebulas.conversationId, conversationId));
  return n?.cid ?? null;
}

/** Of these emoji/stickers, the ones I may use in this chat. */
export async function usableIn(userId: string, conversationId: string, ids: string[], kind: EmojiKind = "emoji"): Promise<Row[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ e: constellationEmoji })
    .from(constellationEmoji)
    .innerJoin(constellationMembers, and(eq(constellationMembers.constellationId, constellationEmoji.constellationId), eq(constellationMembers.userId, userId)))
    .innerJoin(constellations, eq(constellations.id, constellationEmoji.constellationId))
    .where(and(inArray(constellationEmoji.id, [...new Set(ids)].slice(0, EMOJI_PER_MESSAGE)), eq(constellationEmoji.kind, kind), isNull(constellations.takenDownAt)));
  const here = await constellationOfChat(conversationId);
  return rows.map((r) => r.e).filter((e) => e.outside || e.constellationId === here);
}

/**
 * The emoji a new message's text uses (`:name:`), from the ids the app picked. Unknown ids, ones I
 * can't use here and names that aren't in the text are dropped. Null when there are none.
 */
export async function emojisForMessage(userId: string, conversationId: string, text: string, raw: unknown): Promise<EmojiRef[] | null> {
  const ids = z.array(z.uuid()).max(EMOJI_PER_MESSAGE).safeParse(raw);
  if (!ids.success || !ids.data.length) return null;
  const names = new Set(emojiNamesIn(text));
  if (!names.size) return null;
  const rows = await usableIn(userId, conversationId, ids.data);
  const out: EmojiRef[] = [];
  for (const r of rows) if (names.has(r.name) && !out.some((o) => o.name === r.name)) out.push({ id: r.id, name: r.name, animated: r.animated });
  return out.length ? out : null;
}

/** One custom emoji for a reaction (":name:"), if I may use it in this chat. */
export async function reactionEmoji(userId: string, conversationId: string, id: string): Promise<EmojiRef | null> {
  const [r] = await usableIn(userId, conversationId, [id]);
  return r ? { id: r.id, name: r.name, animated: r.animated } : null;
}

emojiRouter.get("/emoji/mine", async (_req, res) => {
  const myId = me(res).id;
  const rows = await db
    .select({ e: constellationEmoji, c: { id: constellations.id, name: constellations.name, color: constellations.color, iconVersion: constellations.iconVersion } })
    .from(constellationEmoji)
    .innerJoin(constellationMembers, and(eq(constellationMembers.constellationId, constellationEmoji.constellationId), eq(constellationMembers.userId, myId)))
    .innerJoin(constellations, eq(constellations.id, constellationEmoji.constellationId))
    .where(isNull(constellations.takenDownAt))
    .orderBy(constellations.name, constellationEmoji.createdAt)
    .limit(5000);
  const sets = new Map<string, EmojiSet>();
  const none = new Map();
  for (const { e, c } of rows) {
    const set = sets.get(c.id) ?? { constellation: c, emoji: [], stickers: [] };
    (e.kind === "sticker" ? set.stickers : set.emoji).push(shown(e, none));
    sets.set(c.id, set);
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ sets: [...sets.values()] });
});

async function emojiRow(res: Response, raw: unknown): Promise<Row | null> {
  const id = idParam.safeParse(raw);
  const [row] = id.success ? await db.select().from(constellationEmoji).where(eq(constellationEmoji.id, id.data)) : [];
  if (!row) bad(res, "That emoji isn't there any more.", 404);
  return row ?? null;
}

emojiRouter.get("/emoji/:id/image", imageLimiter, async (req, res) => {
  const row = await emojiRow(res, req.params.id);
  if (!row) return;
  const [c] = await db.select({ takenDownAt: constellations.takenDownAt }).from(constellations).where(eq(constellations.id, row.constellationId));
  const file = c && !c.takenDownAt ? await storage.get(emojiKey(row.constellationId, row.id)) : null;
  if (!file) {
    bad(res, "That emoji isn't there any more.", 404);
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  // A picture never changes (a new upload is a new id); deleted ones answer 404.
  res.setHeader("Cache-Control", "private, max-age=86400");
  sendStream(file.stream, res);
});

emojiRouter.get("/emoji/:id/info", async (req, res) => {
  const row = await emojiRow(res, req.params.id);
  if (!row) return;
  const [c] = await db
    .select({ id: constellations.id, name: constellations.name, color: constellations.color, iconVersion: constellations.iconVersion, visibility: constellations.visibility, takenDownAt: constellations.takenDownAt })
    .from(constellations)
    .where(eq(constellations.id, row.constellationId));
  const member = !!(await standingOf(row.constellationId, me(res).id));
  const open = !!c && !c.takenDownAt && (member || c.visibility !== "invite");
  const info: EmojiInfo = {
    id: row.id,
    name: row.name,
    kind: row.kind as EmojiKind,
    animated: row.animated,
    constellation: open && c ? { id: c.id, name: c.name, color: c.color, iconVersion: c.iconVersion, public: c.visibility !== "invite" } : null,
    member,
  };
  res.json(info);
});

emojiRouter.post("/emoji/:id/send", sendLimiter, async (req, res) => {
  const row = await emojiRow(res, req.params.id);
  if (!row) return;
  const myId = me(res).id;
  const parsed = z.object({ conversationId: z.uuid(), replyToId: z.uuid().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) {
    bad(res, "That chat isn't available.", 404);
    return;
  }
  const chat = await access(parsed.data.conversationId, myId);
  if (!chat || row.kind !== "sticker") {
    bad(res, "That chat isn't available.", 404);
    return;
  }
  if (!(await canPost(chat, myId))) {
    bad(res, await cantPostMessage(chat, myId), 403);
    return;
  }
  if (!(await usableIn(myId, chat.conversationId, [row.id], "sticker")).length) {
    bad(res, "You can use this sticker only inside its constellation.", 403);
    return;
  }
  const file = await storage.get(emojiKey(row.constellationId, row.id));
  if (!file) {
    bad(res, "That sticker isn't there any more.", 404);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of file.stream) chunks.push(c as Buffer);
  const reply = parsed.data.replyToId ? await messageIn(parsed.data.conversationId, parsed.data.replyToId) : null;
  const message = await postSpecial(
    chat,
    parsed.data.conversationId,
    myId,
    { body: "", sticker: { image: Buffer.concat(chunks), width: row.width, height: row.height }, replyToId: reply && !reply.deletedAt && !reply.event ? reply.id : null },
    res.locals.sessionId,
  );
  res.status(201).json({ message });
});

// ───────────── Managing them (board 2a) ─────────────

async function standingFor(req: Request, res: Response, manage = false): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't available.", 404);
    return null;
  }
  if (manage && !can(s, "manageEmoji")) {
    bad(res, "Your role doesn't allow that here.", 403);
    return null;
  }
  if (manage && (await frozen(s.constellationId))) {
    bad(res, FROZEN_MESSAGE, 403);
    return null;
  }
  return s;
}

async function listFor(constellationId: string) {
  const rows = await db.select().from(constellationEmoji).where(eq(constellationEmoji.constellationId, constellationId)).orderBy(desc(constellationEmoji.createdAt));
  const people = await publicUsers(rows.map((r) => r.createdBy).filter((x): x is string => !!x));
  return {
    emoji: rows.filter((r) => r.kind === "emoji").map((r) => shown(r, people)),
    stickers: rows.filter((r) => r.kind === "sticker").map((r) => shown(r, people)),
    limits: { emoji: CONSTELLATION_EMOJI_MAX, stickers: CONSTELLATION_STICKERS_MAX },
  };
}

/** Members' pickers refresh (one live nudge to everyone in it). */
async function tellPickers(constellationId: string): Promise<void> {
  for (const id of await memberIdsOf(constellationId)) emitToUser(id, "emoji:changed", { constellationId }, true);
}

emojiRouter.get("/constellations/:id/emoji", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  res.json({ ...(await listFor(s.constellationId)), canManage: can(s, "manageEmoji") });
});

const stickerName = z
  .string()
  .transform((t) => t.normalize("NFKC").trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Give it a name.").max(STICKER_NAME_MAX, `Up to ${STICKER_NAME_MAX} characters.`).refine((t) => !/[\u0000-\u001f\u007f-\u009f]/.test(t), "No hidden characters."));

emojiRouter.post("/constellations/:id/emoji", uploadLimiter, express.raw({ type: () => true, limit: STICKER_UPLOAD_MAX }), async (req, res) => {
  const s = await standingFor(req, res, true);
  if (!s) return;
  const kind: EmojiKind = req.query.kind === "sticker" ? "sticker" : "emoji";
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    bad(res, "Pick a picture.");
    return;
  }
  if (kind === "emoji" && req.body.length > EMOJI_UPLOAD_MAX) {
    bad(res, "Emoji can be up to 512 KB.");
    return;
  }
  let name: string;
  if (kind === "emoji") {
    const n = cleanEmojiName(String(req.query.name ?? ""));
    if (!n) {
      bad(res, "Emoji names are 2–32 letters, numbers or _.");
      return;
    }
    name = n;
  } else {
    const n = stickerName.safeParse(String(req.query.name ?? ""));
    if (!n.success) {
      bad(res, n.error.issues[0]?.message ?? "Give it a name.");
      return;
    }
    name = n.data;
  }
  const max = kind === "emoji" ? CONSTELLATION_EMOJI_MAX : CONSTELLATION_STICKERS_MAX;
  const [{ n }] = await db.select({ n: count() }).from(constellationEmoji).where(and(eq(constellationEmoji.constellationId, s.constellationId), eq(constellationEmoji.kind, kind)));
  if (n >= max) {
    bad(res, `This constellation has ${max} ${kind === "emoji" ? "emoji" : "stickers"} already. Remove one to add another.`, 409);
    return;
  }
  if (kind === "emoji") {
    const [taken] = await db
      .select({ id: constellationEmoji.id })
      .from(constellationEmoji)
      .where(and(eq(constellationEmoji.constellationId, s.constellationId), eq(constellationEmoji.kind, "emoji"), sql`lower(${constellationEmoji.name}) = ${name.toLowerCase()}`));
    if (taken) {
      bad(res, `There's already a :${name}: here. Pick another name.`, 409);
      return;
    }
  }
  let pic;
  try {
    pic = await cleanPicture(req.body, kind, req.query.cutout === "1");
  } catch (err) {
    if (err instanceof PictureError) {
      bad(res, err.message, 422);
      return;
    }
    throw err;
  }
  const outside = req.query.outside !== "0";
  let row: Row;
  try {
    [row] = await db
      .insert(constellationEmoji)
      .values({ constellationId: s.constellationId, kind, name, animated: pic.animated, width: pic.width, height: pic.height, outside, createdBy: s.userId })
      .returning();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      bad(res, `There's already a :${name}: here. Pick another name.`, 409);
      return;
    }
    throw err;
  }
  await storage.put(emojiKey(s.constellationId, row.id), pic.data, "image/webp");
  await logModeration(s.constellationId, s.userId, "emoji_added", null, { name, kind });
  await tellPickers(s.constellationId);
  res.status(201).json(await listFor(s.constellationId));
});

emojiRouter.patch("/constellations/:id/emoji/:eid", uploadLimiter, async (req, res) => {
  const s = await standingFor(req, res, true);
  if (!s) return;
  const row = await emojiRow(res, req.params.eid);
  if (!row) return;
  if (row.constellationId !== s.constellationId) {
    bad(res, "That emoji isn't there any more.", 404);
    return;
  }
  const changes: Partial<Row> = {};
  if (typeof req.body?.outside === "boolean") changes.outside = req.body.outside;
  if (typeof req.body?.name === "string") {
    if (row.kind === "emoji") {
      const n = cleanEmojiName(req.body.name);
      if (!n) {
        bad(res, "Emoji names are 2–32 letters, numbers or _.");
        return;
      }
      changes.name = n;
    } else {
      const n = stickerName.safeParse(req.body.name);
      if (!n.success) {
        bad(res, n.error.issues[0]?.message ?? "Give it a name.");
        return;
      }
      changes.name = n.data;
    }
  }
  try {
    if (Object.keys(changes).length) await db.update(constellationEmoji).set(changes).where(eq(constellationEmoji.id, row.id));
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      bad(res, `There's already a :${changes.name}: here. Pick another name.`, 409);
      return;
    }
    throw err;
  }
  await tellPickers(s.constellationId);
  res.json(await listFor(s.constellationId));
});

emojiRouter.delete("/constellations/:id/emoji/:eid", uploadLimiter, async (req, res) => {
  const s = await standingFor(req, res, true);
  if (!s) return;
  const row = await emojiRow(res, req.params.eid);
  if (!row) return;
  if (row.constellationId !== s.constellationId) {
    bad(res, "That emoji isn't there any more.", 404);
    return;
  }
  await db.delete(constellationEmoji).where(eq(constellationEmoji.id, row.id));
  await storage.remove(emojiKey(row.constellationId, row.id)).catch(() => undefined);
  await logModeration(s.constellationId, s.userId, "emoji_removed", null, { name: row.name, kind: row.kind });
  await tellPickers(s.constellationId);
  res.json(await listFor(s.constellationId));
});

/** A constellation deleted for good: its pictures go too (rows go with the cascade). */
export async function removeConstellationEmoji(constellationId: string): Promise<void> {
  const rows = await db.select({ id: constellationEmoji.id }).from(constellationEmoji).where(eq(constellationEmoji.constellationId, constellationId));
  for (const r of rows) await storage.remove(emojiKey(constellationId, r.id)).catch(() => undefined);
}
