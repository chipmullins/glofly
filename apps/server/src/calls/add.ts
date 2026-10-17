import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { GROUP_MAX } from "@glofly/shared";
import { db } from "../db";
import { callParticipants, calls, conversationMembers, conversations, messages, users } from "../db/schema";
import { blockedEitherWay, canMessage, deletionPending, groupBreaksRestriction } from "../friends/rules";
import {
  addable,
  addGroupMembers,
  announce,
  groupFull,
  NOT_FRIENDS,
  postEvent,
  RESTRICTED_GROUP,
  sendUpdated,
  type Access,
  type MessageRow,
} from "../messages/routes";
import { appsKnow } from "../realtime";
import { roomCapacity } from "./livekit";
import { announceCall, callMoved, isInCall, reload, ringMore, type CallRow } from "./service";
import { moveWatch } from "./watch";

// Add people (0.5.2): someone in a call brings more people in, without anyone dropping out.
//
//   1-on-1 call → a new group is made with both of you and the people picked (named like any new
//   group: after its members). The call itself moves to that group: same call, same LiveKit room,
//   so nobody reconnects. Its line in the 1-on-1 chat becomes a finished call ("Voice call · 4 min")
//   with a note under it ("Riley added Dana to the call. It carries on in a new group."), and the
//   group gets "Riley started the group", "Riley added Dana to the call" and the call's own line.
//   The people picked are rung.
//
//   Group call → people in the group who aren't in the call are rung; friends who aren't in the
//   group are added to it first ("Riley added Dana"), then rung. A line says who was added.
//
// The same rules as making or adding to a group apply (friends only, blocks, restricted family
// accounts, at most GROUP_MAX people), and nobody who has blocked (or been blocked by) someone in
// the call is brought into it. Apps before 0.5.2 can't follow a call that moves, so a 1-on-1 call
// only moves when the other person's open apps know how ("callMove"); a phone with Glofly closed
// counts as fine (its call screen follows the call, not the chat).

export type AddProblem = { status: number; error: string; message: string };
export type AddResult = { call: CallRow; moved: boolean };

const problem = (status: number, error: string, message: string): AddProblem => ({ status, error, message });
const ACTIVE = ["ringing", "ongoing"];

class CallChanged extends Error {}

/** Their first names ("Dana"), in the order given. */
async function firstNames(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users)
    .where(inArray(users.id, userIds));
  return userIds.map((id) => {
    const u = rows.find((r) => r.id === id);
    return u ? u.displayName.trim().split(/\s+/)[0] || u.username : "someone";
  });
}

/** People in the call right now (joined, not left). */
async function joinedIds(callId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: callParticipants.userId })
    .from(callParticipants)
    .where(
      and(eq(callParticipants.callId, callId), isNotNull(callParticipants.joinedAt), isNull(callParticipants.leftAt)),
    );
  return rows.map((r) => r.userId);
}

/** Has anyone picked blocked (or been blocked by) anyone in the call? */
async function blockedWithCall(picked: string[], inCall: string[]): Promise<boolean> {
  for (const a of picked) for (const b of inCall) if (a !== b && (await blockedEitherWay(a, b))) return true;
  return false;
}

/** Rings the people added, and once more a moment later (see below). */
async function ringAdded(callId: string, userIds: string[]): Promise<void> {
  await ringMore(callId, userIds);
  // People added to a brand-new group hear about the call before their app has loaded that group,
  // and an app only rings for a chat it knows. Saying it again shortly after fixes that (pushes
  // don't repeat: nothing about the ringing changed).
  setTimeout(() => {
    void (async () => {
      const row = await reload(callId);
      if (row && ACTIVE.includes(row.status)) await announceCall(row);
    })().catch((err) => console.error("Couldn't re-announce a call:", err));
  }, 2500);
}

