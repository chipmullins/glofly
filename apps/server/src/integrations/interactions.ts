import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { COMMAND_TEXT_MAX, parseSlashCommand, type ConstellationCommand, type InteractionPayload } from "@glofly/shared";
import { db } from "../db";
import {
  constellationApiKeys,
  constellationCommands,
  constellationMemberRoles,
  conversationMembers,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { safePost } from "../messages/links";
import { postScheduledText } from "../messages/routes";
import { frozen, FROZEN_MESSAGE, standingOf } from "../constellations/perms";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";
import { signature } from "./events";
import { isToolBot, toolButton } from "../tools/tools";
import { logIntegration } from "./keys";

// Communities round (Nov 2026): bots in chats (approved mockup board 4).
//
//   GET  /constellations/:id/commands                               the / menu (members)
//   POST /constellations/:id/commands/run      { nebulaId, input }  "/whitelist apply": posts my
//        message (every normal check: timeouts, read-only, frozen, Lockdown, AutoMod) and tells the bot
//   POST /constellations/:id/messages/:messageId/buttons/:buttonId  a click on a bot's button
//
// The bot hears about both at its interactions address (set with PUT /api/v1/interactions), signed
// like outgoing webhooks. Glofly passes the member's roles along; what a click is allowed to do is
// the bot's decision, and anything it does after goes through the API's own rank checks.

export const interactionsRouter = Router();
interactionsRouter.use(["/:id/commands", "/:id/messages/:messageId/buttons"], requireAuth);

const me = (res: Response) => res.locals.user as { id: string; username: string; displayName: string };
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", message });
const idParam = z.uuid();

const runLimiter = rateLimit("integrations:run", {
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of commands. Wait a minute." },
});
const clickLimiter = rateLimit("integrations:click", {
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of clicking. Wait a minute." },
});

/** I'm a member here (restricted accounts never are). */
async function member(req: Request, res: Response) {
  const id = idParam.safeParse(req.params.id);
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return null;
  }
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) bad(res, "That constellation isn't available.", 404);
  return s;
}

/** Tells a bot about a command or a click. Resolves with the HTTP status (0 = no answer). */
async function tellBot(keyId: string, payload: InteractionPayload): Promise<number> {
  const [k] = await db
    .select({ url: constellationApiKeys.interactionsUrl, secret: constellationApiKeys.interactionsSecret, name: constellationApiKeys.name })
    .from(constellationApiKeys)
    .where(eq(constellationApiKeys.id, keyId));
  if (!k?.url || !k.secret) return 0;
  const body = JSON.stringify(payload);
  const status = await safePost(k.url, body, { "Glofly-Signature": signature(k.secret, body), "Glofly-Event": `interaction.${payload.type}`, "Glofly-Delivery": payload.id });
  await logIntegration({ constellationId: payload.constellationId, keyId, keyName: k.name, action: `interaction.${payload.type}`, targetUserId: payload.user?.id ?? null, details: { status } });
  return status;
}

export async function heldRoles(constellationId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
  return rows.map((r) => r.roleId);
}

// GET /constellations/:id/commands
interactionsRouter.get("/:id/commands", async (req, res) => {
  const s = await member(req, res);
  if (!s) return;
  const rows = await db
    .select({ name: constellationCommands.name, description: constellationCommands.description, botId: users.id, botName: users.displayName, avatarVersion: users.avatarVersion })
    .from(constellationCommands)
    .innerJoin(constellationApiKeys, eq(constellationApiKeys.id, constellationCommands.keyId))
    .innerJoin(users, eq(users.id, constellationApiKeys.botUserId))
    .where(eq(constellationCommands.constellationId, s.constellationId))
    .orderBy(asc(constellationCommands.name));
  const commands: ConstellationCommand[] = rows.map((r) => ({ name: r.name, description: r.description, bot: { id: r.botId, displayName: r.botName, avatarVersion: r.avatarVersion } }));
  res.json({ commands });
});

