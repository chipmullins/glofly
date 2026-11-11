import { isIP } from "node:net";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  API_KEY_ALLOWED_IPS_MAX,
  API_KEY_LIFETIMES,
  API_KEY_NAME_MAX,
  API_KEYS_PER_CONSTELLATION_MAX,
  WEBHOOKS_PER_CONSTELLATION_MAX,
  WEBHOOK_EVENTS,
  isWebhookEvent,
  type WebhookPayload,
  INTEGRATION_SCOPES,
  NEBULA_SCOPES,
  isIntegrationScope,
  type ApiKeyInfo,
  type IntegrationScope,
} from "@glofly/shared";
import { db } from "../db";
import { constellationApiKeys, constellationMemberRoles, constellationRoles, constellationWebhooks, constellations, nebulas, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { verifyPassword } from "../auth/passwords";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";
import { rateLimit } from "../rateLimit";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { addMember, ConstellationFull, removeMember } from "../constellations/members";
import { syncNebulaAccess, visibleNebulaIds } from "../constellations/access";
import { setNebulaShown } from "../constellations/onboarding";
import { constellationChanged } from "../constellations/activity";
import { activityFor, createBotUser, keyInfo, logIntegration, newKey } from "./keys";
import { normalizeIp } from "./ip";
import { webhookAddressProblem } from "../messages/links";
import { deliver, hookTokenHash, hookUrl, newHookToken, newSigningSecret, webhookInfo } from "./webhooks";
import { randomUUID } from "node:crypto";

// Communities round (Nov 2026): constellation settings → Integrations (approved mockup boards 1–3).
// Only the Owner, or a role with "Edit constellation settings", can see or change keys. Making,
// resetting or changing a key asks for the person's password again. Every change is logged in
// Integrations → Activity.
//
//   GET    /constellations/:id/integrations                    keys (never the secrets)
//   POST   /constellations/:id/integrations/keys               { name, roleId, scopes, postNebulaIds,
//                                                                readNebulaIds, allowedIps, lifetime, password }
//                                                              → { key, secret } (the secret, once)
//   PATCH  /constellations/:id/integrations/keys/:keyId        same fields (all optional) + password
//   POST   /constellations/:id/integrations/keys/:keyId/reset  { password } → { secret }
//   DELETE /constellations/:id/integrations/keys/:keyId
//   GET    /constellations/:id/integrations/activity?before=
//   POST   /constellations/:id/integrations/hooks           incoming { kind, name, nebulaId, roleId, password }
//                                                              → { hook, url } (the address, once)
//                                                            outgoing { kind, name, url, events, password }
//                                                              → { hook, secret } (the signing secret, once)
//   PATCH  /constellations/:id/integrations/hooks/:hookId    { name?, events?, url?, enabled?, password }
//   POST   /constellations/:id/integrations/hooks/:hookId/reset { password } → { url } or { secret }
//   POST   /constellations/:id/integrations/hooks/:hookId/test  outgoing: sends a "ping" → { status }
//   DELETE /constellations/:id/integrations/hooks/:hookId

export const integrationsRouter = Router();
integrationsRouter.use("/:id/integrations", requireAuth);

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", message });

integrationsRouter.use("/:id/integrations", async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

const changeLimiter = rateLimit("integrations:change", {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of key changes. Try again later." },
});

/** I can manage this constellation's integrations: Owner or "Edit constellation settings". */
async function manager(req: Request, res: Response): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't available.", 404);
    return null;
  }
  if (!can(s, "manageConstellation")) {
    bad(res, "Only people who can edit this constellation's settings can manage its integrations.", 403);
    return null;
  }
  return s;
}

async function passwordOk(userId: string, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || !password || password.length > 200) return false;
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  return !!u && (await verifyPassword(u.hash, password).catch(() => false));
}

const keyName = z
  .string()
  .transform((s) => s.normalize("NFKC").trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, "Give the key a name.")
      .max(API_KEY_NAME_MAX, `Names can be up to ${API_KEY_NAME_MAX} characters.`)
      .refine((t) => !/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/.test(t), "Names can't contain hidden characters."),
  );

const fields = z.object({
  name: keyName,
  roleId: idParam.nullable(),
  scopes: z.array(z.string()).max(INTEGRATION_SCOPES.length),
  postNebulaIds: z.array(idParam).max(50).default([]),
  readNebulaIds: z.array(idParam).max(50).default([]),
  allowedIps: z.array(z.string().trim().max(45)).max(API_KEY_ALLOWED_IPS_MAX).default([]),
  lifetime: z.enum(API_KEY_LIFETIMES.map((l) => l.id) as [string, ...string[]]).default("never"),
});

