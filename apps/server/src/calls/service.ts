import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "../db";
import {
  callParticipants,
  calls,
  conversationMembers,
  conversations,
  messages,
  users,
  type CallStatus,
  type ChatEvent,
} from "../db/schema";
import { pair } from "../friends/rules";
import { emitToUser } from "../realtime";
import { sendUpdated } from "../messages/routes";
import { closeRoom, livekitConfigured, peopleInRoom, removeFromRoom } from "./livekit";
import { syncCallPushes } from "../push/calls";
import { forgetWatch, watcherLeft } from "./watch";

// How a call goes:
//
//   ringing ──someone answers──▶ ongoing ──everyone hangs up──▶ ended
//      │
//      ├─ the caller hangs up, or nobody answers in 23s ──▶ missed
//      └─ everyone rung declines ─────────────────────────▶ declined
//
// Each person has their own state too: ringing (rung in the last 23 seconds), joined, or out.
// 1-on-1: when either person hangs up, the call ends. Groups: people come and go; the call
// ends when the last person leaves, or once one person has been on their own for 7 minutes
// (they see a countdown for the last minute, with Stay). Anyone in the group can join a group
// call that's going on. 0.5.2: a group call can ring only some of the group (the rest can join),
// and Add people moves a 1-on-1 call into a new group without anyone dropping (calls/add.ts).
//
// Every change updates the call's line in the chat and tells everyone in the chat
// (`call:updated`), on every device, so they all stay in step.

/** How long someone is rung before it counts as missed (matches the ringtone and jingle). */
export { RING_MS } from "@glofly/shared";
import { CALL_SOLO_MS, RING_MS } from "@glofly/shared";
/** 1-on-1: the other person gone from the room this long ends the call. */
const DM_ALONE_MS = 45_000;
/** Groups: someone who joined but has been gone from the room this long counts as left. */
const MISSING_MS = 45_000;
/** Groups: one person on their own this long ends the call (7 minutes since 0.5.2). */
const GROUP_SOLO_MS = CALL_SOLO_MS;
/** No call lasts longer than this (a safety net for anything that went wrong). */
const LONGEST_CALL_MS = 12 * 60 * 60 * 1000;

const ACTIVE: CallStatus[] = ["ringing", "ongoing"];

export type CallRow = typeof calls.$inferSelect;
type Participant = typeof callParticipants.$inferSelect;
export type MemberState = { userId: string; state: "joined" | "ringing" | "out"; ringingUntil: string | null };

const isIn = (p: Participant | undefined) => !!p?.joinedAt && !p.leftAt;

/** Being rung right now: rung in the last 23s, hasn't answered (since) or declined. */
function ringingUntil(row: CallRow, p: Participant | undefined, now = Date.now()): number | null {
  if (!p?.invitedAt || !ACTIVE.includes(row.status) || isIn(p)) return null;
  const rung = p.invitedAt.getTime();
  if (p.declinedAt && p.declinedAt.getTime() >= rung) return null;
  if (p.leftAt && p.leftAt.getTime() >= rung) return null;
  const until = rung + RING_MS;
  return until > now ? until : null;
}

async function membersOf(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

async function participantsOf(callId: string): Promise<Participant[]> {
  return db.select().from(callParticipants).where(eq(callParticipants.callId, callId));
}

async function kindOf(conversationId: string): Promise<"dm" | "group"> {
  const [c] = await db.select({ kind: conversations.kind }).from(conversations).where(eq(conversations.id, conversationId));
  return c?.kind ?? "dm";
}

/** Where everyone in the chat stands in this call. */
async function statesFor(row: CallRow): Promise<MemberState[]> {
  const members = await membersOf(row.conversationId);
  const parts = await participantsOf(row.id);
  const now = Date.now();
  return members.map((userId) => {
    const p = parts.find((x) => x.userId === userId);
    const until = ringingUntil(row, p, now);
    return {
      userId,
      state: isIn(p) && ACTIVE.includes(row.status) ? "joined" : until ? "ringing" : "out",
      ringingUntil: until ? new Date(until).toISOString() : null,
    };
  });
}

/** Group calls with one person on their own: when the call ends (null otherwise). */
function soloEndsAt(row: CallRow): string | null {
  const since = row.status === "ongoing" ? missingSince.get(`${row.id}:solo`) : undefined;
  return since === undefined ? null : new Date(since + GROUP_SOLO_MS).toISOString();
}

/** What the apps get about a call. */
export async function describe(row: CallRow, endReason: "alone" | null = null) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    callerId: row.callerId,
    video: row.video,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    members: await statesFor(row),
    // 0.5.2 (older apps ignore these): the on-your-own countdown, and why it ended.
    soloEndsAt: soloEndsAt(row),
    endReason,
  };
}

