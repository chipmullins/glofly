import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
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
import { closeRoom, livekitConfigured, peopleInRoom } from "./livekit";

// How a call goes:
//
//   ringing ──answer──▶ ongoing ──hang up──▶ ended
//      │
//      ├─ caller hangs up, or 45s pass ──▶ missed
//      └─ the person called declines ────▶ declined
//
// Every change updates the call's line in the chat and tells both people's apps
// (`call:updated`), so every device they're signed in on stays in step.

/** How long a call rings before it counts as missed. */
export const RING_MS = 45_000;
/** An ongoing call with someone missing from the room for this long is ended. */
const ALONE_MS = 45_000;
/** No call lasts longer than this (a safety net for anything that went wrong). */
const LONGEST_CALL_MS = 12 * 60 * 60 * 1000;

const ACTIVE: CallStatus[] = ["ringing", "ongoing"];

export type CallRow = typeof calls.$inferSelect;

/** What the apps get about a call. */
export function callInfo(row: CallRow) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    callerId: row.callerId,
    video: row.video,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

async function membersOf(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

async function publicUser(userId: string) {
  const [person] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
    })
    .from(users)
    .where(eq(users.id, userId));
  return person ?? null;
}

/** Tells everyone in the call's chat (all their devices) where the call stands. */
export async function announceCall(row: CallRow): Promise<void> {
  const payload = { call: callInfo(row), caller: await publicUser(row.callerId) };
  for (const userId of await membersOf(row.conversationId)) emitToUser(userId, "call:updated", payload);
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
        isNull(callParticipants.leftAt),
        inArray(calls.status, ACTIVE),
      ),
    )
    .limit(1);
  return row?.call ?? null;
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

// Ring timers: a call that isn't answered in time becomes "missed". The sweep below catches any
// that a server restart forgot.
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function startRinging(callId: string): void {
  stopRinging(callId);
  ringTimers.set(
    callId,
    setTimeout(() => {
      ringTimers.delete(callId);
      closeCall(callId, "no_answer").catch((err) => console.error("Couldn't end an unanswered call:", err));
    }, RING_MS),
  );
}

function stopRinging(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) clearTimeout(timer);
  ringTimers.delete(callId);
}

/** Why a call is closing. */
export type CloseReason = "hang_up" | "declined" | "no_answer" | "not_allowed";

/**
 * Ends a ringing or ongoing call. A ringing call becomes missed (or declined); an ongoing one
 * becomes ended. Returns the closed call, or null if it had already finished.
 */
export async function closeCall(callId: string, reason: CloseReason): Promise<CallRow | null> {
  const closed = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(calls).where(eq(calls.id, callId)).for("update");
    if (!row || !ACTIVE.includes(row.status)) return null;
    const now = new Date();
    const status: CallStatus =
      row.status === "ongoing" ? "ended" : reason === "declined" ? "declined" : "missed";
    const [updated] = await tx
      .update(calls)
      .set({ status, endedAt: now })
      .where(eq(calls.id, callId))
      .returning();
    await tx
      .update(callParticipants)
      .set({ leftAt: now })
      .where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));
    return updated;
  });
  if (!closed) return null;
  stopRinging(callId);
  alone.delete(callId);
  await refreshLine(closed);
  await announceCall(closed);
  // A missed call counts as unread for whoever missed it: their chat list refreshes the badge.
  if (closed.status === "missed") {
    for (const userId of await membersOf(closed.conversationId)) {
      if (userId !== closed.callerId) emitToUser(userId, "conversations:changed", {});
    }
  }
  void closeRoom(callId);
  return closed;
}

/** Answers a ringing call. Null if it isn't ringing anymore (answered elsewhere, or it ended). */
export async function answerCall(callId: string, userId: string): Promise<CallRow | null> {
  const answered = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(calls)
      .set({ status: "ongoing", answeredAt: new Date() })
      .where(and(eq(calls.id, callId), eq(calls.status, "ringing")))
      .returning();
    if (!row) return null;
    await tx
      .insert(callParticipants)
      .values({ callId, userId })
      .onConflictDoUpdate({
        target: [callParticipants.callId, callParticipants.userId],
        set: { leftAt: null, joinedAt: new Date() },
      });
    return row;
  });
  if (!answered) return null;
  stopRinging(callId);
  await refreshLine(answered);
  await announceCall(answered);
  return answered;
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

/** Ends every call someone is part of (their account is being deleted). */
export async function endCallsFor(userId: string): Promise<void> {
  for (const row of await activeCallsFor(userId)) await closeCall(row.id, "not_allowed");
}

// When someone in an ongoing call first went missing from its room.
const alone = new Map<string, number>();

/**
 * Safety net, every 15 seconds: unanswered calls past their time become missed, and ongoing
 * calls where someone has been gone from the room for a while (a crash, lost Wi-Fi) are ended.
 */
export async function sweepCalls(): Promise<void> {
  const now = Date.now();
  const stale = await db
    .select()
    .from(calls)
    .where(
      or(
        and(eq(calls.status, "ringing"), lt(calls.createdAt, new Date(now - RING_MS - 5_000))),
        and(eq(calls.status, "ongoing"), lt(calls.answeredAt, new Date(now - LONGEST_CALL_MS))),
      ),
    );
  for (const row of stale) await closeCall(row.id, "no_answer");

  if (!livekitConfigured) return;
  const ongoing = await db.select().from(calls).where(eq(calls.status, "ongoing"));
  for (const row of ongoing) {
    const inRoom = await peopleInRoom(row.id);
    if (inRoom === null) continue; // LiveKit didn't answer: check again next time
    const members = await membersOf(row.conversationId);
    const present = members.filter((id) => inRoom.includes(id)).length;
    if (present >= Math.min(2, members.length)) {
      alone.delete(row.id);
      continue;
    }
    const since = alone.get(row.id);
    if (since === undefined) alone.set(row.id, now);
    else if (now - since >= ALONE_MS) await closeCall(row.id, "hang_up");
  }
  // Forget calls that finished some other way.
  for (const id of alone.keys()) if (!ongoing.some((c) => c.id === id)) alone.delete(id);
}