type Checked = {
  roleId: string | null;
  scopes: IntegrationScope[];
  postNebulaIds: string[];
  readNebulaIds: string[];
  allowedIps: string[];
};

/** Checks what a key asks for against the constellation and what I'm allowed to give. */
async function check(
  s: Standing,
  input: { roleId: string | null; scopes: string[]; postNebulaIds: string[]; readNebulaIds: string[]; allowedIps: string[] },
): Promise<Checked | string> {
  const scopes = [...new Set(input.scopes)];
  if (!scopes.every(isIntegrationScope)) return "Pick what the key can do from the list.";
  if (input.roleId) {
    const [role] = await db
      .select()
      .from(constellationRoles)
      .where(and(eq(constellationRoles.id, input.roleId), eq(constellationRoles.constellationId, s.constellationId)));
    if (!role || role.kind === "member" || role.selfAssign) return "Pick a role from the list for the bot.";
    // Like giving a person a role: only roles below mine.
    if (!s.owner && role.position >= s.rank) return "You can only give the bot a role below your own.";
  }
  const wanted = [...new Set([...input.postNebulaIds, ...input.readNebulaIds])];
  if (wanted.length) {
    const found = await db
      .select({ id: nebulas.id })
      .from(nebulas)
      .where(and(eq(nebulas.constellationId, s.constellationId), inArray(nebulas.id, wanted)));
    if (found.length !== wanted.length) return "Pick nebulas from this constellation.";
    // A key can never reach a nebula its maker can't see (role-only or not picked yet).
    const mine = await visibleNebulaIds(s.constellationId, s.userId);
    if (!wanted.every((id) => mine.has(id))) return "Pick nebulas you can see.";
  }
  const postNebulaIds = scopes.includes("messages:write") ? [...new Set(input.postNebulaIds)] : [];
  const readNebulaIds = scopes.includes("messages:read") ? [...new Set(input.readNebulaIds)] : [];
  for (const scope of NEBULA_SCOPES) {
    if (scopes.includes(scope) && !(scope === "messages:write" ? postNebulaIds : readNebulaIds).length)
      return scope === "messages:write" ? "Pick at least one nebula it can post in." : "Pick at least one nebula it can read.";
  }
  const allowedIps: string[] = [];
  for (const raw of input.allowedIps) {
    if (!raw) continue;
    if (!isIP(raw)) return `"${raw.slice(0, 45)}" isn't an IP address (like 203.0.113.24).`;
    allowedIps.push(normalizeIp(raw));
  }
  return { roleId: input.roleId, scopes: scopes as IntegrationScope[], postNebulaIds, readNebulaIds, allowedIps: [...new Set(allowedIps)] };
}

/** The bot's one non-Member role (null = only Member). */
async function botRole(constellationId: string, botId: string): Promise<string | null> {
  const [r] = await db
    .select({ roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, botId)));
  return r?.roleId ?? null;
}

async function listKeys(constellationId: string): Promise<ApiKeyInfo[]> {
  const rows = await db
    .select({ key: constellationApiKeys, bot: { id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion } })
    .from(constellationApiKeys)
    .innerJoin(users, eq(users.id, constellationApiKeys.botUserId))
    .where(eq(constellationApiKeys.constellationId, constellationId))
    .orderBy(asc(constellationApiKeys.createdAt));
  const out: ApiKeyInfo[] = [];
  for (const r of rows) {
    let createdBy: { id: string; displayName: string } | null = null;
    if (r.key.createdBy) {
      const [c] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, r.key.createdBy));
      createdBy = c ?? null;
    }
    out.push(keyInfo(r.key, r.bot, await botRole(constellationId, r.bot.id), createdBy));
  }
  return out;
}

const expiryFor = (lifetime: string): Date | null => {
  const days = API_KEY_LIFETIMES.find((l) => l.id === lifetime)?.days ?? null;
  return days ? new Date(Date.now() + days * 24 * 3600_000) : null;
};

/** Gives the bot exactly this role (or none) and refreshes which nebulas it's in. */
/**
 * A key's or webhook's bot ranks at or above me (by its role): only someone higher, or the Owner,
 * may change, reset or delete it. Otherwise resetting it would hand me a bot above my rank.
 */