async function publicUser(userId: string) {
  const [person] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion })
    .from(users)
    .where(eq(users.id, userId));
  return person ?? null;
}

/** Tells everyone in the call's chat (all their devices) where the call stands. */
export async function announceCall(
  row: CallRow,
  alsoTell: string[] = [],
  endReason: "alone" | null = null,
): Promise<void> {
  const payload = { call: await describe(row, endReason), caller: await publicUser(row.callerId) };
  for (const userId of new Set([...(await membersOf(row.conversationId)), ...alsoTell])) {
    emitToUser(userId, "call:updated", payload);
  }
  // Phones that aren't showing Glofly: ring, stop ringing, or a missed call.
  syncCallPushes(payload.call, payload.caller).catch((err) => console.error("Call push failed", err));
}

export async function reload(callId: string): Promise<CallRow | null> {
  const [row] = await db.select().from(calls).where(eq(calls.id, callId));
  return row ?? null;
}

/** The call someone is in right now (joined and not left), if any. */
export async function activeCallOf(userId: string): Promise<CallRow | null> {
  const [row] = await db
    .select({ call: calls })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(
      and(
        eq(callParticipants.userId, userId),
        isNotNull(callParticipants.joinedAt),
        isNull(callParticipants.leftAt),
        inArray(calls.status, ACTIVE),
      ),
    )
    .limit(1);
  return row?.call ?? null;
}

/** Am I in this call right now? */
export async function isInCall(callId: string, userId: string): Promise<boolean> {
  const [p] = await db
    .select()
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)));
  return isIn(p);
}

/** Ringing and ongoing calls in my chats (to show an incoming call, or rejoin one, after a restart). */
export async function activeCallsFor(userId: string): Promise<CallRow[]> {
  const rows = await db
    .select({ call: calls })
    .from(calls)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, calls.conversationId), eq(conversationMembers.userId, userId)),
    )
    .where(inArray(calls.status, ACTIVE));
  return rows.map((r) => r.call);
}

/** The call's line in the chat, matching its current state. */
function lineFor(row: CallRow): ChatEvent {
  const durationSec =
    row.status === "ended" && row.answeredAt && row.endedAt
      ? Math.max(0, Math.round((row.endedAt.getTime() - row.answeredAt.getTime()) / 1000))
      : null;
  return { type: "call", callId: row.id, video: row.video, status: row.status, durationSec };
}

async function refreshLine(row: CallRow): Promise<void> {
  if (!row.messageId) return;
  await db.update(messages).set({ event: lineFor(row) }).where(eq(messages.id, row.messageId));
  await sendUpdated(row.messageId, row.conversationId);
}

// Ring timers, one per person rung. When one runs out, apps are told (their ringing stops) and
// a call nobody answered becomes missed. The sweep catches any that a server restart forgot.
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();
const timerKey = (callId: string, userId: string) => `${callId}:${userId}`;

function startRinging(callId: string, userId: string): void {
  stopRinging(callId, userId);
  ringTimers.set(
    timerKey(callId, userId),
    setTimeout(() => {
      ringTimers.delete(timerKey(callId, userId));
      afterRinging(callId).catch((err) => console.error("Couldn't finish ringing:", err));
    }, RING_MS + 250),
  );
}

function stopRinging(callId: string, userId?: string): void {
  for (const [key, timer] of ringTimers) {
    if (userId ? key === timerKey(callId, userId) : key.startsWith(`${callId}:`)) {
      clearTimeout(timer);
      ringTimers.delete(key);
    }
  }
}

