import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { formatLinkCode, GAME_LINK_GAMES, LINK_CODE_MINUTES, normalizeLinkCode, type GameLinkGame, type GameLinkPreview, type LinkedGameServer } from "@glofly/shared";
import { db } from "../db";
import {
  constellationBans,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  gameLinkCodes,
  gameLinks,
  serverSettings,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { lockedDown } from "../admin/lockdown";
import { takeSlot, noteRedisError } from "../rateLimit";
import { logIntegration } from "./keys";
import { clientIp } from "./ip";
import type { BotKey } from "./api";

// Communities round (Nov 2026): Linked game servers (approved boards 7, 8, 13).
//
// Game server (constellation API key with "link"):
//   POST /api/v1/links/lookup { game, identity, playerName, identities? }
//     linked   → { linked: true, allowed, reason?, user?, owner?, roles?, timedOutUntil? }
//     unlinked → { linked: false, code: "482-913", expiresAt } (the same code until it runs out)
// The player (signed in):
//   GET    /account/game-links                    Settings → Linked game servers
//   POST   /account/game-links/preview { code }   "Link to Cozy RP's FiveM server?"
//   POST   /account/game-links       { code }     link (one player per account per constellation + game)
//   DELETE /account/game-links/:id                unlink
//
// Security: codes are 6 digits, 10 minutes, one use, and are never stored: each is an HMAC of its
// row id with a secret kept in server_settings, so the same code can be shown again on "Check
// again" while only its SHA-256 is in the table. Entering codes is limited per person and address.
// A server only ever learns the Glofly name and roles in its own constellation, and only while the
// player is a member there (not banned, not held by Lockdown).

const CODE_MS = LINK_CODE_MINUTES * 60_000;
const SECRET_SETTING = "game_link_code_secret";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

let secret: string | null = null;
async function codeSecret(): Promise<string> {
  if (secret) return secret;
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, SECRET_SETTING));
  if (row) return (secret = (row.value as { secret: string }).secret);
  await db.insert(serverSettings).values({ key: SECRET_SETTING, value: { secret: randomBytes(32).toString("base64url") } }).onConflictDoNothing();
  const [again] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, SECRET_SETTING));
  return (secret = (again!.value as { secret: string }).secret);
}

/** The 6 digits for a code row (salted so a new row for the same player gets a new code). */
async function digitsFor(rowId: string, salt: string): Promise<string> {
  const mac = createHmac("sha256", await codeSecret()).update(`${rowId}.${salt}`).digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

// ───────────── Identities ─────────────

const GAMES = ["fivem", "redm", "minecraft"] as const;

/** FiveM/RedM: the license (every player has one, never changes). Minecraft: the online-mode UUID. */
function identityFor(game: GameLinkGame, raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (game === "minecraft") {
    const hex = v.replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/.test(hex)) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return /^license:[0-9a-f]{40}$/.test(v) ? v : null;
}

const EXTRA_ID = /^(fivem:\d{1,20}|discord:\d{15,21}|steam:[0-9a-f]{15}|xbl:\d{1,20}|live:\d{1,20})$/;

/** In-game names are shown as text only; control characters and odd spacing removed. */
const cleanName = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);

export const lookupBody = z.object({
  game: z.enum(GAMES),
  identity: z.string().max(80),
  playerName: z.string().max(200).default(""),
  identities: z.array(z.string().max(60)).max(8).default([]),
});

type Standing = { allowed: boolean; reason?: "not_member" | "banned" | "account_locked"; timedOutUntil: string | null };

async function standing(constellationId: string, userId: string): Promise<Standing> {
  const [ban] = await db
    .select({ userId: constellationBans.userId })
    .from(constellationBans)
    .where(and(eq(constellationBans.constellationId, constellationId), eq(constellationBans.userId, userId)));
  if (ban) return { allowed: false, reason: "banned", timedOutUntil: null };
  const [m] = await db
    .select({ timedOutUntil: constellationMembers.timedOutUntil })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
  if (!m) return { allowed: false, reason: "not_member", timedOutUntil: null };
  if (await lockedDown(userId)) return { allowed: false, reason: "account_locked", timedOutUntil: null };
  const t = m.timedOutUntil && m.timedOutUntil.getTime() > Date.now() ? m.timedOutUntil.toISOString() : null;
  return { allowed: true, timedOutUntil: t };
}

