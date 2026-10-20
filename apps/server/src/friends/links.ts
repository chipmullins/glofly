import { randomInt } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { rateLimit, type Options } from "express-rate-limit";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import {
  FRIEND_LINK_DAILY_CAP,
  FRIEND_LINK_DEAD,
  FRIEND_LINK_PATTERN,
  FRIEND_LINK_RANDOM,
  friendLinkSlug,
  friendLinkUrl,
  type FriendLinkAccepted,
  type FriendLinkInfo,
  type FriendLinkPreview,
  type MyFriendLink,
  type PublicUser,
} from "@glofly/shared";
import { db } from "../db";
import { friendLinks, friendLinkUses, friendships, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUser } from "../realtime";
import { announcePresence } from "../presence";
import { inBackground, notifyFriendJoined, notifyFriendNews } from "../push/notify";
import { storage } from "../storage";
import { renderFriendLinkPreview } from "./linkPreview";
import { blockedEitherWay, isRestricted, MANAGED_BY_FAMILY, pair, pairIs } from "./rules";

// 0.8.0 shareable friend invite links (glofly.app/i/<code>; approved mockups
// docs/design/0.8/InviteLink.dc.html + InvitePage.dc.html).
//
// Everyone gets one personal link, made the first time they ask for it. Signing up from it
// (POST /auth/register with `friendLink`) or opening it while signed in (POST /friends/link/:code/accept)
// makes you friends with its owner right away: no request to wait on. Reset makes a new code and
// the old one stops working at once (people who joined stay friends).
//
// Who can't: restricted (family) accounts never get a link, can't use one, and can't be added
// through one (their family adds their friends in Control). A link whose owner is deleting their
// account, is suspended or restricted is dead. A block (either way) looks exactly like a dead link,
// so blocking never reveals itself. Your own link does nothing for you.
//
// Abuse: lookups and accepts are limited per account and per address (per day), the public page
// per address, and one owner gains at most FRIEND_LINK_DAILY_CAP friends a day through it. The page
// and the sign-up screen only ever show the owner's display name, username and photo.

const DAY = 24 * 60 * 60 * 1000;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A fresh code for this username: `chip-7Kq4mZ`. */
export function newFriendLinkCode(username: string): string {
  let random = "";
  for (let i = 0; i < FRIEND_LINK_RANDOM; i++) random += BASE62[randomInt(BASE62.length)];
  return `${friendLinkSlug(username)}-${random}`;
}

const isClash = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === "23505";
};

/** Your link, made now if you don't have one yet. */
async function linkOf(userId: string, username: string): Promise<{ code: string; createdAt: Date }> {
  const [found] = await db.select().from(friendLinks).where(eq(friendLinks.userId, userId));
  if (found) return found;
  for (let tries = 0; tries < 5; tries++) {
    try {
      const [made] = await db
        .insert(friendLinks)
        .values({ userId, code: newFriendLinkCode(username) })
        .onConflictDoNothing({ target: friendLinks.userId })
        .returning();
      if (made) return made;
      // Made by another request at the same moment: use that one.
      const [other] = await db.select().from(friendLinks).where(eq(friendLinks.userId, userId));
      if (other) return other;
    } catch (err) {
      if (!isClash(err)) throw err; // the same code twice (astronomically rare): try another
    }
  }
  throw new Error("Couldn't make an invite link");
}

/** A new code for your link; the old one is dead from now on. */
async function resetLinkOf(userId: string, username: string): Promise<{ code: string; createdAt: Date }> {
  await linkOf(userId, username);
  for (let tries = 0; tries < 5; tries++) {
    try {
      const [row] = await db
        .update(friendLinks)
        .set({ code: newFriendLinkCode(username), createdAt: new Date() })
        .where(eq(friendLinks.userId, userId))
        .returning();
      return row;
    } catch (err) {
      if (!isClash(err)) throw err;
    }
  }
  throw new Error("Couldn't make a new invite link");
}

/** How many people became friends through this code. */
async function joinedThrough(userId: string, code: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(friendLinkUses)
    .where(and(eq(friendLinkUses.inviterId, userId), eq(friendLinkUses.code, code)));
  return n;
}

const myLinkBody = async (userId: string, link: { code: string; createdAt: Date }): Promise<MyFriendLink> => ({
  code: link.code,
  url: friendLinkUrl(link.code),
  joined: await joinedThrough(userId, link.code),
  createdAt: link.createdAt.toISOString(),
});

