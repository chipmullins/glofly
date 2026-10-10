import { randomUUID } from "node:crypto";
import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { squarePhoto } from "./photo";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { conversationMembers, friendships, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUser } from "../realtime";
import { presenceOf } from "../presence";
import { storage } from "../storage";
import { areFriends, blockedEitherWay, deletionPending, pairIs } from "../friends/rules";
import { DISPLAY_NAME_MAX } from "../auth/validation";

export const profileRouter = Router();
export const avatarsRouter = Router();
profileRouter.use(requireAuth);
avatarsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

const BIO_MAX = 190;
const AVATAR_UPLOAD_MAX = "8mb";

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of photo changes. Try again later." },
});

const avatarKey = (userId: string, version: string) => `avatars/${userId}/${version}.webp`;

// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

/** Everyone who shows this person somewhere: friends, requests either way, and chat partners. */
async function peopleWhoSee(userId: string): Promise<string[]> {
  const links = await db
    .select({ low: friendships.userLow, high: friendships.userHigh })
    .from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));
  const partners = await chatPartnersOf(userId);
  return [
    ...new Set([
      ...links.map((l) => (l.low === userId ? l.high : l.low)),
      ...partners,
    ]),
  ];
}

/** Tells everyone who shows this person (and their own devices) to refresh their details. */
export async function profileChanged(userId: string): Promise<void> {
  for (const id of [userId, ...(await peopleWhoSee(userId))]) {
    emitToUser(id, "profile:changed", { userId });
  }
}

/** People you've chatted with (a chat stays open even after an unfriend). */
async function chatPartnersOf(userId: string): Promise<string[]> {
  const myChats = db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId));
  const partners = await db
    .selectDistinct({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(inArray(conversationMembers.conversationId, myChats), ne(conversationMembers.userId, userId)));
  return partners.map((p) => p.userId);
}

type Visibility = "basic" | "full" | "friend";

/**
 * What a viewer may see of someone:
 * - "friend": everything, including whether they're online (yourself, or friends).
 * - "full": About me and join date, but not their status. For someone who sent YOU a
 *   request (so you can decide) or someone you've chatted with.
 * - "basic": name, username and photo only (what search already shows). Sending
 *   someone a request does not unlock their profile.
 */
async function visibilityOf(viewerId: string, targetId: string): Promise<Visibility> {
  if (viewerId === targetId || (await areFriends(viewerId, targetId))) return "friend";
  const [request] = await db
    .select({ requesterId: friendships.requesterId })
    .from(friendships)
    .where(and(pairIs(viewerId, targetId), eq(friendships.status, "pending")))
    .limit(1);
  if (request?.requesterId === targetId) return "full";
  return (await chatPartnersOf(viewerId)).includes(targetId) ? "full" : "basic";
}

async function profileOf(targetId: string, visibility: Visibility) {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      bio: users.bio,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, targetId));
  if (!row) return null;
  const base = {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarVersion: row.avatarVersion,
  };
  if (visibility === "basic") return { ...base, bio: null, joinedAt: null, presence: null };
  const presence =
    visibility === "friend" ? ((await presenceOf([row.id])).get(row.id) ?? null) : null;
  return { ...base, bio: row.bio, joinedAt: row.createdAt.toISOString(), presence };
}

// GET /users/me/profile — your own profile, for Edit profile.
profileRouter.get("/me/profile", async (_req, res) => {
  res.json(await profileOf(me(res).id, "friend"));
});

const profileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, "Enter a display name.")
      .max(DISPLAY_NAME_MAX, `Display names can be at most ${DISPLAY_NAME_MAX} characters.`)
      .refine((n) => !HIDDEN_CHARS.test(n) && !n.includes("\n"), "Display names can't contain hidden characters."),
    bio: z
      .string()
      .trim()
      .max(BIO_MAX, `About me can be up to ${BIO_MAX} characters.`)
      .refine((b) => !HIDDEN_CHARS.test(b), "About me can't contain hidden characters.")
      .transform((b) => (b === "" ? null : b))
      .nullable(),
  })
  .partial()
  .strict();

// PATCH /users/me/profile  { displayName?, bio? }
profileRouter.patch("/me/profile", uploadLimiter, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
    return;
  }
  if (Object.keys(parsed.data).length) {
    await db.update(users).set(parsed.data).where(eq(users.id, me(res).id));
    await profileChanged(me(res).id);
  }
  res.json(await profileOf(me(res).id, "friend"));
});

// PUT /users/me/avatar — upload a new profile photo (the image itself is the request body).
profileRouter.put(
  "/me/avatar",
  uploadLimiter,
  express.raw({ type: "image/*", limit: AVATAR_UPLOAD_MAX }),
  async (req, res) => {
    const input = req.body;
    if (!Buffer.isBuffer(input) || input.length === 0) {
      res.status(400).json({ error: "invalid", message: "Choose a photo (JPG, PNG, WebP or GIF)." });
      return;
    }

    // Turned the right way up, cropped to a square, re-saved as WebP (hidden data dropped).
    const output = await squarePhoto(input);
    if (!output) {
      res.status(400).json({ error: "invalid", message: "That file isn't a photo Glofly can use." });
      return;
    }

    const myId = me(res).id;
    const [before] = await db
      .select({ avatarVersion: users.avatarVersion })
      .from(users)
      .where(eq(users.id, myId));
    const version = randomUUID();
    await storage.put(avatarKey(myId, version), output, "image/webp");
    await db.update(users).set({ avatarVersion: version }).where(eq(users.id, myId));
    if (before?.avatarVersion) await storage.remove(avatarKey(myId, before.avatarVersion));
    await profileChanged(myId);
    res.json({ avatarVersion: version });
  },
);

// DELETE /users/me/avatar — back to initials.
profileRouter.delete("/me/avatar", async (_req, res) => {
  const myId = me(res).id;
  const [before] = await db
    .select({ avatarVersion: users.avatarVersion })
    .from(users)
    .where(eq(users.id, myId));
  if (before?.avatarVersion) {
    await db.update(users).set({ avatarVersion: null }).where(eq(users.id, myId));
    await storage.remove(avatarKey(myId, before.avatarVersion));
    await profileChanged(myId);
  }
  res.json({ avatarVersion: null });
});

// GET /users/:id/profile — someone's profile card.
profileRouter.get("/:id/profile", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // A block looks exactly like "not found", same as everywhere else.
  const blocked =
    id.data !== me(res).id &&
    ((await blockedEitherWay(me(res).id, id.data)) || (await deletionPending(id.data)));
  const profile = blocked ? null : await profileOf(id.data, await visibilityOf(me(res).id, id.data));
  if (!profile) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(profile);
});

// GET /avatars/:userId/:version — a profile photo. The version in the address changes with
// every new photo, so it can be cached for good.
avatarsRouter.get("/:userId/:version", async (req, res) => {
  const userId = z.uuid().safeParse(req.params.userId);
  const version = z.uuid().safeParse(req.params.version);
  if (!userId.success || !version.success) {
    res.status(404).end();
    return;
  }
  const [row] = await db
    .select({ avatarVersion: users.avatarVersion })
    .from(users)
    .where(eq(users.id, userId.data));
  const file =
    row?.avatarVersion === version.data ? await storage.get(avatarKey(userId.data, version.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  file.stream.pipe(res);
});
