import { randomUUID } from "node:crypto";
import express, { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { headerPhoto, squarePhoto } from "./photo";
import {
  activityOf,
  boardSchema,
  boardView,
  cleanBoard,
  mutualCounts,
  mutualsOf,
  privacyChanges,
  privacyOf,
  relationOf,
  shows,
  storedBoard,
} from "./board";
import { gamesSharedWith } from "../games/routes";
import { coversFor } from "../games/igdb";
import type { BoardTile } from "@glofly/shared";

/** Your own board for editing, with box art on its games (the apps show it in the preview). */
async function withCovers(tiles: BoardTile[]): Promise<BoardTile[]> {
  const covers = await coversFor(tiles.flatMap((t) => (t.kind === "games" ? t.games : [])));
  return tiles.map((t) =>
    t.kind === "games" ? { ...t, games: t.games.map((g) => (covers.has(g.key) ? { ...g, cover: covers.get(g.key)! } : g)) } : t,
  );
}
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { friendships, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUser } from "../realtime";
import { presenceOf } from "../presence";
import { sendStream, storage } from "../storage";
import { areFriends, blockedEitherWay, chatPartnersOf, deletionPending, pairIs } from "../friends/rules";
import { DISPLAY_NAME_MAX } from "../auth/validation";

export const profileRouter = Router();
export const avatarsRouter = Router();
/** 0.9.1: profile header images. */
export const headersRouter = Router();
profileRouter.use(requireAuth);
avatarsRouter.use(requireAuth);
headersRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

import { BIO_MAX, PRONOUNS_MAX, cleanNickname, cleanPronouns, nicknameProblem, type ProfileExtras } from "@glofly/shared";
import { setNickname } from "./nicknames";
const AVATAR_UPLOAD_MAX = "8mb";

const uploadLimiter = rateLimit("profile:upload", {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of photo changes. Try again later." },
});

const avatarKey = (userId: string, version: string) => `avatars/${userId}/${version}.webp`;
export const headerKey = (userId: string, version: string) => `headers/${userId}/${version}.webp`;

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

async function profileOf(targetId: string, visibility: Visibility, viewerId: string) {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      bio: users.bio,
      createdAt: users.createdAt,
      pronouns: users.pronouns,
      headerVersion: users.headerVersion,
      headerFocus: users.headerFocus,
      profileBoard: users.profileBoard,
      profilePrivacy: users.profilePrivacy,
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
  const presence =
    visibility === "friend" ? ((await presenceOf([row.id])).get(row.id) ?? null) : null;
  const extras = await extrasOf(row, viewerId, presence?.activity?.name ?? null);
  if (visibility === "basic") return { ...base, bio: null, joinedAt: null, presence: null, ...extras };
  return { ...base, bio: row.bio, joinedAt: row.createdAt.toISOString(), presence, ...extras };
}

/**
 * 0.9.1: header, pronouns, board, mutual counts. Header and pronouns show to anyone who can open
 * the card (like the photo and name), except a family-managed account's, which only its friends see.
 */
async function extrasOf(
  row: {
    id: string;
    pronouns: string | null;
    headerVersion: string | null;
    headerFocus: number;
    profileBoard: unknown;
    profilePrivacy: unknown;
  },
  viewerId: string,
  playing: string | null,
): Promise<ProfileExtras> {
  const rel = await relationOf(viewerId, row.id);
  const privacy = privacyOf(row.profilePrivacy);
  const tiles = storedBoard(row.profileBoard);
  const open = !rel.restricted || rel.friend;
  const gamesShared = await gamesSharedWith(viewerId, row.id);
  const board = shows(privacy.board, rel) && tiles.length ? await boardView(viewerId, row.id, tiles, { gamesShared, playing }) : null;
  const mutualsShown = !rel.self && shows(privacy.mutuals, rel);
  return {
    pronouns: open ? row.pronouns : null,
    header: open && row.headerVersion ? { version: row.headerVersion, focus: row.headerFocus } : null,
    board: board?.length ? board : null,
    counts: mutualsShown ? await mutualCounts(viewerId, row.id) : { mutualFriends: 0, mutualConstellations: 0 },
    activityShown: shows(privacy.activity, rel),
    ...(rel.self ? { privacy, boardSource: await withCovers(tiles) } : {}),
  };
}

// GET /users/me/profile — your own profile, for Edit profile.
profileRouter.get("/me/profile", async (_req, res) => {
  res.json(await profileOf(me(res).id, "friend", me(res).id));
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
    // 0.9.1 profiles
    pronouns: z
      .string()
      .max(PRONOUNS_MAX * 2)
      .refine((p) => !HIDDEN_CHARS.test(p) && !p.includes("\n"), "Pronouns can't contain hidden characters.")
      .transform((p) => cleanPronouns(p))
      .refine((p) => !p || p.length <= PRONOUNS_MAX, `Pronouns can be up to ${PRONOUNS_MAX} characters.`)
      .nullable(),
    board: boardSchema,
    privacy: privacyChanges,
    headerFocus: z.number().int().min(0).max(100),
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
  const { board, privacy, ...rest } = parsed.data;
  const changes: Partial<typeof users.$inferInsert> = { ...rest };
  if (board) {
    const cleaned = await cleanBoard(me(res).id, board);
    if (typeof cleaned === "string") {
      res.status(400).json({ error: "invalid", message: cleaned });
      return;
    }
    changes.profileBoard = cleaned;
  }
  if (privacy) {
    const [row] = await db.select({ p: users.profilePrivacy }).from(users).where(eq(users.id, me(res).id));
    changes.profilePrivacy = { ...privacyOf(row?.p), ...privacy };
  }
  if (Object.keys(changes).length) {
    await db.update(users).set(changes).where(eq(users.id, me(res).id));
    await profileChanged(me(res).id);
  }
  res.json(await profileOf(me(res).id, "friend", me(res).id));
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

// PUT /users/me/header — 0.9.1: a header image for your profile card (the image is the body).
profileRouter.put(
  "/me/header",
  uploadLimiter,
  express.raw({ type: "image/*", limit: AVATAR_UPLOAD_MAX }),
  async (req, res) => {
    const input = req.body;
    if (!Buffer.isBuffer(input) || input.length === 0) {
      res.status(400).json({ error: "invalid", message: "Choose a picture (JPG, PNG, WebP or GIF)." });
      return;
    }
    const output = await headerPhoto(input);
    if (!output) {
      res.status(400).json({ error: "invalid", message: "That file isn't a picture Glofly can use." });
      return;
    }
    const myId = me(res).id;
    const [before] = await db.select({ v: users.headerVersion }).from(users).where(eq(users.id, myId));
    const version = randomUUID();
    await storage.put(headerKey(myId, version), output, "image/webp");
    await db.update(users).set({ headerVersion: version, headerFocus: 50 }).where(eq(users.id, myId));
    if (before?.v) await storage.remove(headerKey(myId, before.v));
    await profileChanged(myId);
    res.json({ header: { version, focus: 50 } });
  },
);

// DELETE /users/me/header — back to the night sky.
profileRouter.delete("/me/header", async (_req, res) => {
  const myId = me(res).id;
  const [before] = await db.select({ v: users.headerVersion }).from(users).where(eq(users.id, myId));
  if (before?.v) {
    await db.update(users).set({ headerVersion: null }).where(eq(users.id, myId));
    await storage.remove(headerKey(myId, before.v));
    await profileChanged(myId);
  }
  res.json({ header: null });
});

/** Someone I may look at (not blocked either way, not leaving), or null. */
async function viewable(req: { params: Record<string, string> }, res: Response): Promise<string | null> {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return null;
  if (id.data === me(res).id) return id.data;
  if ((await blockedEitherWay(me(res).id, id.data)) || (await deletionPending(id.data))) return null;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id.data));
  return row ? row.id : null;
}

// GET /users/:id/mutuals — 0.9.1: friends and constellations you both have (if they show them).
profileRouter.get("/:id/mutuals", async (req, res) => {
  const id = await viewable(req, res);
  if (!id) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [row] = await db.select({ p: users.profilePrivacy }).from(users).where(eq(users.id, id));
  const shown = shows(privacyOf(row?.p).mutuals, await relationOf(me(res).id, id));
  res.json(shown ? { shown: true, ...(await mutualsOf(me(res).id, id)) } : { shown: false, friends: [], constellations: [] });
});

// GET /users/:id/activity — 0.9.1: recent games and constellations joined (if they show them).
profileRouter.get("/:id/activity", async (req, res) => {
  const id = await viewable(req, res);
  if (!id) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [row] = await db.select({ p: users.profilePrivacy }).from(users).where(eq(users.id, id));
  const shown = shows(privacyOf(row?.p).activity, await relationOf(me(res).id, id));
  res.json(shown ? { shown: true, items: await activityOf(id, await gamesSharedWith(me(res).id, id)) } : { shown: false, items: [] });
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
  const profile = blocked ? null : await profileOf(id.data, await visibilityOf(me(res).id, id.data), me(res).id);
  if (!profile) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(profile);
});

// PUT /users/:id/nickname {nickname: string | null} — your own name for someone; only you see it
// (profile/nicknames.ts puts it into everything the server sends you). Null or "" removes it.
profileRouter.put("/:id/nickname", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const body = z.object({ nickname: z.string().max(200).nullable() }).safeParse(req.body);
  if (!id.success || id.data === me(res).id) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "invalid", message: "Send a nickname, or null to remove it." });
    return;
  }
  if ((await blockedEitherWay(me(res).id, id.data)) || (await deletionPending(id.data))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id.data));
  if (!target) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const nickname = cleanNickname(body.data.nickname ?? "");
  const problem = nickname ? nicknameProblem(nickname) : null;
  if (problem) {
    res.status(400).json({ error: "invalid", message: problem });
    return;
  }
  await setNickname(me(res).id, id.data, nickname || null);
  // Your devices fetch fresh lists so the new name shows everywhere. profile:changed is what every
  // app (old ones too) already does that for when someone renames themselves.
  emitToUser(me(res).id, "profile:changed", { userId: id.data });
  res.json({ userId: id.data, nickname: nickname || null });
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
  sendStream(file.stream, res);
});

// GET /headers/:userId/:version — 0.9.1: a profile header image (same rules as photos: the
// version changes with every new picture). A blocked person gets "not found".
headersRouter.get("/:userId/:version", async (req, res) => {
  const userId = z.uuid().safeParse(req.params.userId);
  const version = z.uuid().safeParse(req.params.version);
  if (!userId.success || !version.success || (userId.data !== me(res).id && (await blockedEitherWay(me(res).id, userId.data)))) {
    res.status(404).end();
    return;
  }
  const [row] = await db.select({ v: users.headerVersion }).from(users).where(eq(users.id, userId.data));
  const file = row?.v === version.data ? await storage.get(headerKey(userId.data, version.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  sendStream(file.stream, res);
});