// POST /constellations/:id/commands/run  { nebulaId, input: "/whitelist apply" }
interactionsRouter.post("/:id/commands/run", runLimiter, async (req, res) => {
  const s = await member(req, res);
  if (!s) return;
  const body = z.object({ nebulaId: idParam, input: z.string().max(COMMAND_TEXT_MAX + 40) }).safeParse(req.body);
  const parsed = body.success ? parseSlashCommand(body.data.input) : null;
  if (!body.success || !parsed) {
    bad(res, "That isn't a command.");
    return;
  }
  const [cmd] = await db
    .select({ keyId: constellationCommands.keyId })
    .from(constellationCommands)
    .where(and(eq(constellationCommands.constellationId, s.constellationId), eq(constellationCommands.name, parsed.name)));
  if (!cmd) {
    bad(res, `There's no /${parsed.name} command here.`, 404);
    return;
  }
  const [n] = await db
    .select({ conversationId: nebulas.conversationId, kind: nebulas.kind })
    .from(nebulas)
    .where(and(eq(nebulas.id, body.data.nebulaId), eq(nebulas.constellationId, s.constellationId)));
  if (!n || n.kind !== "text") {
    bad(res, "That nebula isn't available.", 404);
    return;
  }
  // My message, sent like any other (so everything that stops me posting stops the command too).
  const sent = await postScheduledText(n.conversationId, s.userId, `/${parsed.name}${parsed.text ? ` ${parsed.text}` : ""}`, null);
  if (!sent.ok) {
    bad(res, sent.reason, 403);
    return;
  }
  const u = me(res);
  const status = await tellBot(cmd.keyId, {
    id: randomUUID(),
    type: "command",
    constellationId: s.constellationId,
    nebulaId: body.data.nebulaId,
    messageId: sent.messageId,
    user: { id: u.id, username: u.username, displayName: u.displayName },
    roleIds: await heldRoles(s.constellationId, s.userId),
    command: parsed,
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, messageId: sent.messageId, delivered: status >= 200 && status < 300 });
});

// POST /constellations/:id/messages/:messageId/buttons/:buttonId
interactionsRouter.post("/:id/messages/:messageId/buttons/:buttonId", clickLimiter, async (req, res) => {
  const s = await member(req, res);
  if (!s) return;
  const messageId = idParam.safeParse(req.params.messageId);
  const buttonId = String(req.params.buttonId ?? "");
  const [m] = messageId.success
    ? await db
        .select({ id: messages.id, senderId: messages.senderId, buttons: messages.buttons, deletedAt: messages.deletedAt, conversationId: messages.conversationId, nebulaId: nebulas.id })
        .from(messages)
        .innerJoin(nebulas, eq(nebulas.conversationId, messages.conversationId))
        .where(and(eq(messages.id, messageId.data), eq(nebulas.constellationId, s.constellationId)))
    : [];
  // I must be able to see that nebula (role-only ones), and the button must be on the message.
  const [sees] = m
    ? await db
        .select({ u: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, m.conversationId), eq(conversationMembers.userId, s.userId)))
    : [];
  if (!m || m.deletedAt || !sees || !m.buttons?.some((b) => b.id === buttonId)) {
    bad(res, "That button isn't there any more.", 404);
    return;
  }
  // Communities round: Glofly tools' own buttons (tickets, button roles, giveaways) are handled here.
  if (await isToolBot(s.constellationId, m.senderId)) {
    if (s.timedOutUntil) return void bad(res, "You're timed out for now.", 403);
    const r = await toolButton(s.constellationId, m.id, buttonId, s.userId);
    return void res.status(r.ok ? 200 : 403).json(r.ok ? { ok: true, delivered: true, message: r.message } : { error: "forbidden", message: r.message });
  }
  const [k] = await db.select({ id: constellationApiKeys.id }).from(constellationApiKeys).where(eq(constellationApiKeys.botUserId, m.senderId));
  if (!k) {
    bad(res, "That bot isn't connected any more.", 404);
    return;
  }
  if (s.timedOutUntil) {
    bad(res, "You're timed out for now.", 403);
    return;
  }
  if (await frozen(s.constellationId)) {
    bad(res, FROZEN_MESSAGE, 403);
    return;
  }
  if (await lockedDown(s.userId)) {
    res.status(403).json(LOCKDOWN_MESSAGE);
    return;
  }
  const u = me(res);
  const status = await tellBot(k.id, {
    id: randomUUID(),
    type: "button",
    constellationId: s.constellationId,
    nebulaId: m.nebulaId,
    messageId: m.id,
    user: { id: u.id, username: u.username, displayName: u.displayName },
    roleIds: await heldRoles(s.constellationId, s.userId),
    button: { id: buttonId },
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, delivered: status >= 200 && status < 300 });
});