export type LinkOwner = PublicUser;

/** Whose link this is, if it still works (null = dead: wrong, reset, or its owner can't be added). */
export async function friendLinkOwner(code: string): Promise<LinkOwner | null> {
  if (!FRIEND_LINK_PATTERN.test(code)) return null;
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
    })
    .from(friendLinks)
    .innerJoin(users, eq(users.id, friendLinks.userId))
    .where(
      and(
        eq(friendLinks.code, code),
        isNull(users.deleteAfter),
        isNull(users.suspendedAt),
        // Family-managed accounts can't be added through a link (and never get one).
        eq(users.restricted, false),
      ),
    );
  return row ?? null;
}

/** How many people became this person's friends through their link today (the abuse cap). */
async function usesToday(inviterId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(friendLinkUses)
    .where(and(eq(friendLinkUses.inviterId, inviterId), gt(friendLinkUses.createdAt, new Date(Date.now() - DAY))));
  return n;
}

export type LinkUseResult =
  | { ok: true; status: "accepted" | "already_friends"; owner: LinkOwner }
  | { ok: false; reason: "dead" | "self" | "restricted" | "cap" };

/**
 * Makes `me` and the link's owner friends (signed in, or just signed up with `signedUp`). Works out
 * every refusal first. Tells both people's apps right away, like an accepted friend request.
 */
export async function useFriendLink(
  code: string,
  me: { id: string; displayName: string; avatarVersion: string | null; username: string },
  signedUp: boolean,
): Promise<LinkUseResult> {
  const owner = await friendLinkOwner(code);
  if (!owner) return { ok: false, reason: "dead" };
  if (owner.id === me.id) return { ok: false, reason: "self" };
  if (await isRestricted(me.id)) return { ok: false, reason: "restricted" };
  // A block (either way) looks like a dead link.
  if (await blockedEitherWay(owner.id, me.id)) return { ok: false, reason: "dead" };

  const [existing] = await db.select().from(friendships).where(pairIs(owner.id, me.id)).limit(1);
  if (existing?.status === "accepted") return { ok: true, status: "already_friends", owner };
  if ((await usesToday(owner.id)) >= FRIEND_LINK_DAILY_CAP) return { ok: false, reason: "cap" };

  const now = new Date();
  const made = await db.transaction(async (tx) => {
    // A request either of you sent becomes a friendship (the link is the owner's yes).
    const rows = existing
      ? await tx
          .update(friendships)
          .set({ status: "accepted", acceptedAt: now })
          .where(and(eq(friendships.id, existing.id), eq(friendships.status, "pending")))
          .returning({ id: friendships.id })
      : await tx
          .insert(friendships)
          .values({ ...pair(owner.id, me.id), requesterId: owner.id, status: "accepted", acceptedAt: now })
          .onConflictDoNothing()
          .returning({ id: friendships.id });
    if (!rows.length) return false; // made at the same moment by another request
    await tx.insert(friendLinkUses).values({ inviterId: owner.id, userId: me.id, code, signedUp });
    return true;
  });
  if (!made) return { ok: true, status: "already_friends", owner };

  const joined = { id: me.id, username: me.username, displayName: me.displayName, avatarVersion: me.avatarVersion };
  emitToUser(owner.id, "friends:changed", {});
  emitToUser(me.id, "friends:changed", {});
  await announcePresence(owner.id, emitToUser, true);
  await announcePresence(me.id, emitToUser, true);
  if (signedUp) {
    // The same as an emailed invite: "Maya joined Glofly from your invite. You're friends now!"
    emitToUser(owner.id, "friend:joined", { user: joined });
    inBackground(notifyFriendJoined(owner.id, joined));
  } else {
    // 0.8.0 apps say "added you with your invite link"; older apps just see the new friend.
    emitToUser(owner.id, "friend:linked", { user: joined });
    inBackground(notifyFriendNews(owner.id, joined, "added you with your invite link. You're friends now!", "day"));
  }
  return { ok: true, status: "accepted", owner };
}

// ───────────── Routes for signed-in apps: /friends/link ─────────────

export const friendLinkRouter = Router();
friendLinkRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string; avatarVersion: string | null };
const me = (res: Response): Me => res.locals.user as Me;

const tooMany = (message: string): Partial<Options> => ({
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message },
});
const perUserDaily = (limit: number, message: string) =>
  rateLimit({ windowMs: DAY, limit, keyGenerator: (_req, res) => me(res).id, ...tooMany(message) });
