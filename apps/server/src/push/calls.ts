import { nameFor } from "../profile/nicknames";
import { eq, inArray } from "drizzle-orm";
import { listNames } from "@glofly/shared";
import { db } from "../db";
import { conversationMembers, conversations, pushDevices, users } from "../db/schema";
import { liveSessions } from "../realtime";
import { pushConfigured, sendPush, type DeviceSounds, type PushData } from "./fcm";
import { forgetTokens } from "./devices";
import { sendVoip, voipConfigured } from "./apns";

// Calls on phones. A phone that isn't showing Glofly has no live connection, so it learns about
// calls from pushes, which the app shows even while it's closed (the incoming-call screen on the
// lock screen). Each push is only a doorbell: answering still goes through the server, so a late
// or stale push can never join anyone to anything.
//
//   call_ring    someone is ringing you (until ringingUntil). In Do not disturb: dnd "1" (silent).
//   call_stop    stop ringing (answered on another device, declined, cancelled, timed out)
//   call_missed  "Missed video call from Jacob" once a call nobody answered is over
//
// After every change to a call (announceCall), syncCallPushes works out who started or stopped
// ringing since last time and pushes just those changes.

type CallInfo = {
  id: string;
  conversationId: string;
  callerId: string;
  video: boolean;
  status: string;
  members: { userId: string; state: "joined" | "ringing" | "out"; ringingUntil: string | null }[];
};
type Caller = { id: string; displayName: string; avatarVersion: string | null } | null;

/** Who each call's ring pushes went to, and until when (to spot people rung again). */
const ringing = new Map<string, Map<string, string>>();

async function devicesOf(userIds: string[]) {
  if (!userIds.length) return [];
  return db
    .select({
      userId: pushDevices.userId,
      token: pushDevices.token,
      sessionId: pushDevices.sessionId,
      platform: pushDevices.platform,
      voipToken: pushDevices.voipToken,
      messageSound: pushDevices.messageSound,
      ringtone: pushDevices.ringtone,
      status: users.statusPreference,
    })
    .from(pushDevices)
    .innerJoin(users, eq(users.id, pushDevices.userId))
    .where(inArray(pushDevices.userId, userIds));
}

/** What the chat is called for this reader: "" for a DM, else the group's name or the others' names. */
async function chatTitles(conversationId: string, readerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [chat] = await db
    .select({ kind: conversations.kind, name: conversations.name })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!chat || chat.kind === "dm") return out;
  if (chat.name) {
    for (const id of readerIds) out.set(id, chat.name);
    return out;
  }
  const people = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId));
  const first = (p: { displayName: string; username: string }) => p.displayName.trim().split(/\s+/)[0] || p.username;
  for (const id of readerIds) out.set(id, listNames(people.filter((p) => p.id !== id).map(first)));
  return out;
}

type Outgoing = { token: string; data: PushData; ttl: number; platform: string; voip?: string; sounds?: DeviceSounds };

async function send(list: Outgoing[]) {
  // iPhones with a VoIP token ring through Apple directly (CallKit, lock screen); the rest via Firebase.
  const results = await Promise.all(list.map((p) => (p.voip ? sendVoip(p.voip, p.data, p.ttl) : sendPush(p.token, p.data, p.ttl, p.platform, p.sounds))));
  await forgetTokens(list.filter((p, i) => !p.voip && results[i] === "gone").map((p) => p.token));
  const deadVoip = list.filter((p, i) => p.voip && results[i] === "gone").map((p) => p.voip!);
  if (deadVoip.length) await db.update(pushDevices).set({ voipToken: null }).where(inArray(pushDevices.voipToken, deadVoip));
}

export async function syncCallPushes(call: CallInfo, caller: Caller): Promise<void> {
  if (!pushConfigured) return;
  const before = ringing.get(call.id) ?? new Map<string, string>();
  const now = new Map<string, string>();
  for (const m of call.members) if (m.state === "ringing" && m.ringingUntil) now.set(m.userId, m.ringingUntil);

  const started = [...now].filter(([id, until]) => before.get(id) !== until).map(([id]) => id);
  const stopped = [...before.keys()].filter((id) => !now.has(id));
  const over = call.status !== "ringing" && call.status !== "ongoing";
  if (over) ringing.delete(call.id);
  else if (now.size) ringing.set(call.id, now);
  else ringing.delete(call.id);

  const missedBy =
    call.status === "missed" ? call.members.filter((m) => m.userId !== call.callerId && before.has(m.userId)).map((m) => m.userId) : [];
  const everyone = [...new Set([...started, ...stopped, ...missedBy])];
  if (!everyone.length) return;

  const devices = await devicesOf(everyone);
  if (!devices.length) return;
  const live = await liveSessions(everyone);
  const titles = await chatTitles(call.conversationId, everyone);
  const out: Outgoing[] = [];
  const callerNameOf = async (userId: string) => (caller ? await nameFor(userId, caller.id, caller.displayName) : "Someone");
  const base = {
    callId: call.id,
    conversationId: call.conversationId,
    video: call.video ? "1" : "0",
  };

  for (const d of devices) {
    const title = titles.get(d.userId) ?? "";
    const callerName = await callerNameOf(d.userId); // their nickname for the caller, if any
    if (started.includes(d.userId)) {
      // A phone with Glofly open shows the incoming call from its live connection instead.
      if (live.get(d.userId)?.has(d.sessionId)) continue;
      const until = now.get(d.userId)!;
      out.push({
        token: d.token,
        platform: d.platform,
        sounds: { messageSound: d.messageSound, ringtone: d.ringtone },
        // iPhone with lock-screen calls: a VoIP push (never in Do not disturb: iOS would ring anyway,
        // since every VoIP push must show a call; those get the silent notification instead).
        voip: d.platform === "ios" && d.voipToken && voipConfigured && d.status !== "dnd" ? d.voipToken : undefined,
        ttl: Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)),
        data: {
          type: "call_ring",
          ...base,
          callerId: call.callerId,
          callerName,
          callerAvatar: caller?.avatarVersion ?? "",
          group: title ? "1" : "0",
          chatTitle: title,
          ringingUntil: until,
          dnd: d.status === "dnd" ? "1" : "0",
        },
      });
    } else if (missedBy.includes(d.userId)) {
      // Missed: the ringing stops and the missed call shows (one push does both).
      out.push({
        token: d.token,
        platform: d.platform,
        sounds: { messageSound: d.messageSound, ringtone: d.ringtone },
        ttl: 24 * 60 * 60,
        data: {
          type: "call_missed",
          ...base,
          callerId: call.callerId,
          callerName,
          callerAvatar: caller?.avatarVersion ?? "",
          chatTitle: title,
          title: title ? `${callerName} · ${title}` : callerName,
          text: `Missed ${call.video ? "video" : "voice"} call`,
          dnd: d.status === "dnd" ? "1" : "0",
        },
      });
    } else if (stopped.includes(d.userId)) {
      out.push({ token: d.token, platform: d.platform, ttl: 60, data: { type: "call_stop", ...base, status: call.status } });
    }
  }
  await send(out);
}
