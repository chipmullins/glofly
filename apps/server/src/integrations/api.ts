import { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { MESSAGE_MAX, type IntegrationScope } from "@glofly/shared";
import { db } from "../db";
import { constellationApiKeys, constellationMemberRoles, constellationMembers, constellationRoles, constellations, nebulas, users } from "../db/schema";
import { takeSlot, noteRedisError } from "../rateLimit";
import { postScheduledText } from "../messages/routes";
import { hashKey, logIntegration, looksLikeKey } from "./keys";
import { clientIp } from "./ip";

// Communities round (Nov 2026): the bot API, for game servers and bots with a constellation API key
// (Integrations). Versioned under /api/v1 so Glofly's own app changes never break a server's script.
// Behind the Pause gate like everything else (index.ts mounts it after refuseWhilePaused).
//
//   Authorization: Bot gfk_…   (a Bearer session token never works here, and a key never works
//                               anywhere else)
//
//   GET  /api/v1/me                          the bot, its constellation and scopes
//   GET  /api/v1/roles                       members:read
//   GET  /api/v1/members/:userId             members:read  → member + roles, or 404
//   POST /api/v1/nebulas/:nebulaId/messages  messages:write (only nebulas picked for the key) { text }
//
// Every request is rate limited per key (and per constellation), checked against the key's address
// list, and logged in Integrations → Activity. Errors are JSON { error, message }.

export const botApiRouter = Router();

/** Per key: 120 requests a minute; per constellation (all its keys together): 600. */
const KEY_PER_MINUTE = 120;
const CONSTELLATION_PER_MINUTE = 600;

export type BotKey = {
  id: string;
  name: string;
  constellationId: string;
  constellationName: string;
  frozen: boolean;
  botUserId: string;
  botName: string;
  scopes: Set<IntegrationScope>;
  postNebulaIds: string[];
  readNebulaIds: string[];
  ip: string;
};
const keyOf = (res: Response): BotKey => res.locals.botKey as BotKey;

const fail = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });

/** Last-used is written at most once a minute per key. */
const lastWrite = new Map<string, number>();

async function requireBotKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.set("Cache-Control", "no-store");
  const header = req.get("authorization") ?? "";
  const match = /^Bot\s+(\S+)$/.exec(header);
  if (!match || !looksLikeKey(match[1])) {
    fail(res, 401, "unauthorized", "Send your constellation API key as: Authorization: Bot gfk_…");
    return;
  }
  const now = new Date();
  const [row] = await db
    .select({
      key: constellationApiKeys,
      constellationName: constellations.name,
      takenDownAt: constellations.takenDownAt,
      frozenAt: constellations.frozenAt,
      botName: users.displayName,
    })
    .from(constellationApiKeys)
    .innerJoin(constellations, eq(constellations.id, constellationApiKeys.constellationId))
    .innerJoin(users, eq(users.id, constellationApiKeys.botUserId))
    .where(
      and(
        eq(constellationApiKeys.keyHash, hashKey(match[1])),
        or(isNull(constellationApiKeys.expiresAt), gt(constellationApiKeys.expiresAt, now)),
      ),
    );
  if (!row || row.takenDownAt) {
    fail(res, 401, "unauthorized", "That key doesn't work. It may have been reset, deleted or expired.");
    return;
  }
  const k = row.key;
  const ip = clientIp(req);
  if (k.allowedIps.length && !k.allowedIps.includes(ip)) {
    await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "refused.address", ip });
    fail(res, 403, "address_not_allowed", "This key only works from the addresses chosen in Integrations.");
    return;
  }
  try {
    const ok = await takeSlot(60_000, [
      { key: `apikey:${k.id}`, limit: KEY_PER_MINUTE },
      { key: `apikeycx:${k.constellationId}`, limit: CONSTELLATION_PER_MINUTE },
    ]);
    if (!ok) {
      res.set("Retry-After", "60");
      fail(res, 429, "too_many_requests", `Slow down: up to ${KEY_PER_MINUTE} requests a minute per key.`);
      return;
    }
  } catch (err) {
    // Redis is down: let the request through rather than breaking every server's whitelist.
    noteRedisError(err);
  }
  if ((lastWrite.get(k.id) ?? 0) < Date.now() - 60_000) {
    lastWrite.set(k.id, Date.now());
    await db.update(constellationApiKeys).set({ lastUsedAt: now, lastUsedIp: ip }).where(eq(constellationApiKeys.id, k.id));
  }
  res.locals.botKey = {
    id: k.id,
    name: k.name,
    constellationId: k.constellationId,
    constellationName: row.constellationName,
    frozen: !!row.frozenAt,
    botUserId: k.botUserId,
    botName: row.botName,
    scopes: new Set(k.scopes as IntegrationScope[]),
    postNebulaIds: k.postNebulaIds,
    readNebulaIds: k.readNebulaIds,
    ip,
  } satisfies BotKey;
  next();
}

botApiRouter.use("/api/v1", (req, res, next) => void requireBotKey(req, res, next).catch(next));

