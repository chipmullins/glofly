import { nicknamesFor } from "../profile/nicknames";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { attachmentSummary, listNames, shortBody, type Attachment } from "@glofly/shared";
import { db } from "../db";
import { constellationMembers, constellations, conversationMembers, pushDevices, users } from "../db/schema";
import { blockedEitherWay } from "../friends/rules";
import { liveSessions } from "../realtime";
import { pushConfigured, sendPush, type PushData } from "./fcm";
import { forgetTokens } from "./devices";
import { isPaused } from "../admin/pause";
import { alertFor } from "../constellations/activity";
import { nebulaOfChat } from "../constellations/chats";

// What phones are told, and when. Every push is a data message the Glofly app turns into a
// notification (see apps/mobile). The rules:
//
// - Never to the phone you're using Glofly on right now (its live connection is open, so the
//   app already shows the message), and never to the sender.
// - Muted chats stay quiet, except for messages that @mention you.
// - Do not disturb: no message notifications (calls still show, silently: see calls).
// - "Show message preview" off on a phone: "New message" instead of the text.
// - Reading a chat on any device clears its notification on your other phones.

type Device = { token: string; sessionId: string; preview: boolean; platform: string; messageSound?: string | null; ringtone?: string | null };

/** Sends to every device given, forgetting tokens Firebase says are gone. */
async function deliver(list: { device: Device; data: PushData; ttl?: number }[]): Promise<void> {
  // "Pause Glofly": nothing goes out to phones while paused.
  if (!list.length || (await isPaused())) return;
  const results = await Promise.all(
    list.map((p) => sendPush(p.device.token, p.data, p.ttl, p.device.platform, { messageSound: p.device.messageSound, ringtone: p.device.ringtone })),
  );
  await forgetTokens(list.filter((_, i) => results[i] === "gone").map((p) => p.device.token));
}

const firstName = (name: string, username: string) => name.trim().split(/\s+/)[0] || username;

const PREVIEW_MAX = 300;

/** What notifyMessage needs to know about a message (the server's own message shape fits). */
type NewMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: Date | string;
  event: unknown;
  mentions?: string[];
  attachments: Pick<Attachment, "kind" | "name" | "voice">[];
};

/** The notification for a new message, to everyone in the chat who should get one. */
export async function notifyMessage(
  message: NewMessage,
  chat: { kind: "dm" | "group" | "nebula"; memberIds: string[]; name: string | null; photoVersion?: string | null },
): Promise<void> {
  if (!pushConfigured || message.event) return;
  // Nebulas (0.7.0): only phones whose app can open them, by each person's nebula settings.
  if (chat.kind === "nebula") return notifyNebula(message, chat.memberIds);
  const recipients = chat.memberIds.filter((id) => id !== message.senderId);
  if (!recipients.length) return;

  const devices = await db
    .select({
      userId: pushDevices.userId,
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
      status: users.statusPreference,
      mutedUntil: conversationMembers.mutedUntil,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.userId, pushDevices.userId),
        eq(conversationMembers.conversationId, message.conversationId),
      ),
    )
    .where(inArray(pushDevices.userId, recipients));
  if (!devices.length) return;

  const people = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username, avatarVersion: users.avatarVersion })
    .from(users)
    .where(inArray(users.id, chat.memberIds));
  const sender = people.find((p) => p.id === message.senderId);
  if (!sender) return;
  const live = await liveSessions([...new Set(devices.map((d) => d.userId))]);

  const text = (shortBody(message.body) || attachmentSummary(message.attachments)).slice(0, PREVIEW_MAX);
  const now = Date.now();
  const out: { device: Device; data: PushData }[] = [];
  const blocked = new Map<string, boolean>();

  for (const d of devices) {
    if (live.get(d.userId)?.has(d.sessionId)) continue;
    const mention = !!message.mentions?.includes(d.userId);
    const muted = d.mutedUntil !== null && d.mutedUntil.getTime() > now;
    if (muted && !mention) continue;
    if (d.status === "dnd") continue;
    if (chat.kind === "group") {
      // Inside a shared group, someone you blocked (or who blocked you) doesn't reach you.
      if (!blocked.has(d.userId)) blocked.set(d.userId, await blockedEitherWay(d.userId, message.senderId));
      if (blocked.get(d.userId)) continue;
    }
    // Their nicknames for people, if any (only they see them).
    const nicks = await nicknamesFor(d.userId).catch(() => undefined);
    const nameOf = (p: { id: string; displayName: string }) => nicks?.get(p.id) ?? p.displayName;
    const senderName = nameOf(sender);
    // A group without a name is called after the others in it (everyone but the reader).
    const groupTitle =
      chat.kind === "group"
        ? chat.name ||
          listNames(people.filter((p) => p.id !== d.userId).map((p) => firstName(nameOf(p), p.username)))
        : "";
    out.push({
      device: d,
      data: {
        type: "message",
        conversationId: message.conversationId,
        messageId: message.id,
        chatKind: chat.kind,
        chatTitle: groupTitle,
        groupPhoto: chat.kind === "group" ? (chat.photoVersion ?? "") : "",
        senderId: sender.id,
        senderName,
        senderAvatar: sender.avatarVersion ?? "",
        title: chat.kind === "group" ? `${senderName} · ${groupTitle}` : senderName,
        text: d.preview ? text : "New message",
        preview: d.preview ? "1" : "0",
        mention: mention ? "1" : "0",
        sentAt: new Date(message.createdAt).toISOString(),
      },
    });
  }
  await deliver(out);
}