/** Someone stopped ringing: if nobody's left ringing a call nobody answered, it's over. */
async function afterRinging(callId: string): Promise<void> {
  const row = await reload(callId);
  if (!row || !ACTIVE.includes(row.status)) return;
  if (row.status === "ringing") {
    const parts = await participantsOf(callId);
    const now = Date.now();
    const stillRinging = parts.some((p) => ringingUntil(row, p, now) !== null);
    if (!stillRinging) {
      const rung = parts.filter((p) => p.invitedAt);
      const allDeclined = rung.length > 0 && rung.every((p) => p.declinedAt && p.declinedAt >= p.invitedAt!);
      await closeCall(callId, allDeclined ? "declined" : "no_answer");
      return;
    }
  }
  await announceCall(row);
}

/** Why a call is closing. */
export type CloseReason = "hang_up" | "declined" | "no_answer" | "not_allowed" | "alone";

/**
 * Ends a ringing or ongoing call. A ringing call becomes missed (or declined); an ongoing one
 * becomes ended. Returns the closed call, or null if it had already finished.
 */
export async function closeCall(callId: string, reason: CloseReason, alsoTell: string[] = []): Promise<CallRow | null> {
  const closed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(calls).where(eq(calls.id, callId)).for("update");
    if (!row || !ACTIVE.includes(row.status)) return null;
    const now = new Date();
    const status: CallStatus =
      row.status === "ongoing" ? "ended" : reason === "declined" ? "declined" : "missed";
    const [updated] = await tx.update(calls).set({ status, endedAt: now }).where(eq(calls.id, callId)).returning();
    await tx
      .update(callParticipants)
      .set({ leftAt: now })
      .where(and(eq(callParticipants.callId, callId), isNotNull(callParticipants.joinedAt), isNull(callParticipants.leftAt)));
    return updated;
  });
  if (!closed) return null;
  stopRinging(callId);
  forget(callId);
  forgetWatch(callId); // Watch Together: nothing to watch once the call is over
  await refreshLine(closed);
  await announceCall(closed, alsoTell, reason === "alone" ? "alone" : null);
  // A missed call counts as unread for whoever missed it: their chat list refreshes the badge.
  if (closed.status === "missed") {
    for (const userId of await membersOf(closed.conversationId)) {
      if (userId !== closed.callerId) emitToUser(userId, "conversations:changed", {});
    }
  }
  void closeRoom(callId);
  return closed;
}

/**
 * Starts a call: the caller is in it, and everyone else in the chat is rung. Groups (0.5.2):
 * `ringOnly` rings just those people; the rest of the group can still join.
 */
export async function startCall(
  conversationId: string,
  callerId: string,
  video: boolean,
  postLine: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], callId: string) => Promise<{ id: string }>,
  ringOnly: string[] | null = null,
): Promise<{ call: CallRow; lineId: string; rung: string[] }> {
  const everyone = (await membersOf(conversationId)).filter((id) => id !== callerId);
  const others = ringOnly ? everyone.filter((id) => ringOnly.includes(id)) : everyone;
  const result = await db.transaction(async (tx) => {
    const now = new Date();
    const [call] = await tx.insert(calls).values({ conversationId, callerId, video }).returning();
    await tx.insert(callParticipants).values([
      { callId: call.id, userId: callerId, joinedAt: now },
      ...others.map((userId) => ({ callId: call.id, userId, invitedAt: now })),
    ]);
    const line = await postLine(tx, call.id);
    const [withLine] = await tx.update(calls).set({ messageId: line.id }).where(eq(calls.id, call.id)).returning();
    return { call: withLine, lineId: line.id };
  });
  for (const userId of others) startRinging(result.call.id, userId);
  return { ...result, rung: others };
}

/**
 * Joins (or answers) a call. The first person to join besides the caller starts the talking
 * (ringing → ongoing). Null if the call isn't going on anymore.
 */
export async function joinCall(callId: string, userId: string): Promise<CallRow | null> {
  const joined = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(calls).where(eq(calls.id, callId)).for("update");
    if (!row || !ACTIVE.includes(row.status)) return null;
    const now = new Date();
    let updated = row;
    if (row.status === "ringing" && userId !== row.callerId) {
      [updated] = await tx.update(calls).set({ status: "ongoing", answeredAt: now }).where(eq(calls.id, callId)).returning();
    }
    await tx
      .insert(callParticipants)
      .values({ callId, userId, joinedAt: now })
      .onConflictDoUpdate({
        target: [callParticipants.callId, callParticipants.userId],
        set: { joinedAt: now, leftAt: null, declinedAt: null },
      });
    return { row: updated, started: updated.status !== row.status };
  });
  if (!joined) return null;
  stopRinging(callId, userId);
  missingSince.delete(timerKey(callId, userId));
  missingSince.delete(`${callId}:solo`); // someone joined: nobody's on their own any more
  if (joined.started) await refreshLine(joined.row);
  await announceCall(joined.row);
  return joined.row;
}