async function roleList(constellationId: string, userId: string) {
  return db
    .select({ id: constellationRoles.id, name: constellationRoles.name, position: constellationRoles.position })
    .from(constellationMemberRoles)
    .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)))
    .orderBy(asc(constellationRoles.position));
}

const lastUse = new Map<string, number>();

/** The game server asks about a player (the bot API's /api/v1/links/lookup). */
export async function lookupPlayer(k: BotKey, body: z.infer<typeof lookupBody>): Promise<{ status: number; json: Record<string, unknown> }> {
  const identity = identityFor(body.game, body.identity);
  if (!identity) {
    return {
      status: 400,
      json: { error: "bad_request", message: body.game === "minecraft" ? "Send the player's Minecraft UUID (online-mode servers only)." : "Send the player's license: identifier (license:<40 hex>)." },
    };
  }
  const [link] = await db
    .select()
    .from(gameLinks)
    .where(and(eq(gameLinks.constellationId, k.constellationId), eq(gameLinks.game, body.game), eq(gameLinks.identity, identity)));
  if (link) {
    const s = await standing(k.constellationId, link.userId);
    if ((lastUse.get(link.id) ?? 0) < Date.now() - 60_000) {
      lastUse.set(link.id, Date.now());
      await db.update(gameLinks).set({ lastUsedAt: new Date() }).where(eq(gameLinks.id, link.id));
    }
    await logIntegration({
      constellationId: k.constellationId,
      keyId: k.id,
      keyName: k.name,
      action: "link.lookup",
      targetUserId: s.allowed ? link.userId : null,
      details: { allowed: s.allowed, game: body.game },
      ip: k.ip,
    });
    if (!s.allowed) return { status: 200, json: { linked: true, allowed: false, reason: s.reason } };
    const [u] = await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, link.userId));
    const roles = await roleList(k.constellationId, link.userId);
    const [c] = await db.select({ ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, k.constellationId));
    return { status: 200, json: { linked: true, allowed: true, user: u, owner: c?.ownerId === link.userId, roles, timedOutUntil: s.timedOutUntil } };
  }
  if (k.frozen) return { status: 200, json: { linked: false, code: null, reason: "frozen", message: "This constellation is paused by the Glofly team, so new links are off." } };

  // Not linked: the player's current code, or a new one.
  const now = new Date();
  const [existing] = await db
    .select()
    .from(gameLinkCodes)
    .where(and(eq(gameLinkCodes.constellationId, k.constellationId), eq(gameLinkCodes.game, body.game), eq(gameLinkCodes.identity, identity)));
  if (existing && existing.expiresAt > now && existing.keyId === k.id) {
    const digits = await digitsFor(existing.id, existing.createdAt.toISOString());
    return { status: 200, json: { linked: false, code: formatLinkCode(digits), expiresAt: existing.expiresAt.toISOString() } };
  }
  if (existing) await db.delete(gameLinkCodes).where(eq(gameLinkCodes.id, existing.id));
  const playerName = cleanName(body.playerName) || "a player";
  const extraIds = [...new Set(body.identities.map((x) => x.trim().toLowerCase()).filter((x) => EXTRA_ID.test(x)))];
  for (let tries = 0; tries < 6; tries++) {
    const id = randomUUID();
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const digits = await digitsFor(id, createdAt.toISOString());
    // A run-out code with the same digits makes room; a live one means try other digits.
    await db.delete(gameLinkCodes).where(and(eq(gameLinkCodes.codeHash, sha(digits)), lt(gameLinkCodes.expiresAt, now)));
    const expiresAt = new Date(createdAt.getTime() + CODE_MS);
    const [made] = await db
      .insert(gameLinkCodes)
      .values({ id, constellationId: k.constellationId, keyId: k.id, game: body.game, identity, extraIds, playerName, codeHash: sha(digits), expiresAt, createdAt })
      .onConflictDoNothing()
      .returning({ id: gameLinkCodes.id });
    if (made) {
      await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "link.code", details: { game: body.game }, ip: k.ip });
      return { status: 200, json: { linked: false, code: formatLinkCode(digits), expiresAt: expiresAt.toISOString() } };
    }
  }
  return { status: 503, json: { error: "busy", message: "Couldn't make a code just now. Try again in a moment." } };
}