const perAddressDaily = (limit: number, message: string) => rateLimit({ windowMs: DAY, limit, ...tooMany(message) });

const TRY_TOMORROW = "That's a lot of invite links for one day. Try again tomorrow.";
const lookupPerUser = perUserDaily(200, TRY_TOMORROW);
const lookupPerAddress = perAddressDaily(400, TRY_TOMORROW);
const acceptPerUser = perUserDaily(30, TRY_TOMORROW);
const acceptPerAddress = perAddressDaily(60, TRY_TOMORROW);
const resetPerUser = perUserDaily(20, "You've made a lot of new links today. Try again tomorrow.");
const minePerUser = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  ...tooMany("Slow down a little and try again."),
});

const DEAD = { error: "not_found", message: FRIEND_LINK_DEAD } as const;
const NO_LINK_FOR_FAMILY = {
  ...MANAGED_BY_FAMILY,
  message: "Your account is managed by your family, so they add your friends for you.",
} as const;

// GET /friends/link — your invite link (made the first time) and how many joined from it.
friendLinkRouter.get("/", minePerUser, async (_req, res) => {
  const user = me(res);
  if (await isRestricted(user.id)) {
    res.status(403).json(NO_LINK_FOR_FAMILY);
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(await myLinkBody(user.id, await linkOf(user.id, user.username)));
});

// POST /friends/link/reset — a new link; the old one stops working right away.
friendLinkRouter.post("/reset", resetPerUser, async (_req, res) => {
  const user = me(res);
  if (await isRestricted(user.id)) {
    res.status(403).json(NO_LINK_FOR_FAMILY);
    return;
  }
  res.json(await myLinkBody(user.id, await resetLinkOf(user.id, user.username)));
});

const codeParam = (req: Request): string | null => {
  const code = String(req.params.code ?? "");
  return FRIEND_LINK_PATTERN.test(code) ? code : null;
};

// GET /friends/link/:code — whose link it is and what they are to you ("Add Chip as a friend?").
friendLinkRouter.get("/:code", lookupPerUser, lookupPerAddress, async (req, res) => {
  const user = me(res);
  const code = codeParam(req);
  if (await isRestricted(user.id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  const owner = code ? await friendLinkOwner(code) : null;
  if (!owner || (owner.id !== user.id && (await blockedEitherWay(owner.id, user.id)))) {
    res.status(404).json(DEAD);
    return;
  }
  let relationship: FriendLinkPreview["relationship"] = "none";
  if (owner.id === user.id) relationship = "self";
  else {
    const [link] = await db.select().from(friendships).where(pairIs(owner.id, user.id)).limit(1);
    if (link) relationship = link.status === "accepted" ? "friends" : link.requesterId === user.id ? "outgoing" : "incoming";
  }
  const body: FriendLinkPreview = { user: owner, relationship };
  res.json(body);
});

// POST /friends/link/:code/accept — become friends with the link's owner.
friendLinkRouter.post("/:code/accept", acceptPerUser, acceptPerAddress, async (req, res) => {
  const code = codeParam(req);
  if (!code) {
    res.status(404).json(DEAD);
    return;
  }
  const result = await useFriendLink(code, me(res), false);
  if (!result.ok) {
    if (result.reason === "restricted") res.status(403).json(MANAGED_BY_FAMILY);
    else if (result.reason === "self") res.status(400).json({ error: "self", message: "That's your own invite link. Send it to a friend!" });
    else if (result.reason === "cap")
      res.status(429).json({ error: "too_many_requests", message: "This invite link has been used a lot today. Try again tomorrow." });
    else res.status(404).json(DEAD);
    return;
  }
  const body: FriendLinkAccepted = { status: result.status, user: result.owner };
  res.json(body);
});

// ───────────── The public page: glofly.app/i/<code> ─────────────
//
// Anyone can open it, signed in or not: no scripts, nothing but the owner's display name, username
// and photo. "Open in Glofly" opens glofly://i/<code> (desktop and phones ask "Add Chip as a
// friend?"); "use Glofly in your browser" opens chat.glofly.app/?friend=<code> (sign-up makes you
// friends, signing in asks). Caddy sends /i/* from glofly.app here.

const pageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).type("text/plain").send("Too many tries. Wait a few minutes and try again."),
});
const pageDailyLimiter = rateLimit({
  windowMs: DAY,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).type("text/plain").send("Too many tries today. Try again tomorrow."),
});

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The website's address (where /i/<code> is public): glofly.app live, this server while developing. */
const siteUrl = (): string => (process.env.SITE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, "");
const webOrigin = (): string => (process.env.WEB_ORIGIN?.trim() || "https://chat.glofly.app").replace(/\/+$/, "");
/** "use Glofly in your browser": the web app opens sign-up (or asks, once signed in). */
export const browserFriendLink = (code: string): string => `${webOrigin()}/?friend=${encodeURIComponent(code)}`;