/** Doesn't pick up: stops ringing on all their devices. A call everyone declined is over. */
export async function declineCall(callId: string, userId: string): Promise<void> {
  await db
    .update(callParticipants)
    .set({ declinedAt: new Date() })
    .where(
      and(
        eq(callParticipants.callId, callId),
        eq(callParticipants.userId, userId),
        or(isNull(callParticipants.joinedAt), isNotNull(callParticipants.leftAt)),
      ),
    );
  stopRinging(callId, userId);
  await afterRinging(callId);
}

/**
 * Hangs up. 1-on-1, or a call still ringing that the caller hangs up: the call ends.
 * Group calls: the call carries on without them until the last person leaves.
 */
export async function leaveCall(callId: string, userId: string, alsoTell: string[] = []): Promise<void> {
  const row = await reload(callId);
  if (!row || !ACTIVE.includes(row.status)) return;
  const group = (await kindOf(row.conversationId)) === "group";

  if (row.status === "ringing") {
    if (userId === row.callerId) {
      await closeCall(callId, "hang_up", alsoTell);
    } else {
      await declineCall(callId, userId); // "leaving" a call you're being rung for = declining
    }
    return;
  }
  if (!group) {
    await closeCall(callId, "hang_up", alsoTell);
    return;
  }
  await db
    .update(callParticipants)
    .set({ leftAt: new Date(), declinedAt: new Date() })
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)));
  stopRinging(callId, userId);
  missingSince.delete(timerKey(callId, userId));
  const stillIn = (await participantsOf(callId)).filter(isIn);
  if (stillIn.length === 0) await closeCall(callId, "hang_up", alsoTell);
  else {
    await announceCall(row, alsoTell);
    await watcherLeft(callId, userId); // only they could pause the video: now everyone can
  }
}

/** Group calls: rings people in the group who aren't in the call (again). */
export async function ringMore(callId: string, userIds: string[]): Promise<void> {
  const row = await reload(callId);
  if (!row || !ACTIVE.includes(row.status)) return;
  const now = new Date();
  for (const userId of userIds) {
    await db
      .insert(callParticipants)
      .values({ callId, userId, invitedAt: now })
      .onConflictDoUpdate({
        target: [callParticipants.callId, callParticipants.userId],
        set: { invitedAt: now, declinedAt: null },
      });
    startRinging(callId, userId);
  }
  await announceCall(row);
}

/**
 * Group calls: the person on their own pressed Stay. The 7 minutes start again (null if the call
 * isn't counting down).
 */
export async function stayInCall(callId: string): Promise<CallRow | null> {
  const key = `${callId}:solo`;
  if (!missingSince.has(key)) return null;
  const row = await reload(callId);
  if (!row || row.status !== "ongoing") return null;
  missingSince.set(key, Date.now());
  await announceCall(row);
  return row;
}

/** A call moved to another chat (Add people, calls/add.ts): its 1-on-1 timers no longer apply. */
export function callMoved(callId: string): void {
  forget(callId);
}

/** Someone left (or was removed from) a group: they drop out of its call at once. */
export async function removeFromChatCall(conversationId: string, userId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.conversationId, conversationId), inArray(calls.status, ACTIVE)));
  if (!row) return;
  const wasIn = await isInCall(row.id, userId);
  await leaveCall(row.id, userId, [userId]);
  if (wasIn) void removeFromRoom(row.id, userId);
}

/** Ends any calls between two people (they stopped being friends, or one blocked the other). */
export async function endCallsBetween(a: string, b: string): Promise<void> {
  const { userLow, userHigh } = pair(a, b);
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .where(and(eq(conversations.dmKey, `${userLow}:${userHigh}`), inArray(calls.status, ACTIVE)));
  for (const r of rows) await closeCall(r.id, "not_allowed");
}

