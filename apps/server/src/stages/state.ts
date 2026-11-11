import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  STAGE_EMPTY_END_MS,
  STAGE_GONE_MS,
  STAGE_HANDS_SHOWN,
  STAGE_LISTENERS_SHOWN,
  type StageState,
} from "@glofly/shared";
import { db } from "../db";
import { constellationMemberRoles, constellationRoles, constellations, nebulas, stagePeople, stages } from "../db/schema";
import { emitToUser, emitToUsersPlain } from "../realtime";
import { viewersOf } from "../constellations/access";
import { closeRoom } from "../calls/livekit";

// Communities round 2 (board 3a): live stages. The stage itself and who's up / asked up / has a hand
// raised are kept in the database (stages, stage_people) and mirrored here; who's actually on it right
// now (speakers and listeners) is kept only in memory: every app says "still here" every
// STAGE_PING_MS, and someone silent for STAGE_GONE_MS is dropped (after a restart, the next pings
// bring everyone back within half a minute).

export type Person = { speaker: boolean; invited: boolean; handAt: Date | null; upAt: Date | null };

export type LiveStage = {
  id: string;
  nebulaId: string;
  constellationId: string;
  conversationId: string;
  topic: string;
  startedBy: string | null;
  startedAt: Date;
  handsOn: boolean;
  listenerChat: boolean;
  speakerLimit: number;
  people: Map<string, Person>;
  /** Who's on it right now (userId → last ping, and whether as a speaker) */
  here: Map<string, { at: number; speaker: boolean }>;
  /** The last time a speaker was on it (it ends by itself after STAGE_EMPTY_END_MS without one) */
  lastSpeakerAt: number;
  /** Control's numbers: most listeners at once, everyone's minutes (fractional), last sweep */
  peak?: number;
  minutes?: number;
  sweptAt?: number;
};

const live = new Map<string, LiveStage>(); // nebulaId → stage
let loaded: Promise<void> | null = null;

/** The LiveKit room of a stage. */
export const roomOf = (stageId: string) => `stage-${stageId}`;

async function loadLive(): Promise<void> {
  const rows = await db
    .select({ s: stages, constellationId: nebulas.constellationId, conversationId: nebulas.conversationId })
    .from(stages)
    .innerJoin(nebulas, eq(nebulas.id, stages.nebulaId))
    .where(isNull(stages.endedAt));
  const people = rows.length
    ? await db.select().from(stagePeople).where(inArray(stagePeople.stageId, rows.map((r) => r.s.id)))
    : [];
  for (const r of rows) {
    const map = new Map<string, Person>();
    for (const p of people.filter((x) => x.stageId === r.s.id)) map.set(p.userId, { speaker: p.speaker, invited: p.invited, handAt: p.handAt, upAt: p.upAt });
    live.set(r.s.nebulaId, {
      id: r.s.id,
      nebulaId: r.s.nebulaId,
      constellationId: r.constellationId,
      conversationId: r.conversationId,
      topic: r.s.topic,
      startedBy: r.s.startedBy,
      startedAt: r.s.startedAt,
      handsOn: r.s.handsOn,
      listenerChat: r.s.listenerChat,
      speakerLimit: r.s.speakerLimit,
      people: map,
      here: new Map(),
      lastSpeakerAt: Date.now(),
      peak: r.s.peakListeners,
      minutes: r.s.participantMinutes,
    });
  }
}

/** Loads the live stages once (at start, or on first use). */
export function ready(): Promise<void> {
  loaded ??= loadLive().catch((err) => {
    loaded = null;
    throw err;
  });
  return loaded;
}

export async function liveStageOf(nebulaId: string): Promise<LiveStage | null> {
  await ready();
  return live.get(nebulaId) ?? null;
}

export function remember(stage: LiveStage): void {
  live.set(stage.nebulaId, stage);
}

/** Live stages in some constellations (constellation detail). */
export async function liveStagesIn(constellationId: string): Promise<LiveStage[]> {
  await ready();
  return [...live.values()].filter((s) => s.constellationId === constellationId);
}

const fresh = (stage: LiveStage, now = Date.now()) => [...stage.here.entries()].filter(([, h]) => now - h.at < STAGE_GONE_MS);

/** On stage right now, in the order they came up. */
export function speakersOf(stage: LiveStage): string[] {
  const now = Date.now();
  return fresh(stage, now)
    .filter(([id, h]) => h.speaker && stage.people.get(id)?.speaker)
    .map(([id]) => id)
    .sort((a, b) => (stage.people.get(a)?.upAt?.getTime() ?? 0) - (stage.people.get(b)?.upAt?.getTime() ?? 0));
}

export function listenersOf(stage: LiveStage): string[] {
  return fresh(stage)
    .filter(([id, h]) => !(h.speaker && stage.people.get(id)?.speaker))
    .map(([id]) => id);
}

/** A stage as the apps see it (hands only for people who can manage stages). */
export function stateOf(stage: LiveStage, withHands: boolean): StageState {
  const listeners = listenersOf(stage);
  const hands = [...stage.people.entries()]
    .filter(([id, p]) => p.handAt && !p.speaker && listeners.includes(id))
    .sort((a, b) => a[1].handAt!.getTime() - b[1].handAt!.getTime());
  return {
    nebulaId: stage.nebulaId,
    id: stage.id,
    topic: stage.topic,
    startedBy: stage.startedBy ?? "",
    startedAt: stage.startedAt.toISOString(),
    handsOn: stage.handsOn,
    listenerChat: stage.listenerChat,
    speakerLimit: stage.speakerLimit,
    speakers: speakersOf(stage).map((userId) => ({
      userId,
      host: userId === stage.startedBy,
      invited: !!stage.people.get(userId)?.invited,
    })),
    listenerCount: listeners.length,
    listeners: listeners.slice(0, STAGE_LISTENERS_SHOWN),
    ...(withHands ? { hands: hands.slice(0, STAGE_HANDS_SHOWN).map(([userId, p]) => ({ userId, at: p.handAt!.toISOString() })) } : {}),
    handCount: hands.length,
  };
}