export async function sweepGameLinkCodes(): Promise<void> {
  await db.delete(gameLinkCodes).where(lt(gameLinkCodes.expiresAt, new Date()));
}

// ───────────── The player's side ─────────────

export const gameLinksRouter = Router();
gameLinksRouter.use(requireAuth);

const me = (res: Response) => res.locals.user as { id: string };
const bad = (res: Response, message: string, status = 400) => res.status(status).json({ error: "bad_request", message });
const codeBody = z.object({ code: z.string().max(20) });

/** 10 tries per person and 30 per address every 15 minutes (codes are short; this keeps guessing useless). */
async function codeSlot(req: Request, res: Response): Promise<boolean> {
  try {
    const ok = await takeSlot(15 * 60_000, [
      { key: `linkcode:${me(res).id}`, limit: 10 },
      { key: `linkcodeip:${clientIp(req)}`, limit: 30 },
    ]);
    if (!ok) {
      res.set("Retry-After", "900");
      bad(res, "Too many codes tried. Wait a few minutes and try again.", 429);
      return false;
    }
  } catch (err) {
    noteRedisError(err);
  }
  return true;
}

type CodeRow = typeof gameLinkCodes.$inferSelect;

/** The live code these digits belong to, plus who's asking, after every check. */
async function checkedCode(req: Request, res: Response): Promise<{ row: CodeRow; constellationName: string; serverName: string; replaces: string | null; member: boolean } | null> {
  const parsed = codeBody.safeParse(req.body);
  const digits = parsed.success ? normalizeLinkCode(parsed.data.code) : null;
  if (!digits) return void bad(res, "Type the 6 digits the game is showing you."), null;
  if (!(await codeSlot(req, res))) return null;
  const userId = me(res).id;
  const [row] = await db.select().from(gameLinkCodes).where(and(eq(gameLinkCodes.codeHash, sha(digits)), gt(gameLinkCodes.expiresAt, new Date())));
  if (!row) return void bad(res, "That code doesn't work. Codes work once, for 10 minutes; ask the game for a new one.", 404), null;
  const [u] = await db.select({ bot: users.bot }).from(users).where(eq(users.id, userId));
  if (!u || u.bot) return void bad(res, "This account can't link game servers.", 403), null;
  if (await isRestricted(userId)) return void bad(res, MANAGED_BY_FAMILY.message, 403), null;
  if (await lockedDown(userId)) return void bad(res, "New accounts can't link game servers right now. Try again tomorrow.", 403), null;
  const [c] = await db
    .select({ name: constellations.name, frozenAt: constellations.frozenAt, takenDownAt: constellations.takenDownAt })
    .from(constellations)
    .where(eq(constellations.id, row.constellationId));
  if (!c || c.takenDownAt) return void bad(res, "That code doesn't work any more.", 404), null;
  if (c.frozenAt) return void bad(res, `${c.name} is paused by the Glofly team, so new links are off.`, 403), null;
  const s = await standing(row.constellationId, userId);
  if (s.reason === "banned") return void bad(res, `You can't link to ${c.name}'s server.`, 403), null;
  const [mine] = await db
    .select({ playerName: gameLinks.playerName })
    .from(gameLinks)
    .where(and(eq(gameLinks.userId, userId), eq(gameLinks.constellationId, row.constellationId), eq(gameLinks.game, row.game)));
  const serverName = serverNameFor(c.name, row.game as GameLinkGame);
  return { row, constellationName: c.name, serverName, replaces: mine?.playerName ?? null, member: s.reason !== "not_member" };
}

const serverNameFor = (constellationName: string, game: GameLinkGame) => `${constellationName}'s ${GAME_LINK_GAMES[game]} server`;

