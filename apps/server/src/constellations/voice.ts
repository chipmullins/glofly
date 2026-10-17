import { and, eq, inArray } from "drizzle-orm";
import type { VoiceNebulaState } from "@glofly/shared";
import { db } from "../db";
import { calls, nebulas } from "../db/schema";
import { onNebulaCallChange, peopleInCall } from "../calls/service";
import { voiceMutedIn } from "../calls/voiceMutes";
import { tellMembers } from "./activity";

// Who's in each voice nebula (2.0). A voice nebula's room is a call on its conversation
// (calls/service.ts joinVoiceRoom). Screen sharing is reported by the apps in the room (LiveKit
// tells them who's sharing), so the sidebar's LIVE badge follows `sharing`.

/** People sharing their screen in each room right now (callId → user ids), as the apps report it. */
const sharing = new Map<string, Set<string>>();

export function setSharing(callId: string, userId: string, on: boolean): void {
  const set = sharing.get(callId) ?? new Set<string>();
  if (on) set.add(userId);
  else set.delete(userId);
  if (set.size) sharing.set(callId, set);
  else sharing.delete(callId);
}

/** Every voice nebula's state in one constellation. */
export async function voiceStatesOf(constellationId: string): Promise<VoiceNebulaState[]> {
  return (await voiceStatesFor([constellationId])).get(constellationId) ?? [];
}

/** Every voice nebula's state in several constellations (the dashboard), in two queries plus one per open room. */
export async function voiceStatesFor(constellationIds: string[]): Promise<Map<string, VoiceNebulaState[]>> {
  const out = new Map<string, VoiceNebulaState[]>();
  if (!constellationIds.length) return out;
  const rows = await db
    .select({ nebulaId: nebulas.id, constellationId: nebulas.constellationId, conversationId: nebulas.conversationId })
    .from(nebulas)
    .where(and(inArray(nebulas.constellationId, constellationIds), eq(nebulas.kind, "voice")))
    .orderBy(nebulas.position);
  if (!rows.length) return out;
  const open = await db
    .select({ id: calls.id, conversationId: calls.conversationId })
    .from(calls)
    .where(and(inArray(calls.conversationId, rows.map((r) => r.conversationId)), inArray(calls.status, ["ringing", "ongoing"])));
  for (const r of rows) {
    const call = open.find((c) => c.conversationId === r.conversationId);
    const userIds = call ? await peopleInCall(call.id) : [];
    const live = call ? [...(sharing.get(call.id) ?? [])].filter((id) => userIds.includes(id)) : [];
    const list = out.get(r.constellationId) ?? [];
    list.push({
      nebulaId: r.nebulaId,
      callId: call && userIds.length ? call.id : null,
      userIds,
      live: live.length > 0,
      sharing: live,
      muted: call ? voiceMutedIn(call.id).filter((id) => userIds.includes(id)) : [],
    });
    out.set(r.constellationId, list);
  }
  return out;
}

/** One voice nebula's state, told to everyone in its constellation (their sidebars update). */
export async function announceVoice(conversationId: string): Promise<void> {
  const [n] = await db
    .select({ id: nebulas.id, constellationId: nebulas.constellationId })
    .from(nebulas)
    .where(eq(nebulas.conversationId, conversationId));
  if (!n) return;
  const state = (await voiceStatesOf(n.constellationId)).find((v) => v.nebulaId === n.id);
  if (state) await tellMembers(n.constellationId, "constellation:voice", { constellationId: n.constellationId, voice: state });
}

// Calls in voice nebulas changed (someone joined or left, the room closed).
onNebulaCallChange((conversationId, callId) => {
  void (async () => {
    const people = await peopleInCall(callId);
    const set = sharing.get(callId);
    if (set) for (const id of set) if (!people.includes(id)) set.delete(id);
    if (set && !set.size) sharing.delete(callId);
    await announceVoice(conversationId);
  })().catch((err) => console.error("Couldn't update a voice nebula:", err));
});