/** The key has this scope (refused and logged otherwise). */
async function needs(res: Response, scope: IntegrationScope): Promise<boolean> {
  const k = keyOf(res);
  if (k.scopes.has(scope)) return true;
  await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "refused.scope", details: { scope }, ip: k.ip });
  fail(res, 403, "missing_scope", `This key doesn't have the "${scope}" permission. Add it in Integrations.`);
  return false;
}

const idParam = z.uuid();

botApiRouter.get("/api/v1/me", (_req, res) => {
  const k = keyOf(res);
  res.json({
    bot: { id: k.botUserId, name: k.botName },
    constellation: { id: k.constellationId, name: k.constellationName, frozen: k.frozen },
    scopes: [...k.scopes],
    postNebulaIds: k.postNebulaIds,
  });
});

async function rolesOf(constellationId: string) {
  return db
    .select({ id: constellationRoles.id, name: constellationRoles.name, color: constellationRoles.color, position: constellationRoles.position, kind: constellationRoles.kind, selfAssign: constellationRoles.selfAssign })
    .from(constellationRoles)
    .where(eq(constellationRoles.constellationId, constellationId))
    .orderBy(asc(constellationRoles.position));
}

botApiRouter.get("/api/v1/roles", async (_req, res) => {
  if (!(await needs(res, "members:read"))) return;
  const k = keyOf(res);
  const roles = await rolesOf(k.constellationId);
  await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "roles.read", ip: k.ip });
  res.json({ roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, everyone: r.kind === "member", label: r.selfAssign })) });
});

botApiRouter.get("/api/v1/members/:userId", async (req, res) => {
  if (!(await needs(res, "members:read"))) return;
  const k = keyOf(res);
  const userId = idParam.safeParse(req.params.userId);
  if (!userId.success) {
    fail(res, 404, "not_found", "Not a member.");
    return;
  }
  const [m] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      bot: users.bot,
      joinedAt: constellationMembers.joinedAt,
      timedOutUntil: constellationMembers.timedOutUntil,
    })
    .from(constellationMembers)
    .innerJoin(users, eq(users.id, constellationMembers.userId))
    .where(and(eq(constellationMembers.constellationId, k.constellationId), eq(constellationMembers.userId, userId.data)));
  await logIntegration({
    constellationId: k.constellationId,
    keyId: k.id,
    keyName: k.name,
    action: "member.lookup",
    targetUserId: m ? m.id : null,
    details: { member: !!m },
    ip: k.ip,
  });
  if (!m) {
    fail(res, 404, "not_found", "Not a member.");
    return;
  }
  const held = await db
    .select({ id: constellationRoles.id, name: constellationRoles.name, position: constellationRoles.position, selfAssign: constellationRoles.selfAssign })
    .from(constellationMemberRoles)
    .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
    .where(and(eq(constellationMemberRoles.constellationId, k.constellationId), eq(constellationMemberRoles.userId, m.id)))
    .orderBy(asc(constellationRoles.position));
  const timedOut = m.timedOutUntil && m.timedOutUntil.getTime() > Date.now() ? m.timedOutUntil.toISOString() : null;
  res.json({
    member: {
      id: m.id,
      username: m.username,
      displayName: m.displayName,
      avatarVersion: m.avatarVersion,
      bot: m.bot,
      joinedAt: m.joinedAt.toISOString(),
      timedOutUntil: timedOut,
      roles: held.map((r) => ({ id: r.id, name: r.name, position: r.position, label: r.selfAssign })),
    },
  });
});

const postBody = z.object({ text: z.string().trim().min(1, "Send some text.").max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters.`) });

botApiRouter.post("/api/v1/nebulas/:nebulaId/messages", async (req, res) => {
  if (!(await needs(res, "messages:write"))) return;
  const k = keyOf(res);
  const nebulaId = idParam.safeParse(req.params.nebulaId);
  if (!nebulaId.success || !k.postNebulaIds.includes(nebulaId.data)) {
    fail(res, 403, "nebula_not_allowed", "This key can only post in the nebulas picked for it in Integrations.");
    return;
  }
  const body = postBody.safeParse(req.body);
  if (!body.success) {
    fail(res, 400, "invalid", body.error.issues[0]?.message ?? "Send { text }.");
    return;
  }
  const [n] = await db
    .select({ conversationId: nebulas.conversationId, name: nebulas.name, kind: nebulas.kind })
    .from(nebulas)
    .where(and(eq(nebulas.id, nebulaId.data), eq(nebulas.constellationId, k.constellationId)));
  if (!n || n.kind !== "text") {
    fail(res, 404, "not_found", "That nebula isn't there (or isn't a text nebula).");
    return;
  }
  // The same path as a person's message: who can post, frozen, timeouts, read-only nebulas, AutoMod.
  const sent = await postScheduledText(n.conversationId, k.botUserId, body.data.text, null);
  if (!sent.ok) {
    fail(res, 403, "cant_post", sent.reason);
    return;
  }
  await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "message.post", details: { nebula: n.name }, ip: k.ip });
  res.status(201).json({ ok: true });
});

// Anything else under /api/v1 (after a valid key).
botApiRouter.use("/api/v1", (_req, res) => fail(res, 404, "not_found", "There's nothing at that address in the Glofly API."));