/** You read a chat (or sent in it): its notification goes away on your other phones. */
export async function notifyRead(userId: string, conversationId: string, exceptSessionId?: string): Promise<void> {
  if (!pushConfigured) return;
  const devices = await db
    .select({ token: pushDevices.token, sessionId: pushDevices.sessionId, preview: pushDevices.preview, platform: pushDevices.platform })
    .from(pushDevices)
    .where(
      exceptSessionId
        ? and(eq(pushDevices.userId, userId), ne(pushDevices.sessionId, exceptSessionId))
        : eq(pushDevices.userId, userId),
    );
  // Short-lived: a clear that arrives days later doesn't matter.
  await deliver(devices.map((device) => ({ device, data: { type: "clear", conversationId }, ttl: 60 * 60 })));
}

/** "Maya Patel sent you a friend request" (not in Do not disturb). */
export async function notifyFriendRequest(
  toUserId: string,
  from: { id: string; displayName: string; avatarVersion: string | null },
): Promise<void> {
  if (!pushConfigured) return;
  const devices = await db
    .select({
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
      status: users.statusPreference,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(eq(pushDevices.userId, toUserId));
  const live = (await liveSessions([toUserId])).get(toUserId);
  await deliver(
    devices
      .filter((d) => d.status !== "dnd" && !live?.has(d.sessionId))
      .map((device) => ({
        device,
        data: {
          type: "friend_request",
          userId: from.id,
          senderName: from.displayName,
          senderAvatar: from.avatarVersion ?? "",
          title: from.displayName,
          text: "sent you a friend request",
        },
      })),
  );
}

/** Runs a push in the background: it must never slow down or break the request that caused it. */
export function inBackground(task: Promise<unknown>): void {
  task.catch((err) => console.error("Push failed", err));
}

/** "Maya is online" (0.3.0), to the phones of someone who asked for it that aren't open right now. */
export async function notifyFriendOnline(
  toUserId: string,
  who: { id: string; displayName: string; avatarVersion: string | null },
): Promise<void> {
  if (!pushConfigured) return;
  const devices = await db
    .select({
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
    })
    .from(pushDevices)
    .where(eq(pushDevices.userId, toUserId));
  if (!devices.length) return;
  const live = (await liveSessions([toUserId])).get(toUserId);
  const nicks = await nicknamesFor(toUserId).catch(() => undefined);
  const name = nicks?.get(who.id) ?? who.displayName;
  await deliver(
    devices
      .filter((d) => !live?.has(d.sessionId))
      .map((device) => ({
        device,
        // Stale after a while: "is online" from an hour ago isn't news.
        ttl: 15 * 60,
        data: {
          type: "friend_online",
          userId: who.id,
          senderName: name,
          senderAvatar: who.avatarVersion ?? "",
          title: name,
          text: "is online",
        },
      })),
  );
}

/** "Maya joined Glofly from your invite" (0.3.0): you're friends now. */
export async function notifyFriendJoined(
  toUserId: string,
  who: { id: string; displayName: string; avatarVersion: string | null },
): Promise<void> {
  if (!pushConfigured) return;
  const devices = await db
    .select({
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
      status: users.statusPreference,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(eq(pushDevices.userId, toUserId));
  const live = (await liveSessions([toUserId])).get(toUserId);
  await deliver(
    devices
      .filter((d) => d.status !== "dnd" && !live?.has(d.sessionId))
      .map((device) => ({
        device,
        data: {
          type: "friend_joined",
          userId: who.id,
          senderName: who.displayName,
          senderAvatar: who.avatarVersion ?? "",
          title: who.displayName,
          text: "joined Glofly from your invite. You're friends now!",
        },
      })),
  );
}

/**
 * 0.5.0 friend news ("is free to hang", "is live", "🎂 birthday today") to phones and browsers
 * that aren't open right now. Sent as the 0.3.0 friend alert types so every phone app already
 * shows them (tap opens their profile): "friend_online" for news that goes stale soon,
 * "friend_joined" for news that lasts the day. Skipped while you're on Do not disturb.
 */
export async function notifyFriendNews(
  toUserId: string,
  who: { id: string; displayName: string; avatarVersion: string | null },
  text: string,
  lasts: "soon" | "day",
): Promise<void> {
  if (!pushConfigured) return;
  const devices = await db
    .select({
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
      status: users.statusPreference,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(eq(pushDevices.userId, toUserId));
  if (!devices.length) return;
  const live = (await liveSessions([toUserId])).get(toUserId);
  const nicks = await nicknamesFor(toUserId).catch(() => undefined);
  const name = nicks?.get(who.id) ?? who.displayName;
  await deliver(
    devices
      .filter((d) => d.status !== "dnd" && !live?.has(d.sessionId))
      .map((device) => ({
        device,
        ttl: lasts === "soon" ? 30 * 60 : 12 * 60 * 60,
        data: {
          type: lasts === "soon" ? "friend_online" : "friend_joined",
          userId: who.id,
          senderName: name,
          senderAvatar: who.avatarVersion ?? "",
          title: name,
          text,
        },
      })),
  );
}

/**
 * A nebula message (0.7.0): a notification on phones whose Glofly can open nebulas (they register
 * with the "constellations" feature; older apps get nothing, like before). Who gets one follows
 * the same rules as the desktop's ding (constellations/activity.ts alertFor): the nebula's
 * "Notify me about" setting (or the constellation's default), timed mutes (@mentions still come
 * through), never for "Nothing". Not to the sender, the phone in use, Do not disturb, or across a
 * block. Tapping it opens glofly://chat/<conversationId>, which the app turns into that nebula.
 */
async function notifyNebula(message: NewMessage, memberIds: string[]): Promise<void> {
  const recipients = memberIds.filter((id) => id !== message.senderId);
  if (!recipients.length) return;
  const nebula = await nebulaOfChat(message.conversationId);
  if (!nebula) return;
  const devices = await db
    .select({
      userId: pushDevices.userId,
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      preview: pushDevices.preview,
      platform: pushDevices.platform,
      messageSound: pushDevices.messageSound,
      status: users.statusPreference,
      level: conversationMembers.notifyLevel,
      mutedUntil: conversationMembers.mutedUntil,
      defaultLevel: constellationMembers.notify,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.userId, pushDevices.userId), eq(conversationMembers.conversationId, message.conversationId)),
    )
    .innerJoin(
      constellationMembers,
      and(eq(constellationMembers.userId, pushDevices.userId), eq(constellationMembers.constellationId, nebula.constellationId)),
    )
    .where(and(inArray(pushDevices.userId, recipients), sql`'constellations' = any(${pushDevices.features})`));
  if (!devices.length) return;
  const [c] = await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, nebula.constellationId));
  const [sender] = await db
    .select({ id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion })
    .from(users)
    .where(eq(users.id, message.senderId));
  if (!c || !sender) return;
  const live = await liveSessions([...new Set(devices.map((d) => d.userId))]);
  const text = (shortBody(message.body) || attachmentSummary(message.attachments)).slice(0, PREVIEW_MAX);
  const now = Date.now();
  const blocked = new Map<string, boolean>();
  const out: { device: Device; data: PushData }[] = [];
  for (const d of devices) {
    if (live.get(d.userId)?.has(d.sessionId)) continue;
    if (d.status === "dnd") continue;
    const mention = !!message.mentions?.includes(d.userId);
    if (!alertFor(d.level ?? d.defaultLevel, d.mutedUntil, mention, now)) continue;
    if (!blocked.has(d.userId)) blocked.set(d.userId, await blockedEitherWay(d.userId, message.senderId));
    if (blocked.get(d.userId)) continue;
    const nicks = await nicknamesFor(d.userId).catch(() => undefined);
    const senderName = nicks?.get(sender.id) ?? sender.displayName;
    const shown = d.preview ? text : "New message";
    // Android draws it as a conversation titled "#nebula · Constellation"; iPhone shows
    // "Name · #nebula" over "Constellation: text" (like the approved lock-screen mockup).
    out.push({
      device: d,
      data: {
        type: "message",
        conversationId: message.conversationId,
        messageId: message.id,
        chatKind: "group",
        chatTitle: `#${nebula.name} · ${c.name}`,
        groupPhoto: "",
        senderId: sender.id,
        senderName,
        senderAvatar: sender.avatarVersion ?? "",
        title: `${senderName} · #${nebula.name}`,
        text: d.platform === "ios" ? `${c.name}: ${shown}` : shown,
        preview: d.preview ? "1" : "0",
        mention: mention ? "1" : "0",
        sentAt: new Date(message.createdAt).toISOString(),
        nebula: "1",
        thread: `constellation:${nebula.constellationId}`,
      },
    });
  }
  await deliver(out);
}
