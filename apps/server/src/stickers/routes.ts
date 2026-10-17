import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Sticker } from "@glofly/shared";
import { requireAuth } from "../auth/sessions";
import { db } from "../db";
import { stickers } from "../db/schema";
import { storage } from "../storage";
import { PHOTO_UPLOAD_MAX } from "../profile/photo";
import { access, canPost, messageIn, postSpecial } from "../messages/routes";
import { CutoutError, makeSticker } from "./cutout";

// Custom stickers (0.5.0): turn a photo into a sticker (background removed on the server), keep
// it in your sticker tray, and send it to any chat. Your tray is only yours.
//
//   GET    /stickers                 your stickers, newest first
//   POST   /stickers                 a photo (the body) → a new sticker
//   GET    /stickers/:id/image       its picture (yours only)
//   DELETE /stickers/:id
//   POST   /stickers/:id/send        { conversationId, replyToId? }

export const stickersRouter = Router();
stickersRouter.use(requireAuth);

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const STICKERS_MAX = 60;
const imageKey = (ownerId: string, id: string) => `stickers/${ownerId}/${id}.webp`;

const makeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of stickers for one hour. Try again later." },
});
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

const shown = (s: { id: string; width: number; height: number; createdAt: Date }): Sticker => ({
  id: s.id,
  width: s.width,
  height: s.height,
  createdAt: s.createdAt.toISOString(),
});

stickersRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(stickers).where(eq(stickers.ownerId, me(res).id)).orderBy(desc(stickers.createdAt));
  res.json({ stickers: rows.map(shown) });
});

stickersRouter.post("/", makeLimiter, express.raw({ type: () => true, limit: PHOTO_UPLOAD_MAX }), async (req, res) => {
  const myId = me(res).id;
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: "invalid", message: "Pick a photo." });
    return;
  }
  const [{ n }] = await db.select({ n: count() }).from(stickers).where(eq(stickers.ownerId, myId));
  if (n >= STICKERS_MAX) {
    res.status(409).json({ error: "too_many", message: `You can keep up to ${STICKERS_MAX} stickers. Delete one to make another.` });
    return;
  }
  let made;
  try {
    made = await makeSticker(req.body);
  } catch (err) {
    if (err instanceof CutoutError) {
      res.status(err.busy ? 503 : 422).json({ error: err.busy ? "busy" : "no_cutout", message: err.message });
      return;
    }
    throw err;
  }
  const [row] = await db.insert(stickers).values({ ownerId: myId, width: made.width, height: made.height }).returning();
  await storage.put(imageKey(myId, row.id), made.data, "image/webp");
  res.status(201).json({ sticker: shown(row) });
});

async function mySticker(res: Response, raw: unknown) {
  const id = idParam.safeParse(raw);
  const [row] = id.success ? await db.select().from(stickers).where(and(eq(stickers.id, id.data), eq(stickers.ownerId, me(res).id))) : [];
  if (!row) res.status(404).json({ error: "not_found" });
  return row ?? null;
}

stickersRouter.get("/:id/image", async (req, res) => {
  const row = await mySticker(res, req.params.id);
  if (!row) return;
  const file = await storage.get(imageKey(row.ownerId, row.id));
  if (!file) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  file.stream.pipe(res);
});

stickersRouter.delete("/:id", async (req, res) => {
  const row = await mySticker(res, req.params.id);
  if (!row) return;
  await db.delete(stickers).where(eq(stickers.id, row.id));
  await storage.remove(imageKey(row.ownerId, row.id)).catch(() => undefined);
  res.status(204).end();
});

stickersRouter.post("/:id/send", sendLimiter, async (req, res) => {
  const row = await mySticker(res, req.params.id);
  if (!row) return;
  const myId = me(res).id;
  const parsed = z.object({ conversationId: z.uuid(), replyToId: z.uuid().optional().nullable() }).safeParse(req.body);
  const chat = parsed.success ? await access(parsed.data.conversationId, myId) : null;
  if (!parsed.success || !chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!(await canPost(chat, myId))) {
    res.status(403).json({ error: "forbidden", message: "You can only send messages to friends." });
    return;
  }
  const reply = parsed.data.replyToId ? await messageIn(parsed.data.conversationId, parsed.data.replyToId) : null;
  const file = await storage.get(imageKey(row.ownerId, row.id));
  if (!file) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of file.stream) chunks.push(c as Buffer);
  const message = await postSpecial(
    chat,
    parsed.data.conversationId,
    myId,
    { body: "", sticker: { image: Buffer.concat(chunks), width: row.width, height: row.height }, replyToId: reply && !reply.deletedAt && !reply.event ? reply.id : null },
    res.locals.sessionId,
  );
  res.status(201).json({ message });
});