gameLinksRouter.get("/", async (_req, res) => {
  const rows = await db
    .select({ l: gameLinks, constellationName: constellations.name, ownerId: constellations.ownerId })
    .from(gameLinks)
    .innerJoin(constellations, eq(constellations.id, gameLinks.constellationId))
    .where(eq(gameLinks.userId, me(res).id))
    .orderBy(asc(gameLinks.createdAt));
  const ids = [...new Set(rows.map((r) => r.l.constellationId))];
  const held = ids.length
    ? await db
        .select({ constellationId: constellationMemberRoles.constellationId, name: constellationRoles.name, position: constellationRoles.position })
        .from(constellationMemberRoles)
        .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
        .where(and(eq(constellationMemberRoles.userId, me(res).id), inArray(constellationMemberRoles.constellationId, ids)))
        .orderBy(asc(constellationRoles.position))
    : [];
  const servers: LinkedGameServer[] = rows.map((r) => ({
    id: r.l.id,
    game: r.l.game as GameLinkGame,
    serverName: r.l.serverName,
    constellationId: r.l.constellationId,
    constellationName: r.constellationName,
    playerName: r.l.playerName,
    roles: [...(r.ownerId === r.l.userId ? ["Owner"] : []), ...held.filter((h) => h.constellationId === r.l.constellationId).map((h) => h.name)],
    createdAt: r.l.createdAt.toISOString(),
    lastUsedAt: r.l.lastUsedAt?.toISOString() ?? null,
  }));
  res.json({ servers });
});

gameLinksRouter.post("/preview", async (req, res) => {
  const c = await checkedCode(req, res);
  if (!c) return;
  const preview: GameLinkPreview = {
    game: c.row.game as GameLinkGame,
    serverName: c.serverName,
    constellationId: c.row.constellationId,
    constellationName: c.constellationName,
    playerName: c.row.playerName,
    member: c.member,
    replaces: c.replaces,
  };
  res.json({ preview });
});

gameLinksRouter.post("/", async (req, res) => {
  const c = await checkedCode(req, res);
  if (!c) return;
  if (!c.member) return void bad(res, `Join ${c.constellationName} on Glofly first, then type the code again.`, 403);
  const userId = me(res).id;
  const done = await db.transaction(async (tx) => {
    // One use: whoever deletes the code links.
    const [taken] = await tx.delete(gameLinkCodes).where(and(eq(gameLinkCodes.id, c.row.id), gt(gameLinkCodes.expiresAt, new Date()))).returning({ id: gameLinkCodes.id });
    if (!taken) return "gone" as const;
    const [other] = await tx
      .select({ id: gameLinks.id })
      .from(gameLinks)
      .where(and(eq(gameLinks.constellationId, c.row.constellationId), eq(gameLinks.game, c.row.game), eq(gameLinks.identity, c.row.identity)));
    if (other) return "taken" as const;
    await tx.delete(gameLinks).where(and(eq(gameLinks.userId, userId), eq(gameLinks.constellationId, c.row.constellationId), eq(gameLinks.game, c.row.game)));
    const [made] = await tx
      .insert(gameLinks)
      .values({
        userId,
        constellationId: c.row.constellationId,
        keyId: c.row.keyId,
        serverName: c.serverName,
        game: c.row.game,
        identity: c.row.identity,
        extraIds: c.row.extraIds,
        playerName: c.row.playerName,
      })
      .returning({ id: gameLinks.id });
    return made.id;
  });
  if (done === "gone") return void bad(res, "That code was just used or ran out. Ask the game for a new one.", 404);
  if (done === "taken") return void bad(res, "That player is already linked to a Glofly account.", 409);
  await logIntegration({
    constellationId: c.row.constellationId,
    keyId: c.row.keyId,
    actorId: userId,
    action: "link.made",
    details: { game: c.row.game, player: c.row.playerName, replaced: c.replaces },
    ip: clientIp(req),
  });
  res.json({ ok: true, id: done, serverName: c.serverName });
});

gameLinksRouter.delete("/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) return void bad(res, "Not found.", 404);
  const [gone] = await db
    .delete(gameLinks)
    .where(and(eq(gameLinks.id, id.data), eq(gameLinks.userId, me(res).id)))
    .returning({ constellationId: gameLinks.constellationId, keyId: gameLinks.keyId, game: gameLinks.game, playerName: gameLinks.playerName });
  if (!gone) return void bad(res, "Not found.", 404);
  await logIntegration({
    constellationId: gone.constellationId,
    keyId: gone.keyId,
    actorId: me(res).id,
    action: "link.removed",
    details: { game: gone.game, player: gone.playerName },
    ip: clientIp(req),
  });
  res.json({ ok: true });
});