/** Posts "Riley added Dana to the call" in a chat and tells everyone in it. */
async function postAddLine(
  conversationId: string,
  myId: string,
  callId: string,
  userIds: string[],
  memberIds: string[],
): Promise<void> {
  const names = await firstNames(userIds);
  const line = await db.transaction((tx) =>
    postEvent(tx, conversationId, myId, { type: "callAdd", callId, userIds, names, movedTo: null }),
  );
  await announce(line, memberIds);
}

/**
 * Adds people to a call I'm in. `chat` is the call's chat as I see it. Returns where the call is
 * now, or why not.
 */
export async function addPeopleToCall(
  row: CallRow,
  chat: Access,
  myId: string,
  requested: string[],
): Promise<AddResult | AddProblem> {
  if (!ACTIVE.includes(row.status)) return problem(409, "call_over", "This call has already ended.");
  if (!(await isInCall(row.id, myId))) return problem(403, "forbidden", "Join the call first.");
  if (await deletionPending(myId)) return problem(403, "forbidden", NOT_FRIENDS);
  const picked = [...new Set(requested)].filter((id) => id !== myId);
  if (chat.kind === "dm") return moveToNewGroup(row, chat, myId, picked);
  if (chat.kind === "group") return addToGroupCall(row, chat, myId, picked);
  return problem(400, "invalid", "People can't be added to this call."); // anything else (2.0 rooms)
}

/** A 1-on-1 call: make a group with everyone and move the call there. */
async function moveToNewGroup(row: CallRow, chat: Access, myId: string, requested: string[]): Promise<AddResult | AddProblem> {
  const partner = chat.partner;
  if (!partner) return problem(404, "not_found", "This chat isn't there any more.");
  const picked = requested.filter((id) => id !== partner);
  if (!picked.length) return problem(400, "invalid", "Pick friends to add to the call.");
  if (picked.length + 2 > GROUP_MAX) return problem(400, "invalid", groupFull());
  if (row.status !== "ongoing") return problem(409, "not_answered", "Wait until they pick up, then add people.");
  if (!(await canMessage(myId, partner))) return problem(403, "forbidden", "You can only call your friends.");
  if (!(await isInCall(row.id, partner))) return problem(409, "call_over", "They've left the call.");
  if (!(await addable(myId, picked))) return problem(403, "forbidden", NOT_FRIENDS);
  if (await groupBreaksRestriction([myId, partner, ...picked])) return problem(403, "restricted", RESTRICTED_GROUP);
  if (await blockedWithCall(picked, [myId, partner])) {
    return problem(403, "forbidden", "Someone you picked can't be added to this call.");
  }
  if ((await appsKnow(partner, "callMove")) === "no") {
    const [name] = await firstNames([partner]);
    return problem(
      409,
      "update_needed",
      `${name} needs to update Glofly before people can be added to this call. You can start a group call instead.`,
    );
  }
  // Rooms of 1-on-1 calls started before 0.5.2 were made for two.
  const capacity = await roomCapacity(row.id);
  if (capacity !== null && capacity > 0 && capacity < picked.length + 2) {
    return problem(
      409,
      "room_full",
      "This call started before Glofly could add people to calls. Hang up and start a group call instead.",
    );
  }

  const names = await firstNames(picked);
  let moved: { groupId: string; lines: MessageRow[]; dmNote: MessageRow; oldLineId: string | null };
  try {
    moved = await db.transaction(async (tx) => {
      // Lock the call: two people pressing Add people at once only move it once.
      const [locked] = await tx.select().from(calls).where(eq(calls.id, row.id)).for("update");
      if (!locked || locked.status !== "ongoing" || locked.conversationId !== row.conversationId) throw new CallChanged();
      const now = Date.now();
      const [group] = await tx
        .insert(conversations)
        .values({ kind: "group", name: null, createdBy: myId })
        .returning({ id: conversations.id });
      // Whoever added people first (they made the group), then the other person, then the picks.
      await tx.insert(conversationMembers).values(
        [myId, partner, ...picked].map((userId, i) => ({ conversationId: group.id, userId, joinedAt: new Date(now + i) })),
      );
      const created = await postEvent(tx, group.id, myId, { type: "created", name: null });
      const added = await postEvent(
        tx,
        group.id,
        myId,
        { type: "callAdd", callId: row.id, userIds: picked, names, movedTo: null },
        1,
      );
      // The call's line in the group (from whoever started the call, like any call line).
      const callLine = await postEvent(
        tx,
        group.id,
        locked.callerId,
        { type: "call", callId: row.id, video: locked.video, status: "ongoing", durationSec: null },
        2,
      );
      // In the 1-on-1 chat: the call's line becomes a finished call, with a note where it went.
      if (locked.messageId) {
        const durationSec = locked.answeredAt ? Math.max(0, Math.round((now - locked.answeredAt.getTime()) / 1000)) : null;
        await tx
          .update(messages)
          .set({ event: { type: "call", callId: row.id, video: locked.video, status: "ended", durationSec } })
          .where(eq(messages.id, locked.messageId));
      }
      const dmNote = await postEvent(tx, locked.conversationId, myId, {
        type: "callAdd",
        callId: row.id,
        userIds: picked,
        names,
        movedTo: group.id,
      });
      await tx.update(calls).set({ conversationId: group.id, messageId: callLine.id }).where(eq(calls.id, row.id));
      return { groupId: group.id, lines: [created, added, callLine], dmNote, oldLineId: locked.messageId };
    });
  } catch (err) {
    if (err instanceof CallChanged) return problem(409, "call_changed", "The call just changed. Try again.");
    throw err;
  }

  callMoved(row.id);
  moveWatch(row.id, moved.groupId);
  const groupMembers = [myId, partner, ...picked];
  for (const line of moved.lines) await announce(line, groupMembers);
  await announce(moved.dmNote, [myId, partner]);
  if (moved.oldLineId) await sendUpdated(moved.oldLineId, row.conversationId);
  // Everyone in the group (both of you included) hears where the call is now; the picks are rung.
  await ringAdded(row.id, picked);
  const after = await reload(row.id);
  return { call: after ?? row, moved: true };
}