/** People who can manage stages in a constellation (the owner and roles with "Manage stages"). */
export async function stageManagerIds(constellationId: string): Promise<Set<string>> {
  const [c] = await db.select({ ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, constellationId));
  const ids = new Set<string>(c ? [c.ownerId] : []);
  const roles = await db
    .select({ id: constellationRoles.id, permissions: constellationRoles.permissions, selfAssign: constellationRoles.selfAssign })
    .from(constellationRoles)
    .where(eq(constellationRoles.constellationId, constellationId));
  const ok = roles.filter((r) => !r.selfAssign && r.permissions.includes("manageStages")).map((r) => r.id);
  if (ok.length) {
    const rows = await db
      .select({ userId: constellationMemberRoles.userId })
      .from(constellationMemberRoles)
      .where(and(eq(constellationMemberRoles.constellationId, constellationId), inArray(constellationMemberRoles.roleId, ok)))
      .limit(500);
    for (const r of rows) ids.add(r.userId);
  }
  return ids;
}

// Changes are told to everyone who can see the stage nebula at most every 1.5 s per stage, in one
// send (thousands of listeners coming and going would otherwise be thousands of events each).
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function announce(nebulaId: string, now = false): void {
  if (pending.has(nebulaId) && !now) return;
  const old = pending.get(nebulaId);
  if (old) clearTimeout(old);
  const t = setTimeout(
    () => {
      pending.delete(nebulaId);
      void sendState(nebulaId).catch((err) => console.error("Couldn't announce a stage:", err));
    },
    now ? 0 : 1500,
  );
  t.unref?.();
  pending.set(nebulaId, t);
}

async function sendState(nebulaId: string): Promise<void> {
  const stage = live.get(nebulaId);
  const [n] = stage ? [stage] : await db.select({ constellationId: nebulas.constellationId, conversationId: nebulas.conversationId }).from(nebulas).where(eq(nebulas.id, nebulaId));
  if (!n) return;
  const viewers = await viewersOf(n.conversationId);
  if (!stage) {
    emitToUsersPlain(viewers, "stage:updated", { constellationId: n.constellationId, nebulaId, stage: null }, true);
    return;
  }
  const managers = await stageManagerIds(stage.constellationId);
  const others = viewers.filter((id) => !managers.has(id));
  emitToUsersPlain(others, "stage:updated", { constellationId: stage.constellationId, nebulaId, stage: stateOf(stage, false) }, true);
  const withHands = { constellationId: stage.constellationId, nebulaId, stage: stateOf(stage, true) };
  for (const id of viewers) if (managers.has(id)) emitToUser(id, "stage:updated", withHands, true);
}

/** Ends a stage: everyone is disconnected, the nebula goes quiet. */
export async function endStage(nebulaId: string): Promise<boolean> {
  const stage = live.get(nebulaId);
  if (!stage) return false;
  live.delete(nebulaId);
  await db.update(stages).set({ endedAt: new Date() }).where(eq(stages.id, stage.id));
  await closeRoom(roomOf(stage.id));
  announce(nebulaId, true);
  return true;
}

/** Forgets a nebula's stage without touching the database (the nebula was deleted). */
export function forgetStage(nebulaId: string): void {
  const stage = live.get(nebulaId);
  if (!stage) return;
  live.delete(nebulaId);
  void closeRoom(roomOf(stage.id));
}

/** Drops people who stopped pinging, and ends stages that have had no speaker for a while. */
export async function sweepStages(): Promise<void> {
  await ready();
  const now = Date.now();
  for (const stage of [...live.values()]) {
    let changed = false;
    for (const [id, h] of stage.here) {
      if (now - h.at >= STAGE_GONE_MS) {
        stage.here.delete(id);
        changed = true;
      }
    }
    // Glofly Control → Insights: the peak and everyone's minutes on it (saved when they change).
    const listening = listenersOf(stage).length;
    const people = listening + speakersOf(stage).length;
    const before = { peak: stage.peak ?? 0, minutes: Math.floor(stage.minutes ?? 0) };
    if (stage.sweptAt) stage.minutes = (stage.minutes ?? 0) + (people * (now - stage.sweptAt)) / 60_000;
    stage.sweptAt = now;
    stage.peak = Math.max(stage.peak ?? 0, listening);
    if (stage.peak !== before.peak || Math.floor(stage.minutes ?? 0) !== before.minutes)
      await db
        .update(stages)
        .set({ peakListeners: sql`greatest(${stages.peakListeners}, ${stage.peak})`, participantMinutes: sql`greatest(${stages.participantMinutes}, ${Math.floor(stage.minutes ?? 0)})` })
        .where(eq(stages.id, stage.id));
    if (speakersOf(stage).length) stage.lastSpeakerAt = now;
    else if (now - stage.lastSpeakerAt >= STAGE_EMPTY_END_MS) {
      await endStage(stage.nebulaId);
      continue;
    }
    if (changed) announce(stage.nebulaId);
  }
}

/** Stage chat (board 3a "Listeners can chat"): while a stage is live with it off, only speakers and managers post. */
export function stageChatClosedFor(nebulaId: string, userId: string): boolean {
  const stage = live.get(nebulaId);
  if (!stage || stage.listenerChat) return false;
  return !stage.people.get(userId)?.speaker;
}
