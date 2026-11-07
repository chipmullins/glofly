import { randomInt, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { cleanNebulaName, type MessageButton } from "@glofly/shared";
import { db } from "../db";
import {
  constellationCategories,
  constellationGiveaways,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellationTickets,
  constellationTools,
  constellations,
  giveawayEntries,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { postScheduledText } from "../messages/routes";
import { createNebula } from "../constellations/routes";
import { addMember } from "../constellations/members";
import { syncNebulaAccess } from "../constellations/access";
import { constellationChanged } from "../constellations/activity";
import { can, frozen, standingOf } from "../constellations/perms";
import { emitToUser } from "../realtime";
import { fireConstellationEvent } from "../integrations/events";
import { logIntegration } from "../integrations/keys";

// Communities round (Nov 2026): Glofly tools, built in and free (approved canvas board 15).
// They post as one "Glofly" member per constellation (constellations.tool_bot_id, a bot account that
// can't sign in), through the normal message path (so AutoMod, frozen and read-only still apply).
// Their buttons are handled here, not sent to any outside bot. Every setting is checked again.

export type ToolName = "tickets" | "welcome" | "buttonRoles" | "logging" | "giveaways";
export const TOOL_NAMES: readonly ToolName[] = ["tickets", "welcome", "buttonRoles", "logging", "giveaways"];

export type ToolSettings = {
  tickets: { nebulaId: string; staffRoleId: string | null; categoryId: string | null; label: string; text: string };
  welcome: { nebulaId: string; message: string };
  buttonRoles: { nebulaId: string; text: string; roleIds: string[] };
  logging: { nebulaId: string; joins: boolean; messages: boolean; roles: boolean; moderation: boolean };
  giveaways: Record<string, never>;
};

/** The "Glofly" member tools post as (made the first time a tool needs it). */
export async function toolBot(constellationId: string): Promise<string> {
  const [c] = await db.select({ toolBotId: constellations.toolBotId }).from(constellations).where(eq(constellations.id, constellationId));
  if (c?.toolBotId) return c.toolBotId;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ toolBotId: constellations.toolBotId }).from(constellations).where(eq(constellations.id, constellationId)).for("update");
    if (locked?.toolBotId) return locked.toolBotId;
    const id = randomUUID();
    await tx.insert(users).values({
      id,
      // "tool." marks the Glofly tools' member (the apps show a TOOL tag instead of BOT)
      username: `tool.${id.replace(/-/g, "").slice(0, 12)}`,
      displayName: "Glofly",
      email: `${id}@tools.glofly.invalid`,
      passwordHash: "!tool",
      birthday: "2000-01-01",
      termsAcceptedAt: new Date(),
      statusPreference: "invisible",
      bot: true,
    });
    await tx.update(constellations).set({ toolBotId: id }).where(eq(constellations.id, constellationId));
    await addMember(tx, constellationId, id, { welcomed: true });
    await syncNebulaAccess(constellationId, { userIds: [id], tx });
    return id;
  });
}

export async function toolRow<T extends ToolName>(constellationId: string, tool: T): Promise<{ enabled: boolean; settings: Partial<ToolSettings[T]>; messageId: string | null }> {
  const [r] = await db.select().from(constellationTools).where(and(eq(constellationTools.constellationId, constellationId), eq(constellationTools.tool, tool)));
  return { enabled: !!r?.enabled, settings: (r?.settings ?? {}) as Partial<ToolSettings[T]>, messageId: r?.messageId ?? null };
}

/** Posts as Glofly in a nebula of this constellation. Null when it couldn't (with why). */
export async function postAsTool(
  constellationId: string,
  nebulaId: string,
  text: string,
  buttons: MessageButton[] | null = null,
  replyToId: string | null = null,
): Promise<{ messageId: string } | { reason: string }> {
  const [n] = await db
    .select({ conversationId: nebulas.conversationId, kind: nebulas.kind })
    .from(nebulas)
    .where(and(eq(nebulas.id, nebulaId), eq(nebulas.constellationId, constellationId)));
  if (!n || n.kind !== "text") return { reason: "That nebula isn't there any more." };
  const bot = await toolBot(constellationId);
  const sent = await postScheduledText(n.conversationId, bot, text.slice(0, 4000), replyToId, buttons);
  return sent.ok ? { messageId: sent.messageId } : { reason: sent.reason };
}