async function botOutranksMe(s: Standing, botUserId: string | null): Promise<boolean> {
  if (s.owner || !botUserId) return false;
  const roleId = await botRole(s.constellationId, botUserId);
  if (!roleId) return false;
  const [r] = await db.select({ position: constellationRoles.position }).from(constellationRoles).where(eq(constellationRoles.id, roleId));
  return !!r && r.position >= s.rank;
}
const TOO_HIGH = "This bot's role is at or above yours, so ask someone higher to change it.";

/** Optional nebulas (onboarding) a key works in are shown to its bot, so it really can see them. */
async function showOptionalTo(constellationId: string, botId: string, nebulaIds: string[]): Promise<void> {
  if (!nebulaIds.length) return;
  const optional = await db
    .select({ id: nebulas.id })
    .from(nebulas)
    .where(and(eq(nebulas.constellationId, constellationId), inArray(nebulas.id, nebulaIds), eq(nebulas.optional, true)));
  for (const n of optional) await setNebulaShown(constellationId, botId, n.id, true);
  if (optional.length) await syncNebulaAccess(constellationId, { userIds: [botId] });
}

async function setBotRole(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], constellationId: string, botId: string, roleId: string | null) {
  await tx
    .delete(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, botId)));
  if (roleId) await tx.insert(constellationMemberRoles).values({ constellationId, userId: botId, roleId });
  await syncNebulaAccess(constellationId, { userIds: [botId], tx });
}

async function writable(s: Standing, res: Response): Promise<boolean> {
  if (await frozen(s.constellationId)) {
    bad(res, FROZEN_MESSAGE, 403);
    return false;
  }
  if (await lockedDown(s.userId)) {
    res.status(403).json(LOCKDOWN_MESSAGE);
    return false;
  }
  return true;
}

// GET /constellations/:id/integrations
integrationsRouter.get("/:id/integrations", async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  res.json({ keys: await listKeys(s.constellationId), hooks: await listHooks(s.constellationId) });
});

// POST /constellations/:id/integrations/keys
integrationsRouter.post("/:id/integrations/keys", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const parsed = fields.safeParse(req.body);
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "Check the key's details.");
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  const count = await db.$count(constellationApiKeys, eq(constellationApiKeys.constellationId, s.constellationId));
  if (count >= API_KEYS_PER_CONSTELLATION_MAX) {
    bad(res, `A constellation can have up to ${API_KEYS_PER_CONSTELLATION_MAX} keys. Delete one you don't use first.`);
    return;
  }
  const checked = await check(s, parsed.data);
  if (typeof checked === "string") {
    bad(res, checked);
    return;
  }
  const key = newKey();
  let keyId: string;
  try {
    keyId = await db.transaction(async (tx) => {
      // One at a time per constellation (the member limit and key count are checked inside).
      await tx.select({ id: constellations.id }).from(constellations).where(eq(constellations.id, s.constellationId)).for("update");
      const botId = await createBotUser(tx, parsed.data.name);
      await addMember(tx, s.constellationId, botId, { welcomed: true });
      await setBotRole(tx, s.constellationId, botId, checked.roleId);
      const [row] = await tx
        .insert(constellationApiKeys)
        .values({
          constellationId: s.constellationId,
          botUserId: botId,
          name: parsed.data.name,
          keyPrefix: key.prefix,
          keyHash: key.hash,
          scopes: checked.scopes,
          postNebulaIds: checked.postNebulaIds,
          readNebulaIds: checked.readNebulaIds,
          allowedIps: checked.allowedIps,
          expiresAt: expiryFor(parsed.data.lifetime),
          createdBy: s.userId,
        })
        .returning({ id: constellationApiKeys.id });
      return row.id;
    });
  } catch (err) {
    if (err instanceof ConstellationFull) {
      bad(res, "This constellation is full, so there's no room for a bot.");
      return;
    }
    throw err;
  }
  const [made] = await db.select({ botUserId: constellationApiKeys.botUserId }).from(constellationApiKeys).where(eq(constellationApiKeys.id, keyId));
  if (made) await showOptionalTo(s.constellationId, made.botUserId, [...checked.postNebulaIds, ...checked.readNebulaIds]);
  await logIntegration({ constellationId: s.constellationId, keyId, keyName: parsed.data.name, actorId: s.userId, action: "key.created", details: { scopes: checked.scopes } });
  await constellationChanged(s.constellationId);
  const info = (await listKeys(s.constellationId)).find((k) => k.id === keyId)!;
  res.set("Cache-Control", "no-store");
  res.status(201).json({ key: info, secret: key.secret });
});