/** "Chip" from "Chip Mullins" (the page says "Join Chip on Glofly"). */
const firstName = (owner: LinkOwner): string => owner.displayName.trim().split(/\s+/)[0] || owner.username;
/** "CM" */
const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? "?")[0] ?? "?";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
};

const PAGE_CSS = `
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:20px 16px 40px;color:#f5ede6;font:400 16px/1.5 'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;
background:radial-gradient(2px 2px at 12% 18%,#f5ede6,transparent 70%),radial-gradient(3px 3px at 22% 64%,#ffb347,transparent 70%),radial-gradient(1.5px 1.5px at 34% 10%,#e9d5c4,transparent 70%),radial-gradient(2px 2px at 8% 82%,#f9b26b,transparent 70%),radial-gradient(2px 2px at 80% 14%,#f5ede6,transparent 70%),radial-gradient(3px 3px at 88% 48%,#ffb347,transparent 70%),radial-gradient(2px 2px at 70% 78%,#e9d5c4,transparent 70%),radial-gradient(1.5px 1.5px at 94% 86%,#f9b26b,transparent 70%),radial-gradient(2px 2px at 58% 6%,#f5ede6,transparent 70%),radial-gradient(2.5px 2.5px at 46% 92%,#ffb347,transparent 70%),radial-gradient(ellipse at 50% 120%,#4a2a3a 0%,#23152a 45%,#120c0a 100%) fixed}
.brand{align-self:stretch;max-width:960px;width:100%;margin:0 auto;display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px;color:#f5ede6;text-decoration:none}
.brand img{width:30px;height:30px}
main{flex:1;width:100%;max-width:460px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:28px 0}
.av{width:96px;height:96px;border-radius:50%;background:#e2650f;color:#fff;font-weight:700;font-size:36px;display:grid;place-items:center;overflow:hidden;box-shadow:0 0 0 4px rgba(255,179,71,.25),0 0 30px rgba(255,165,74,.4)}
.av img{width:100%;height:100%;object-fit:cover}
.by{margin:0;color:#d9c2b1;font-size:15px}
h1{margin:0;font-size:38px;line-height:1.1;font-weight:800;letter-spacing:-.01em}
.lede{margin:0;color:#e9d5c4;max-width:400px}
.open{display:block;width:100%;margin-top:4px;padding:15px 18px;border-radius:999px;background:#ffb347;color:#1c1210;font-weight:700;font-size:17px;text-decoration:none;box-shadow:0 0 22px rgba(255,165,74,.4)}
.open:focus-visible,.dl:focus-visible,a:focus-visible{outline:3px solid #ffd27a;outline-offset:3px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%}
.dl,.soon{display:flex;align-items:center;justify-content:center;min-height:46px;padding:8px 10px;border-radius:14px;font-size:14px}
.dl{border:1px solid rgba(255,255,255,.18);color:#f5ede6;text-decoration:none;font-weight:700}
.dl:hover{border-color:#ffb347}
.soon{border:1px dashed rgba(255,255,255,.16);color:#b8a699;font-size:13px;white-space:nowrap}
.small{margin:0;color:#d9c2b1;font-size:14px}
.small a{color:#ffb347}
.phone{display:none}
@media (max-width:520px){h1{font-size:30px}.av{width:80px;height:80px;font-size:30px}.grid,.computer{display:none}.phone{display:block}}
`;

function sendPage(res: Response, status: number, head: { title: string; og?: string }, body: string): void {
  res
    .status(status)
    .set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    })
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(head.title)}</title>
${head.og ?? ""}<style>${PAGE_CSS}</style></head>
<body>
<a class="brand" href="https://glofly.app"><img src="/logo.svg" alt="">Glofly</a>
<main>${body}</main>
</body></html>`);
}

const DOWNLOADS = `<div class="grid">
<a class="dl" href="https://glofly.app/download">Download for Windows</a>
<a class="dl" href="https://glofly.app/download/mac">Download for Mac</a>
<span class="soon">iPhone and iPad · coming soon</span>
<span class="soon">Android · coming soon</span>
</div>`;

export const friendLinkPageRouter = Router();
friendLinkPageRouter.use(pageLimiter, pageDailyLimiter);

// GET /i/:code — the invite page.
friendLinkPageRouter.get("/:code", async (req, res) => {
  const code = String(req.params.code);
  const owner = await friendLinkOwner(code);
  if (!owner) {
    sendPage(
      res,
      404,
      { title: "Invite link · Glofly" },
      `<div class="av" aria-hidden="true">✦</div>