const nameOf = async (userId: string) => {
  const [u] = await db.select({ displayName: users.displayName, username: users.username, bot: users.bot }).from(users).where(eq(users.id, userId));
  return u ?? null;
};

// ───────────── Welcome messages ─────────────

/** Someone joined: the welcome message (members.ts afterJoin). Never throws. */
export async function welcomeNewMember(constellationId: string, userId: string): Promise<void> {
  try {
    const w = await toolRow(constellationId, "welcome");
    if (!w.enabled || !w.settings.nebulaId || !w.settings.message) return;
    const u = await nameOf(userId);
    if (!u || u.bot) return;
    await postAsTool(constellationId, w.settings.nebulaId, w.settings.message.replace(/\{name\}/g, u.displayName));
  } catch (err) {
    console.error("Welcome message failed", err);
  }
}

// ───────────── Logging ─────────────

export type LogKind = "joins" | "messages" | "roles" | "moderation";

/** Copies something that happened to the staff log nebula, if Logging is on for that kind. Never throws. */
export async function toolLog(constellationId: string, kind: LogKind, text: string): Promise<void> {
  try {
    const l = await toolRow(constellationId, "logging");
    if (!l.enabled || !l.settings.nebulaId || l.settings[kind] === false) return;
    await postAsTool(constellationId, l.settings.nebulaId, text);
  } catch (err) {
    console.error("Logging failed", err);
  }
}

/** A line for the log, from someone's id ("Riley (@riley)"). */
export async function who(userId: string | null): Promise<string> {
  if (!userId) return "Someone";
  const u = await nameOf(userId);
  return u ? `${u.displayName} (@${u.username})` : "Someone";
}

// ───────────── Buttons on Glofly's messages ─────────────

/** True when this user is a constellation's tools member. */
export async function isToolBot(constellationId: string, userId: string): Promise<boolean> {
  const [c] = await db.select({ toolBotId: constellations.toolBotId }).from(constellations).where(eq(constellations.id, constellationId));
  return !!c?.toolBotId && c.toolBotId === userId;
}

/**
 * A click on one of Glofly's buttons (interactions.ts). Returns a sentence for the person who
 * clicked (shown as a toast), or throws nothing.
 */
export async function toolButton(constellationId: string, messageId: string, buttonId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  if (await frozen(constellationId)) return { ok: false, message: "This constellation is paused by the Glofly team." };
  if (buttonId === "tool-ticket-open") return openTicket(constellationId, userId);
  if (buttonId.startsWith("tool-ticket-close-")) return closeTicket(constellationId, buttonId.slice("tool-ticket-close-".length), userId);
  if (buttonId.startsWith("tool-role-")) return toggleRole(constellationId, buttonId.slice("tool-role-".length), userId);
  if (buttonId.startsWith("tool-give-")) return enterGiveaway(constellationId, buttonId.slice("tool-give-".length), userId);
  void messageId;
  return { ok: false, message: "That button doesn't do anything any more." };
}

// ───────────── Tickets ─────────────

async function openTicket(constellationId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  const t = await toolRow(constellationId, "tickets");
  if (!t.enabled) return { ok: false, message: "Tickets are switched off here." };
  const open = await db
    .select({ id: constellationTickets.id })
    .from(constellationTickets)
    .where(and(eq(constellationTickets.constellationId, constellationId), eq(constellationTickets.openerId, userId), isNull(constellationTickets.closedAt)));
  if (open.length >= 3) return { ok: false, message: "You already have 3 open tickets. Close one first." };
  const u = await nameOf(userId);
  if (!u) return { ok: false, message: "Something went wrong." };
  const bot = await toolBot(constellationId);
  const categoryId = t.settings.categoryId
    ? ((await db.select({ id: constellationCategories.id }).from(constellationCategories).where(and(eq(constellationCategories.id, t.settings.categoryId), eq(constellationCategories.constellationId, constellationId))))[0]?.id ?? null)
    : null;
  const staff = t.settings.staffRoleId ? [t.settings.staffRoleId] : [];
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${nebulas.position}), -1)::int` }).from(nebulas).where(eq(nebulas.constellationId, constellationId));
  const ticketId = randomUUID();
  const nebula = await db.transaction(async (tx) => {
    const n = await createNebula(tx, constellationId, {
      name: cleanNebulaName(`ticket ${u.username}`, "text") ?? "ticket",
      kind: "text",
      categoryId,
      topic: `A private ticket for ${u.displayName} and staff`,
      position: max + 1,
      // Only staff (and Owner/managers), plus the person who opened it and Glofly.
      visibility: "roles",
      roleIds: staff,
      userIds: [userId, bot],
    });
    await tx.insert(constellationTickets).values({ id: ticketId, constellationId, nebulaId: n.id, openerId: userId });
    return n;
  });
  await syncNebulaAccess(constellationId);
  await constellationChanged(constellationId);
  await postAsTool(
    constellationId,
    nebula.id,
    `Hi ${u.displayName}! Tell staff what you need here. Only you and staff can see this nebula.`,
    [{ id: `tool-ticket-close-${ticketId}`, label: "Close ticket", style: "danger" }],
  );
  await toolLog(constellationId, "moderation", `🎫 ${await who(userId)} opened a ticket (#${nebula.name}).`);
  return { ok: true, message: `Your ticket is open: #${nebula.name}.` };
}