/** The key (in this constellation) named in the address, or a 404. */
async function keyFor(req: Request, res: Response, s: Standing) {
  const keyId = idParam.safeParse(req.params.keyId);
  const [row] = keyId.success
    ? await db
        .select()
        .from(constellationApiKeys)
        .where(and(eq(constellationApiKeys.id, keyId.data), eq(constellationApiKeys.constellationId, s.constellationId)))
    : [];
  if (!row) bad(res, "That key isn't there any more.", 404);
  return row ?? null;
}

// PATCH /constellations/:id/integrations/keys/:keyId
integrationsRouter.patch("/:id/integrations/keys/:keyId", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const row = await keyFor(req, res, s);
  if (!row) return;
  const parsed = fields.partial().safeParse(req.body);
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "Check the key's details.");
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  const currentRole = await botRole(s.constellationId, row.botUserId);
  // Someone can't change a key whose bot ranks at or above them (the Owner can change any).
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  const d = parsed.data;
  const checked = await check(s, {
    roleId: d.roleId !== undefined ? d.roleId : currentRole,
    scopes: d.scopes ?? row.scopes,
    postNebulaIds: d.postNebulaIds ?? row.postNebulaIds,
    readNebulaIds: d.readNebulaIds ?? row.readNebulaIds,
    allowedIps: d.allowedIps ?? row.allowedIps,
  });
  if (typeof checked === "string") {
    bad(res, checked);
    return;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(constellationApiKeys)
      .set({
        ...(d.name ? { name: d.name } : {}),
        scopes: checked.scopes,
        postNebulaIds: checked.postNebulaIds,
        readNebulaIds: checked.readNebulaIds,
        allowedIps: checked.allowedIps,
        ...(d.lifetime ? { expiresAt: expiryFor(d.lifetime) } : {}),
      })
      .where(eq(constellationApiKeys.id, row.id));
    if (d.name) await tx.update(users).set({ displayName: d.name }).where(eq(users.id, row.botUserId));
    if (checked.roleId !== currentRole) await setBotRole(tx, s.constellationId, row.botUserId, checked.roleId);
  });
  await showOptionalTo(s.constellationId, row.botUserId, [...checked.postNebulaIds, ...checked.readNebulaIds]);
  await logIntegration({ constellationId: s.constellationId, keyId: row.id, keyName: d.name ?? row.name, actorId: s.userId, action: "key.changed", details: { scopes: checked.scopes } });
  await constellationChanged(s.constellationId);
  res.json({ key: (await listKeys(s.constellationId)).find((k) => k.id === row.id) });
});

// POST /constellations/:id/integrations/keys/:keyId/reset — a new secret; the old one stops working.
integrationsRouter.post("/:id/integrations/keys/:keyId/reset", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const row = await keyFor(req, res, s);
  if (!row) return;
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  const key = newKey();
  await db
    .update(constellationApiKeys)
    .set({ keyHash: key.hash, keyPrefix: key.prefix, resetAt: new Date() })
    .where(eq(constellationApiKeys.id, row.id));
  await logIntegration({ constellationId: s.constellationId, keyId: row.id, keyName: row.name, actorId: s.userId, action: "key.reset" });
  res.set("Cache-Control", "no-store");
  res.json({ secret: key.secret, prefix: key.prefix });
});

// DELETE /constellations/:id/integrations/keys/:keyId — the key stops working and its bot leaves
// (its messages stay, like anyone who leaves).
integrationsRouter.delete("/:id/integrations/keys/:keyId", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const row = await keyFor(req, res, s);
  if (!row) return;
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  await db.delete(constellationApiKeys).where(eq(constellationApiKeys.id, row.id));
  await removeMember(s.constellationId, row.botUserId);
  await logIntegration({ constellationId: s.constellationId, keyName: row.name, actorId: s.userId, action: "key.deleted" });
  res.json({ ok: true });
});

// GET /constellations/:id/integrations/activity?before=<iso>
integrationsRouter.get("/:id/integrations/activity", async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  res.json({ items: await activityFor(s.constellationId, before) });
});


// ───────────── Webhooks ─────────────

