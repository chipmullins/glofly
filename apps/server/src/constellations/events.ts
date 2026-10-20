import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  EVENT_DEFAULT_HOURS,
  EVENT_REMINDER_MINUTES,
  eventFallbackText,
  type ConstellationEvent,
  type PublicUser,
  type RsvpAnswer,
} from "@glofly/shared";
import { db } from "../db";
import { constellationEventRsvps, constellationEvents, constellations, messages, nebulas } from "../db/schema";
import { emitToUser } from "../realtime";
import { inBackground, notifyEventReminder } from "../push/notify";
import { sendUpdated } from "../messages/routes";
import { can, outranks, standingOf, type Standing } from "./perms";
import { memberIdsOf, tellMembers } from "./activity";
import { publicUsers } from "./views";
import { voiceStatesOf } from "./voice";

// Events with RSVP (0.8.0, approved Oct 20 board 13). An event's card is a message in a text
// nebula (plain text there for apps that don't know events); the event and who's going live in
// their own tables. Going and Maybe get a reminder 15 minutes before (live + phones), and when it
// starts everyone is told (the voice nebula shows EVENT; people going get "Join").

export type EventRow = typeof constellationEvents.$inferSelect;

const FACES = 6;

/** Several events as the apps see them, for one viewer. */
export async function eventViews(rows: EventRow[], viewer: Standing): Promise<ConstellationEvent[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const answers = await db
    .select({ eventId: constellationEventRsvps.eventId, userId: constellationEventRsvps.userId, answer: constellationEventRsvps.answer, at: constellationEventRsvps.updatedAt })
    .from(constellationEventRsvps)
    .where(inArray(constellationEventRsvps.eventId, ids))
    .orderBy(asc(constellationEventRsvps.updatedAt));
  const faceIds = new Set<string>();
  for (const r of rows) {
    const mine = answers.filter((a) => a.eventId === r.id);
    for (const a of [...mine.filter((a) => a.answer === "going"), ...mine.filter((a) => a.answer === "maybe")].slice(0, FACES)) faceIds.add(a.userId);
    if (r.hostId) faceIds.add(r.hostId);
  }
  const people = await publicUsers([...faceIds]);
  const hostStandings = new Map<string, Standing | null>();
  const out: ConstellationEvent[] = [];
  for (const r of rows) {
    const mine = answers.filter((a) => a.eventId === r.id);
    const going = mine.filter((a) => a.answer === "going");
    const maybe = mine.filter((a) => a.answer === "maybe");
    const me = mine.find((a) => a.userId === viewer.userId);
    let canManage = viewer.owner || r.hostId === viewer.userId;
    if (!canManage && can(viewer, "deleteMessages")) {
      if (!r.hostId) canManage = true;
      else {
        if (!hostStandings.has(r.hostId)) hostStandings.set(r.hostId, await standingOf(r.constellationId, r.hostId));
        const host = hostStandings.get(r.hostId);
        canManage = !host || outranks(viewer, host);
      }
    }
    out.push({
      id: r.id,
      constellationId: r.constellationId,
      nebulaId: r.nebulaId,
      messageId: r.messageId,
      voiceNebulaId: r.voiceNebulaId,
      title: r.title,
      description: r.description,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt ? r.endsAt.toISOString() : null,
      timeZone: r.timeZone,
      host: r.hostId ? (people.get(r.hostId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      going: going.length,
      maybe: maybe.length,
      faces: [...going, ...maybe]
        .slice(0, FACES)
        .map((a) => people.get(a.userId))
        .filter((u): u is PublicUser => !!u),
      mine: me && (me.answer === "going" || me.answer === "maybe" || me.answer === "no") ? (me.answer as RsvpAnswer) : null,
      canManage,
    });
  }
  return out;
}

/** A constellation's events worth showing: not over (or over / cancelled in the last day). */
export async function eventsOf(constellationId: string): Promise<EventRow[]> {
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);
  const rows = await db
    .select()
    .from(constellationEvents)
    .where(
      and(
        eq(constellationEvents.constellationId, constellationId),
        or(isNull(constellationEvents.cancelledAt), gt(constellationEvents.cancelledAt, dayAgo)),
        // Still on, or ended in the last day (no end = EVENT_DEFAULT_HOURS after the start)
        sql`coalesce(${constellationEvents.endsAt}, ${constellationEvents.startsAt} + make_interval(hours => ${EVENT_DEFAULT_HOURS})) > ${dayAgo}`,
      ),
    )
    .orderBy(asc(constellationEvents.startsAt))
    .limit(50);
  return rows;
}

/** The event's card text in its nebula (what apps that don't know events show). */
export async function cardText(r: Pick<EventRow, "title" | "startsAt" | "timeZone" | "voiceNebulaId" | "cancelledAt">): Promise<string> {
  let voiceName: string | null = null;
  if (r.voiceNebulaId) {
    const [n] = await db.select({ name: nebulas.name }).from(nebulas).where(eq(nebulas.id, r.voiceNebulaId));
    voiceName = n?.name ?? null;
  }
  const text = eventFallbackText({ title: r.title, startsAt: r.startsAt.toISOString(), timeZone: r.timeZone, voiceName });
  return r.cancelledAt ? `Cancelled: ${text}` : text;
}

/** The card's text changed (edited or cancelled): update it for everyone. */
export async function refreshCard(r: EventRow): Promise<void> {
  if (!r.messageId) return;
  const [n] = await db.select({ conversationId: nebulas.conversationId }).from(nebulas).where(eq(nebulas.id, r.nebulaId));
  if (!n) return;
  await db.update(messages).set({ body: await cardText(r), editedAt: new Date() }).where(eq(messages.id, r.messageId));
  await sendUpdated(r.messageId, n.conversationId).catch(() => undefined);
}

/** Tells everyone in the constellation that an event changed (their apps reload its events). */
export async function eventChanged(constellationId: string, eventId: string): Promise<void> {
  await tellMembers(constellationId, "constellation:event", { constellationId, eventId, phase: "changed" });
}

async function goingOrMaybe(eventId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: constellationEventRsvps.userId })
    .from(constellationEventRsvps)
    .where(and(eq(constellationEventRsvps.eventId, eventId), inArray(constellationEventRsvps.answer, ["going", "maybe"])));
  return rows.map((r) => r.userId);
}