async function closeTicket(constellationId: string, ticketId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  const [t] = await db.select().from(constellationTickets).where(and(eq(constellationTickets.id, ticketId), eq(constellationTickets.constellationId, constellationId)));
  if (!t || t.closedAt || !t.nebulaId) return { ok: false, message: "That ticket is already closed." };
  const s = await standingOf(constellationId, userId);
  const tools = await toolRow(constellationId, "tickets");
  const staff = !!s && (s.owner || can(s, "manageNebulas") || (!!tools.settings.staffRoleId && s.roleIds.includes(tools.settings.staffRoleId)));
  if (t.openerId !== userId && !staff) return { ok: false, message: "Only the person who opened it, or staff, can close a ticket." };
  // Closed: the opener can't see it any more and nobody can post; staff keep it as a record.
  await db.update(constellationTickets).set({ closedAt: new Date() }).where(eq(constellationTickets.id, t.id));
  const [n] = await db.update(nebulas).set({ userIds: [], readOnly: true, name: sql`left('closed-' || ${nebulas.name}, 60)` }).where(eq(nebulas.id, t.nebulaId)).returning({ name: nebulas.name });
  await syncNebulaAccess(constellationId);
  await constellationChanged(constellationId);
  await toolLog(constellationId, "moderation", `🎫 ${await who(userId)} closed a ticket (#${n?.name ?? "ticket"}).`);
  return { ok: true, message: "The ticket is closed." };
}

// ───────────── Button roles ─────────────

async function toggleRole(constellationId: string, roleId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  const b = await toolRow(constellationId, "buttonRoles");
  if (!b.enabled || !b.settings.roleIds?.includes(roleId)) return { ok: false, message: "That role button isn't set up any more." };
  // Only roles members may pick themselves (labels; never permissions or rank).
  const [role] = await db
    .select({ id: constellationRoles.id, name: constellationRoles.name })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.id, roleId), eq(constellationRoles.constellationId, constellationId), eq(constellationRoles.selfAssign, true), eq(constellationRoles.kind, "custom")));
  if (!role) return { ok: false, message: "That role can't be picked any more." };
  const [has] = await db
    .select({ r: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId), eq(constellationMemberRoles.roleId, roleId)));
  if (has) {
    await db.delete(constellationMemberRoles).where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId), eq(constellationMemberRoles.roleId, roleId)));
  } else {
    await db.insert(constellationMemberRoles).values({ constellationId, userId, roleId }).onConflictDoNothing();
  }
  await syncNebulaAccess(constellationId, { userIds: [userId] });
  await constellationChanged(constellationId);
  emitToUser(userId, "constellations:changed", {}, true);
  const held = await db.select({ r: constellationMemberRoles.roleId }).from(constellationMemberRoles).where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
  fireConstellationEvent(constellationId, "member.roles", userId, held.map((h) => h.r));
  return { ok: true, message: has ? `You don't have ${role.name} any more.` : `You now have ${role.name}.` };
}

// ───────────── Giveaways ─────────────