/** Someone's account is being deleted: their 1-on-1 calls end; they drop out of group calls. */
export async function endCallsFor(userId: string): Promise<void> {
  for (const row of await activeCallsFor(userId)) {
    if ((await kindOf(row.conversationId)) === "group") await removeFromChatCall(row.conversationId, userId);
    else await closeCall(row.id, "not_allowed");
  }
}

// When something first went missing from a call's room: the other person (1-on-1), someone who
// joined (groups), or everyone but one (groups). Keys: callId, callId:userId, callId:solo.
const missingSince = new Map<string, number>();
function forget(callId: string): void {
  for (const key of missingSince.keys()) if (key.startsWith(callId)) missingSince.delete(key);
}
/** True once `key` has been the case for at least `ms` (checked every sweep). */
function goneFor(key: string, ms: number, now: number): boolean {
  const since = missingSince.get(key);
  if (since === undefined) {
    missingSince.set(key, now);
    return false;
  }
  return now - since >= ms;
}

/**
 * Safety net, every 15 seconds: unanswered calls past their time become missed, and calls people
 * dropped out of (a crash, lost Wi-Fi) are tidied up using what LiveKit says is in the room.
 */
export async function sweepCalls(): Promise<void> {
  const now = Date.now();
  // Ringing calls whose ring timers a restart forgot.
  const ringing = await db
    .select()
    .from(calls)
    .where(and(eq(calls.status, "ringing"), lt(calls.createdAt, new Date(now - RING_MS - 5_000))));
  for (const row of ringing) await afterRinging(row.id);
  // Calls that somehow went on forever.
  const ancient = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.status, "ongoing"), lt(calls.answeredAt, new Date(now - LONGEST_CALL_MS))));
  for (const row of ancient) await closeCall(row.id, "hang_up");

  if (!livekitConfigured) return;
  const ongoing = await db.select().from(calls).where(eq(calls.status, "ongoing"));
  for (const row of ongoing) {
    const inRoom = await peopleInRoom(row.id);
    if (inRoom === null) continue; // LiveKit didn't answer: check again next time
    const parts = await participantsOf(row.id);
    const joined = parts.filter(isIn);
    const present = joined.filter((p) => inRoom.includes(p.userId));

    if ((await kindOf(row.conversationId)) === "dm") {
      if (present.length >= 2) missingSince.delete(row.id);
      else if (goneFor(row.id, DM_ALONE_MS, now)) await closeCall(row.id, "hang_up");
      continue;
    }

    // Groups: people who joined but have been gone from the room a while have left.
    let changed = false;
    for (const p of joined) {
      const key = timerKey(row.id, p.userId);
      if (inRoom.includes(p.userId)) missingSince.delete(key);
      else if (goneFor(key, MISSING_MS, now)) {
        missingSince.delete(key);
        await db
          .update(callParticipants)
          .set({ leftAt: new Date() })
          .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.userId, p.userId)));
        changed = true;
        await watcherLeft(row.id, p.userId);
      }
    }
    const stillIn = (await participantsOf(row.id)).filter(isIn).length;
    if (stillIn === 0) {
      await closeCall(row.id, "hang_up");
      continue;
    }
    // One person on their own for 7 minutes: the call ends. Their app shows a countdown for the
    // last minute (soloEndsAt), so the call is announced when the count starts and stops.
    // Normal group chats only (on the 2.0 branch, voice nebulas are left alone).
    const soloKey = `${row.id}:solo`;
    if (present.length <= 1 && (await kindOf(row.conversationId)) === "group") {
      const counting = missingSince.has(soloKey);
      if (goneFor(soloKey, GROUP_SOLO_MS, now)) {
        await closeCall(row.id, "alone");
        continue;
      }
      if (!counting) changed = true;
    } else if (missingSince.delete(soloKey)) changed = true;
    if (changed) await announceCall(row);
  }
  // Forget calls that finished some other way.
  for (const key of missingSince.keys()) {
    if (!ongoing.some((c) => key.startsWith(c.id))) missingSince.delete(key);
  }
}

/** "Pause Glofly": every ringing or ongoing call ends. Returns how many there were. */
export async function endAllCalls(): Promise<number> {
  const rows = await db.select({ id: calls.id }).from(calls).where(inArray(calls.status, ACTIVE));
  let ended = 0;
  for (const r of rows) {
    if (await closeCall(r.id, "hang_up").catch((err) => console.error("Couldn't end a call:", err))) ended++;
  }
  return ended;
}