async function aboutEvent(r: EventRow) {
  const [c] = await db.select({ name: constellations.name, takenDownAt: constellations.takenDownAt }).from(constellations).where(eq(constellations.id, r.constellationId));
  const [card] = await db.select({ conversationId: nebulas.conversationId, name: nebulas.name }).from(nebulas).where(eq(nebulas.id, r.nebulaId));
  let voiceName = "";
  let inVoice = 0;
  if (r.voiceNebulaId) {
    const [v] = await db.select({ name: nebulas.name }).from(nebulas).where(eq(nebulas.id, r.voiceNebulaId));
    voiceName = v?.name ?? "";
    const state = (await voiceStatesOf(r.constellationId)).find((s) => s.nebulaId === r.voiceNebulaId);
    inVoice = state?.userIds.length ?? 0;
  }
  return { constellationName: c?.name ?? "", takenDown: !!c?.takenDownAt, conversationId: card?.conversationId ?? null, voiceName, inVoice };
}

/**
 * The sweep (every 30 seconds): reminders 15 minutes before, and "it's starting" at the start.
 * Each is marked first (only one server instance sends it).
 */
export async function sweepEvents(now = new Date()): Promise<void> {
  const soon = new Date(now.getTime() + EVENT_REMINDER_MINUTES * 60_000);
  const toRemind = await db
    .update(constellationEvents)
    .set({ remindedAt: now })
    .where(
      and(
        isNull(constellationEvents.remindedAt),
        isNull(constellationEvents.cancelledAt),
        isNull(constellationEvents.startedAt),
        lte(constellationEvents.startsAt, soon),
        gt(constellationEvents.startsAt, now),
      ),
    )
    .returning();
  for (const r of toRemind) {
    const about = await aboutEvent(r);
    if (about.takenDown) continue;
    const who = new Set(await memberIdsOf(r.constellationId));
    const people = (await goingOrMaybe(r.id)).filter((u) => who.has(u));
    const payload = {
      constellationId: r.constellationId,
      eventId: r.id,
      phase: "reminder",
      title: r.title,
      constellationName: about.constellationName,
      voiceNebulaId: r.voiceNebulaId,
      voiceName: about.voiceName,
      nebulaId: r.nebulaId,
      conversationId: about.conversationId,
      inVoice: about.inVoice,
    };
    for (const u of people) {
      emitToUser(u, "constellation:event", payload, true);
      emitToUser(u, "inbox:changed", {}, true);
    }
    if (about.conversationId)
      inBackground(
        notifyEventReminder(people, {
          eventTitle: r.title,
          constellationId: r.constellationId,
          constellationName: about.constellationName,
          conversationId: about.conversationId,
          messageId: r.messageId,
          hostId: r.hostId,
          where: about.voiceName,
          minutes: Math.max(1, Math.round((r.startsAt.getTime() - now.getTime()) / 60_000)),
        }),
      );
  }

  const toStart = await db
    .update(constellationEvents)
    .set({ startedAt: now })
    .where(and(isNull(constellationEvents.startedAt), isNull(constellationEvents.cancelledAt), lte(constellationEvents.startsAt, now)))
    .returning();
  for (const r of toStart) {
    // Something planned long ago that the server missed (it was down) doesn't announce itself late.
    const late = now.getTime() - r.startsAt.getTime() > 10 * 60_000;
    const about = await aboutEvent(r);
    if (about.takenDown) continue;
    if (!late) {
      await tellMembers(r.constellationId, "constellation:event", {
        constellationId: r.constellationId,
        eventId: r.id,
        phase: "started",
        title: r.title,
        constellationName: about.constellationName,
        voiceNebulaId: r.voiceNebulaId,
        voiceName: about.voiceName,
        nebulaId: r.nebulaId,
        conversationId: about.conversationId,
        inVoice: about.inVoice,
      });
      for (const u of await goingOrMaybe(r.id)) emitToUser(u, "inbox:changed", {}, true);
    } else {
      await eventChanged(r.constellationId, r.id);
    }
  }
}