/** A group call: ring people in the group, and add friends who aren't in it yet. */
async function addToGroupCall(row: CallRow, chat: Access, myId: string, requested: string[]): Promise<AddResult | AddProblem> {
  if (!chat.memberIds.includes(myId)) return problem(404, "not_found", "This chat isn't there any more.");
  const inCall = await joinedIds(row.id);
  const picked = requested.filter((id) => !inCall.includes(id));
  if (!picked.length) return problem(400, "invalid", "They're already in the call.");
  const members = picked.filter((id) => chat.memberIds.includes(id));
  const newcomers = picked.filter((id) => !chat.memberIds.includes(id));
  if (newcomers.length) {
    if (chat.memberIds.length + newcomers.length > GROUP_MAX) return problem(409, "group_full", groupFull());
    if (!(await addable(myId, newcomers))) return problem(403, "forbidden", NOT_FRIENDS);
    if (await groupBreaksRestriction([...chat.memberIds, ...newcomers])) {
      return problem(403, "restricted", RESTRICTED_GROUP);
    }
  }
  if (await blockedWithCall(picked, inCall)) return problem(403, "forbidden", "Someone you picked can't be added to this call.");

  let memberIds = chat.memberIds;
  if (newcomers.length) {
    const added = await addGroupMembers(row.conversationId, myId, newcomers);
    if (!added) return problem(409, "group_full", groupFull());
    await announce(added.row, added.memberIds);
    memberIds = added.memberIds;
  }
  const fresh = await reload(row.id);
  if (!fresh || !ACTIVE.includes(fresh.status)) return problem(409, "call_over", "This call has already ended.");
  await postAddLine(row.conversationId, myId, row.id, picked, memberIds);
  if (newcomers.length) await ringAdded(row.id, picked);
  else await ringMore(row.id, members);
  return { call: (await reload(row.id)) ?? fresh, moved: false };
}