<h1>This invite link doesn't work anymore</h1>
<p class="lede">${esc(FRIEND_LINK_DEAD.replace("This invite link doesn't work anymore. ", ""))}</p>
<a class="open" href="https://glofly.app">Visit Glofly</a>`,
    );
    return;
  }
  const name = firstName(owner);
  const title = `Join ${name} on Glofly`;
  const pageUrl = `${siteUrl()}/i/${code}`;
  const og = `<meta property="og:type" content="website">
<meta property="og:site_name" content="Glofly">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(`Sign up from this link and you and ${name} are friends right away.`)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(`${pageUrl}/preview.png`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`${owner.displayName} on Glofly`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(`${pageUrl}/preview.png`)}">
<meta name="description" content="${esc(`${owner.displayName} invited you to Glofly.`)}">
`;
  const face = owner.avatarVersion
    ? `<img src="/i/${esc(code)}/avatar/${esc(owner.avatarVersion)}" alt="">`
    : esc(initialsOf(owner.displayName));
  sendPage(
    res,
    200,
    { title, og },
    `<div class="av" aria-hidden="true">${face}</div>
<p class="by">@${esc(owner.username)} invited you</p>
<h1>${esc(title)}</h1>
<p class="lede">Sign up from this link and you and ${esc(name)} are friends right away. No requests to wait on.</p>
<a class="open" href="glofly://i/${esc(code)}">Open in Glofly</a>
${DOWNLOADS}
<p class="small computer">Or <a href="${esc(browserFriendLink(code))}">use Glofly in your browser</a>. Already have an account? Open it and you'll be added.</p>
<p class="small phone">The phone apps are coming soon · <a href="${esc(browserFriendLink(code))}">use it in your browser</a></p>`,
  );
});

// GET /i/:code/info — the link owner's name for a sign-up screen ("Chip invited you"). JSON, no
// sign-in (the same as the page shows). Dead links: 404.
friendLinkPageRouter.get("/:code/info", async (req, res) => {
  const owner = await friendLinkOwner(String(req.params.code));
  res.set("Cache-Control", "no-store");
  if (!owner) {
    res.status(404).json(DEAD);
    return;
  }
  const body: FriendLinkInfo = { displayName: owner.displayName, username: owner.username };
  res.json(body);
});

/** The owner's profile photo, as stored (512×512 WebP), or null. */
async function photoOf(owner: LinkOwner): Promise<Buffer | null> {
  if (!owner.avatarVersion) return null;
  const file = await storage.get(`avatars/${owner.id}/${owner.avatarVersion}.webp`);
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

// GET /i/:code/avatar/:version — the owner's photo, only for a live link and their current photo.
friendLinkPageRouter.get("/:code/avatar/:version", async (req, res) => {
  const owner = await friendLinkOwner(String(req.params.code));
  if (!owner || !owner.avatarVersion || owner.avatarVersion !== String(req.params.version)) {
    res.status(404).end();
    return;
  }
  const photo = await photoOf(owner);
  if (!photo) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(photo);
});

// GET /i/:code/preview.png — the link preview picture (Open Graph): the photo, or initials, glowing
// on the night sky. Kept for a while per photo/name, so a busy link isn't redrawn every time.
const previews = new Map<string, Buffer>();
friendLinkPageRouter.get("/:code/preview.png", async (req, res) => {
  const owner = await friendLinkOwner(String(req.params.code));
  if (!owner) {
    res.status(404).end();
    return;
  }
  const key = `${owner.id}:${owner.avatarVersion ?? ""}:${owner.displayName}`;
  let png = previews.get(key);
  if (!png) {
    png = await renderFriendLinkPreview({ name: owner.displayName, initials: initialsOf(owner.displayName), photo: await photoOf(owner) });
    if (previews.size > 300) previews.delete(previews.keys().next().value!);
    previews.set(key, png);
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(png);
});