export async function startGiveaway(
  constellationId: string,
  by: string,
  v: { nebulaId: string; prize: string; winners: number; hours: number; roleId: string | null },
): Promise<{ id: string } | { reason: string }> {
  const id = randomUUID();
  const endsAt = new Date(Date.now() + v.hours * 3600_000);
  const role = v.roleId ? (await db.select({ name: constellationRoles.name }).from(constellationRoles).where(and(eq(constellationRoles.id, v.roleId), eq(constellationRoles.constellationId, constellationId))))[0] : null;
  if (v.roleId && !role) return { reason: "Pick a role from this constellation." };
  const ends = endsAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: process.env.GLOFLY_TIME_ZONE || "America/Chicago", timeZoneName: "short" });
  const text = `🎁 Giveaway: ${v.prize}\n${v.winners} ${v.winners === 1 ? "winner" : "winners"} · ends ${ends}${role ? ` · ${role.name} only` : ""}\nPress Enter to take part.`;
  const posted = await postAsTool(constellationId, v.nebulaId, text, [{ id: `tool-give-${id}`, label: "Enter", style: "primary" }]);
  if ("reason" in posted) return posted;
  await db.insert(constellationGiveaways).values({ id, constellationId, nebulaId: v.nebulaId, messageId: posted.messageId, prize: v.prize, winners: v.winners, roleId: v.roleId, endsAt, createdBy: by });
  await toolLog(constellationId, "moderation", `🎁 ${await who(by)} started a giveaway: ${v.prize}.`);
  return { id };
}

async function enterGiveaway(constellationId: string, giveawayId: string, userId: string): Promise<{ ok: boolean; message: string }> {
  const [g] = await db.select().from(constellationGiveaways).where(and(eq(constellationGiveaways.id, giveawayId), eq(constellationGiveaways.constellationId, constellationId)));
  if (!g || g.endedAt || g.endsAt.getTime() < Date.now()) return { ok: false, message: "This giveaway has ended." };
  const u = await nameOf(userId);
  if (!u || u.bot) return { ok: false, message: "Bots can't enter giveaways." };
  if (g.roleId) {
    const [has] = await db.select({ r: constellationMemberRoles.roleId }).from(constellationMemberRoles).where(and(eq(constellationMemberRoles.userId, userId), eq(constellationMemberRoles.roleId, g.roleId)));
    if (!has) return { ok: false, message: "This giveaway is for a role you don't have." };
  }
  const added = await db.insert(giveawayEntries).values({ giveawayId: g.id, userId }).onConflictDoNothing().returning({ u: giveawayEntries.userId });
  return { ok: true, message: added.length ? "You're in! Good luck." : "You're already in." };
}

/** Giveaways whose time is up: winners picked fairly (crypto randomInt), announced (index.ts, every minute). */
export async function sweepGiveaways(): Promise<void> {
  const due = await db.select().from(constellationGiveaways).where(and(isNull(constellationGiveaways.endedAt), lte(constellationGiveaways.endsAt, new Date()))).limit(20);
  for (const g of due) {
    const taken = await db.update(constellationGiveaways).set({ endedAt: new Date() }).where(and(eq(constellationGiveaways.id, g.id), isNull(constellationGiveaways.endedAt))).returning({ id: constellationGiveaways.id });
    if (!taken.length) continue; // another server got it
    const entries = await db
      .select({ userId: giveawayEntries.userId })
      .from(giveawayEntries)
      .innerJoin(constellationMembers, and(eq(constellationMembers.userId, giveawayEntries.userId), eq(constellationMembers.constellationId, g.constellationId)))
      .where(eq(giveawayEntries.giveawayId, g.id))
      .orderBy(asc(giveawayEntries.createdAt));
    const pool = entries.map((e) => e.userId);
    const winners: string[] = [];
    while (winners.length < g.winners && pool.length) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
    await db.update(constellationGiveaways).set({ winnerIds: winners }).where(eq(constellationGiveaways.id, g.id));
    const names = winners.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, winners)) : [];
    const text = winners.length
      ? `🎉 Giveaway ended: ${g.prize}\nCongratulations ${winners.map((id) => `@${names.find((n) => n.id === id)?.username ?? "someone"}`).join(", ")}! (${entries.length} took part)`
      : `Giveaway ended: ${g.prize}. Nobody entered, so there's no winner.`;
    await postAsTool(g.constellationId, g.nebulaId, text, null, g.messageId).catch((err) => console.error("Giveaway announcement failed", err));
    await logIntegration({ constellationId: g.constellationId, keyName: "Glofly tools", action: "giveaway.ended", details: { prize: g.prize, winners: winners.length, entries: entries.length } });
  }
}

/** Is this message one of Glofly's (for the button route)? */
export async function messageSender(messageId: string): Promise<string | null> {
  const [m] = await db.select({ senderId: messages.senderId }).from(messages).where(eq(messages.id, messageId));
  return m?.senderId ?? null;
}