async function listHooks(constellationId: string) {
  const rows = await db
    .select()
    .from(constellationWebhooks)
    .where(eq(constellationWebhooks.constellationId, constellationId))
    .orderBy(asc(constellationWebhooks.createdAt));
  return Promise.all(rows.map(async (r) => webhookInfo(r, r.botUserId ? await botRole(constellationId, r.botUserId) : null)));
}

const apiBase = (req: Request) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

const hookBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("incoming"), name: keyName, nebulaId: idParam, roleId: idParam.nullable().default(null) }),
  z.object({
    kind: z.literal("outgoing"),
    name: keyName,
    url: z.string().trim().max(500),
    events: z.array(z.string()).min(1, "Pick at least one event.").max(WEBHOOK_EVENTS.length),
  }),
]);

integrationsRouter.post("/:id/integrations/hooks", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const parsed = hookBody.safeParse(req.body);
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "Check the webhook's details.");
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  const count = await db.$count(constellationWebhooks, eq(constellationWebhooks.constellationId, s.constellationId));
  if (count >= WEBHOOKS_PER_CONSTELLATION_MAX) {
    bad(res, `A constellation can have up to ${WEBHOOKS_PER_CONSTELLATION_MAX} webhooks. Delete one you don't use first.`);
    return;
  }
  const d = parsed.data;
  if (d.kind === "incoming") {
    const checked = await check(s, { roleId: d.roleId, scopes: ["messages:write"], postNebulaIds: [d.nebulaId], readNebulaIds: [], allowedIps: [] });
    if (typeof checked === "string") {
      bad(res, checked);
      return;
    }
    const [n] = await db.select({ kind: nebulas.kind }).from(nebulas).where(eq(nebulas.id, d.nebulaId));
    if (n?.kind !== "text" && n?.kind !== "announcement") {
      bad(res, "Pick a text nebula.");
      return;
    }
    const token = newHookToken();
    let hookId: string;
    try {
      hookId = await db.transaction(async (tx) => {
        await tx.select({ id: constellations.id }).from(constellations).where(eq(constellations.id, s.constellationId)).for("update");
        const botId = await createBotUser(tx, d.name);
        await addMember(tx, s.constellationId, botId, { welcomed: true });
        await setBotRole(tx, s.constellationId, botId, checked.roleId);
        const [row] = await tx
          .insert(constellationWebhooks)
          .values({ constellationId: s.constellationId, kind: "incoming", name: d.name, nebulaId: d.nebulaId, botUserId: botId, tokenHash: hookTokenHash(token), createdBy: s.userId })
          .returning({ id: constellationWebhooks.id });
        return row.id;
      });
    } catch (err) {
      if (err instanceof ConstellationFull) {
        bad(res, "This constellation is full, so there's no room for the webhook's bot.");
        return;
      }
      throw err;
    }
    const [madeHook] = await db.select({ botUserId: constellationWebhooks.botUserId }).from(constellationWebhooks).where(eq(constellationWebhooks.id, hookId));
    if (madeHook?.botUserId) await showOptionalTo(s.constellationId, madeHook.botUserId, [d.nebulaId]);
    await logIntegration({ constellationId: s.constellationId, keyName: d.name, actorId: s.userId, action: "hook.created", details: { kind: "incoming" } });
    await constellationChanged(s.constellationId);
    const hook = (await listHooks(s.constellationId)).find((h) => h.id === hookId);
    res.set("Cache-Control", "no-store");
    res.status(201).json({ hook, url: hookUrl(apiBase(req), hookId, token) });
    return;
  }
  const problem = webhookAddressProblem(d.url);
  if (problem) {
    bad(res, problem);
    return;
  }
  if (!d.events.every(isWebhookEvent)) {
    bad(res, "Pick events from the list.");
    return;
  }
  const secret = newSigningSecret();
  const [row] = await db
    .insert(constellationWebhooks)
    .values({ constellationId: s.constellationId, kind: "outgoing", name: d.name, url: d.url, events: [...new Set(d.events)], signingSecret: secret, createdBy: s.userId })
    .returning();
  await logIntegration({ constellationId: s.constellationId, keyName: d.name, actorId: s.userId, action: "hook.created", details: { kind: "outgoing" } });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ hook: webhookInfo(row, null), secret });
});

async function hookFor(req: Request, res: Response, s: Standing) {
  const hookId = idParam.safeParse(req.params.hookId);
  const [row] = hookId.success
    ? await db
        .select()
        .from(constellationWebhooks)
        .where(and(eq(constellationWebhooks.id, hookId.data), eq(constellationWebhooks.constellationId, s.constellationId)))
    : [];
  if (!row) bad(res, "That webhook isn't there any more.", 404);
  return row ?? null;
}

integrationsRouter.patch("/:id/integrations/hooks/:hookId", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const row = await hookFor(req, res, s);
  if (!row) return;
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  const parsed = z
    .object({ name: keyName.optional(), url: z.string().trim().max(500).optional(), events: z.array(z.string()).min(1).max(WEBHOOK_EVENTS.length).optional(), enabled: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "Check the webhook's details.");
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  const d = parsed.data;
  if (row.kind === "incoming" && (d.url || d.events)) {
    bad(res, "Incoming webhooks don't have an address or events to change.");
    return;
  }
  if (d.url) {
    const problem = webhookAddressProblem(d.url);
    if (problem) {
      bad(res, problem);
      return;
    }
  }
  if (d.events && !d.events.every(isWebhookEvent)) {
    bad(res, "Pick events from the list.");
    return;
  }
  await db
    .update(constellationWebhooks)
    .set({
      ...(d.name ? { name: d.name } : {}),
      ...(d.url ? { url: d.url } : {}),
      ...(d.events ? { events: [...new Set(d.events)] } : {}),
      ...(d.enabled === true ? { disabledAt: null, failures: 0 } : d.enabled === false ? { disabledAt: new Date() } : {}),
    })
    .where(eq(constellationWebhooks.id, row.id));
  if (d.name && row.botUserId) await db.update(users).set({ displayName: d.name }).where(eq(users.id, row.botUserId));
  await logIntegration({ constellationId: s.constellationId, keyName: d.name ?? row.name, actorId: s.userId, action: "hook.changed" });
  res.json({ hook: (await listHooks(s.constellationId)).find((h) => h.id === row.id) });
});

integrationsRouter.post("/:id/integrations/hooks/:hookId/reset", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s || !(await writable(s, res))) return;
  const row = await hookFor(req, res, s);
  if (!row) return;
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  if (!(await passwordOk(s.userId, req.body?.password))) {
    bad(res, "That password isn't right.", 403);
    return;
  }
  await logIntegration({ constellationId: s.constellationId, keyName: row.name, actorId: s.userId, action: "hook.reset", details: { kind: row.kind } });
  res.set("Cache-Control", "no-store");
  if (row.kind === "incoming") {
    const token = newHookToken();
    await db.update(constellationWebhooks).set({ tokenHash: hookTokenHash(token) }).where(eq(constellationWebhooks.id, row.id));
    res.json({ url: hookUrl(apiBase(req), row.id, token) });
  } else {
    const secret = newSigningSecret();
    await db.update(constellationWebhooks).set({ signingSecret: secret }).where(eq(constellationWebhooks.id, row.id));
    res.json({ secret });
  }
});

integrationsRouter.post("/:id/integrations/hooks/:hookId/test", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const row = await hookFor(req, res, s);
  if (!row) return;
  if (row.kind !== "outgoing" || !row.url || !row.signingSecret) {
    bad(res, "Only outgoing webhooks can be tested.");
    return;
  }
  const payload: WebhookPayload = { id: randomUUID(), type: "ping", constellationId: s.constellationId, createdAt: new Date().toISOString(), data: {} };
  const status = await deliver({ id: row.id, url: row.url, signingSecret: row.signingSecret, constellationId: s.constellationId, name: row.name }, payload);
  await logIntegration({ constellationId: s.constellationId, keyName: row.name, actorId: s.userId, action: "hook.test", details: { status } });
  res.json({ status, ok: status >= 200 && status < 300 });
});

integrationsRouter.delete("/:id/integrations/hooks/:hookId", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const row = await hookFor(req, res, s);
  if (!row) return;
  if (await botOutranksMe(s, row.botUserId)) {
    bad(res, TOO_HIGH, 403);
    return;
  }
  await db.delete(constellationWebhooks).where(eq(constellationWebhooks.id, row.id));
  if (row.botUserId) await removeMember(s.constellationId, row.botUserId);
  await logIntegration({ constellationId: s.constellationId, keyName: row.name, actorId: s.userId, action: "hook.deleted" });
  res.json({ ok: true });
});
