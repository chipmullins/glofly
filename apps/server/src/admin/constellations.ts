import { Router } from "express";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  callParticipants,
  calls,
  constellationAuditLog,
  constellationMembers,
  constellations,
  messages,
  nebulas,
  reports,
  users,
} from "../db/schema";
import { closeCall } from "../calls/service";
import { emitToUser } from "../realtime";
import { constellationChanged, logModeration, memberIdsOf } from "../constellations/activity";
import { deleteConstellation, transferOwnership } from "../constellations/routes";
import { syncNebulaAccess } from "../constellations/access";
import { deletionPending, isRestricted } from "../friends/rules";
import { CONSTELLATIONS_OWNED_MAX } from "@glofly/shared";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";

// Glofly Control → Constellations (2.0): every constellation, with its owner and size; take one
// down (hidden from everyone at once, kept for the record), bring it back, or delete it for good.
// Reports about nebula messages arrive in Reports like any other (the snapshot names the
// constellation).
//
//   GET  /admin/constellations?q=&status=&offset=
//   GET  /admin/constellations/:id
//   POST /admin/constellations/:id/take-down  { reason, note }
//   POST /admin/constellations/:id/restore    { note }
//   POST /admin/constellations/:id/delete     { confirmName, note }
// 0.8.2 (desktop Control and Control for iPhone):
//   POST /admin/constellations/:id/freeze      { frozen, note }   members can read, nobody posts or joins
//   POST /admin/constellations/:id/invites     { off, note }      invite links stop working, none can be made
//   POST /admin/constellations/:id/transfer    { username, note } a member becomes the Owner
// The list and detail also carry today's activity (counts only, never messages) and who's in voice.

export const constellationsAdminRouter = Router();

const idParam = z.uuid();

constellationsAdminRouter.get("/constellations", async (req, res) => {
  const q = z.string().trim().max(60).catch("").parse(req.query.q);
  const status = z.enum(["all", "live", "taken_down", "frozen", "reports", "growing"]).catch("all").parse(req.query.status);
  const offset = z.coerce.number().int().min(0).catch(0).parse(req.query.offset);
  const memberCount = sql<number>`(select count(*)::int from ${constellationMembers} cm where cm.constellation_id = ${constellations.id})`;
  const openReports = sql<number>`(select count(*)::int from ${reports} r join ${nebulas} n on n.conversation_id = r.conversation_id where n.constellation_id = ${constellations.id} and r.status = 'open')`;
  const joinsToday = sql<number>`(select count(*)::int from ${constellationMembers} cm where cm.constellation_id = ${constellations.id} and cm.joined_at > now() - interval '24 hours')`;
  const nebulaCount = sql<number>`(select count(*)::int from ${nebulas} n where n.constellation_id = ${constellations.id})`;
  const rows = await db
    .select({
      id: constellations.id,
      name: constellations.name,
      visibility: constellations.visibility,
      type: constellations.type,
      createdAt: constellations.createdAt,
      lastActivityAt: constellations.lastActivityAt,
      takenDownAt: constellations.takenDownAt,
      takedownReason: constellations.takedownReason,
      ownerId: users.id,
      ownerUsername: users.username,
      ownerName: users.displayName,
      memberCount,
      openReports,
      joinsToday,
      nebulaCount,
      frozenAt: constellations.frozenAt,
      invitesOffAt: constellations.invitesOffAt,
    })
    .from(constellations)
    .innerJoin(users, eq(users.id, constellations.ownerId))
    .where(
      and(
        q ? ilike(constellations.name, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
        status === "live"
          ? sql`${constellations.takenDownAt} is null`
          : status === "taken_down"
            ? isNotNull(constellations.takenDownAt)
            : status === "frozen"
              ? isNotNull(constellations.frozenAt)
              : status === "reports"
                ? sql`${openReports} > 0`
                : status === "growing"
                  ? sql`${joinsToday} >= 10`
                  : undefined,
      ),
    )
    .orderBy(desc(memberCount), desc(constellations.lastActivityAt))
    .offset(offset)
    .limit(51);
  res.json({
    constellations: rows.slice(0, 50).map((r) => ({
      id: r.id,
      name: r.name,
      visibility: r.visibility,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
      lastActivityAt: r.lastActivityAt.toISOString(),
      takenDownAt: r.takenDownAt?.toISOString() ?? null,
      takedownReason: r.takedownReason,
      owner: { id: r.ownerId, username: r.ownerUsername, displayName: r.ownerName },
      memberCount: r.memberCount,
      openReports: r.openReports,
      joinsToday: r.joinsToday,
      nebulaCount: r.nebulaCount,
      frozenAt: r.frozenAt?.toISOString() ?? null,
      invitesOffAt: r.invitesOffAt?.toISOString() ?? null,
    })),
    hasMore: rows.length > 50,
    totals: await totals(),
  });
});

/** Across Glofly: constellations, nebulas and voice rooms with people in them right now. */
async function totals() {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(constellations).where(isNull(constellations.takenDownAt));
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(nebulas);
  const [v] = await db
    .select({ n: sql<number>`count(distinct ${calls.id})::int` })
    .from(calls)
    .innerJoin(nebulas, eq(nebulas.conversationId, calls.conversationId))
    .where(eq(calls.status, "ongoing"));
  return { constellations: c.n, nebulas: n.n, voiceLive: v.n };
}

constellationsAdminRouter.get("/constellations/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c) {
    res.status(404).json({ error: "not_found", message: "That constellation is gone." });
    return;
  }
  const [owner] = await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, c.ownerId));
  const nebulaRows = await db
    .select({
      id: nebulas.id,
      name: nebulas.name,
      kind: nebulas.kind,
      visibility: nebulas.visibility,
      readOnly: nebulas.readOnly,
      messages: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${nebulas.conversationId})`,
      messagesToday: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${nebulas.conversationId} and m.created_at > now() - interval '24 hours')`,
      inVoice: sql<number>`(select count(*)::int from ${callParticipants} p join ${calls} k on k.id = p.call_id where k.conversation_id = ${nebulas.conversationId} and k.status = 'ongoing' and p.joined_at is not null and p.left_at is null)`,
    })
    .from(nebulas)
    .where(eq(nebulas.constellationId, c.id))
    .orderBy(nebulas.position);
  const log = await db
    .select({ action: constellationAuditLog.action, actorId: constellationAuditLog.actorId, targetUserId: constellationAuditLog.targetUserId, createdAt: constellationAuditLog.createdAt, details: constellationAuditLog.details })
    .from(constellationAuditLog)
    .where(eq(constellationAuditLog.constellationId, c.id))
    .orderBy(desc(constellationAuditLog.createdAt))
    .limit(40);
  const ids = [...new Set(log.flatMap((l) => [l.actorId, l.targetUserId]).filter((x): x is string => !!x))];
  const people = ids.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.username ?? "a removed account") : null);
  res.json({
    constellation: {
      id: c.id,
      name: c.name,
      description: c.description,
      visibility: c.visibility,
      type: c.type,
      tags: c.tags,
      createdAt: c.createdAt.toISOString(),
      takenDownAt: c.takenDownAt?.toISOString() ?? null,
      takedownReason: c.takedownReason,
      owner,
      memberCount: (await memberIdsOf(c.id)).length,
      joinsToday: await db.$count(constellationMembers, and(eq(constellationMembers.constellationId, c.id), gte(constellationMembers.joinedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))),
      messagesToday: nebulaRows.reduce((sum, nb) => sum + nb.messagesToday, 0),
      openReports: (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(reports)
          .innerJoin(nebulas, eq(nebulas.conversationId, reports.conversationId))
          .where(and(eq(nebulas.constellationId, c.id), eq(reports.status, "open")))
      )[0].n,
      frozenAt: c.frozenAt?.toISOString() ?? null,
      invitesOffAt: c.invitesOffAt?.toISOString() ?? null,
      nebulas: nebulaRows,
      moderation: log.map((l) => ({ action: l.action, actor: name(l.actorId), target: name(l.targetUserId), details: l.details, createdAt: l.createdAt.toISOString() })),
    },
  });
});

constellationsAdminRouter.post("/constellations/:id/take-down", async (req, res) => {
  const parsed = z
    .object({ reason: z.string().trim().min(3, "Write why it's being taken down.").max(200), note: noteSchema })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = idParam.safeParse(req.params.id);
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c) {
    res.status(404).json({ error: "not_found", message: "That constellation is gone." });
    return;
  }
  await db.update(constellations).set({ takenDownAt: new Date(), takedownReason: parsed.data.reason }).where(eq(constellations.id, c.id));
  // Everyone in its voice nebulas is hung up; members see it disappear.
  const chats = await db.select({ id: nebulas.conversationId }).from(nebulas).where(eq(nebulas.constellationId, c.id));
  if (chats.length) {
    const open = await db
      .select({ id: calls.id })
      .from(calls)
      .where(and(inArray(calls.conversationId, chats.map((x) => x.id)), inArray(calls.status, ["ringing", "ongoing"])));
    for (const call of open) await closeCall(call.id, "not_allowed");
  }
  for (const userId of await memberIdsOf(c.id)) {
    emitToUser(userId, "constellation:removed", { constellationId: c.id, reason: "taken_down" }, true);
    emitToUser(userId, "constellations:changed", {}, true);
  }
  await logAction({
    adminId: admin(res).id,
    action: "Took down a constellation",
    targetUserId: c.ownerId,
    targetLabel: c.name,
    details: { constellationId: c.id, reason: parsed.data.reason },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `${c.name} is taken down. Nobody can see it now.` });
});

constellationsAdminRouter.post("/constellations/:id/restore", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = idParam.safeParse(req.params.id);
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c) {
    res.status(404).json({ error: "not_found", message: "That constellation is gone." });
    return;
  }
  await db.update(constellations).set({ takenDownAt: null, takedownReason: null }).where(eq(constellations.id, c.id));
  for (const userId of await memberIdsOf(c.id)) emitToUser(userId, "constellations:changed", {}, true);
  await logAction({
    adminId: admin(res).id,
    action: "Restored a constellation",
    targetUserId: c.ownerId,
    targetLabel: c.name,
    details: { constellationId: c.id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `${c.name} is back.` });
});

constellationsAdminRouter.post("/constellations/:id/delete", async (req, res) => {
  const parsed = z.object({ confirmName: z.string().trim().max(60), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = idParam.safeParse(req.params.id);
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c) {
    res.status(404).json({ error: "not_found", message: "That constellation is gone." });
    return;
  }
  if (parsed.data.confirmName !== c.name) {
    res.status(400).json({ error: "invalid", fields: { confirmName: `Type ${c.name} to confirm.` }, message: `Type ${c.name} to confirm.` });
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Deleted a constellation",
    targetUserId: c.ownerId,
    targetLabel: c.name,
    details: { constellationId: c.id },
    note: parsed.data.note,
    ip: ip(res),
  });
  await deleteConstellation(c.id);
  res.json({ ok: true, message: `${c.name} was deleted for good.` });
});

async function findConstellation(res: Parameters<Parameters<typeof constellationsAdminRouter.post>[1]>[1], raw: unknown) {
  const id = idParam.safeParse(raw);
  const [c] = id.success ? await db.select().from(constellations).where(eq(constellations.id, id.data)) : [];
  if (!c) res.status(404).json({ error: "not_found", message: "That constellation is gone." });
  return c ?? null;
}

// POST /admin/constellations/:id/freeze  { frozen, note }
constellationsAdminRouter.post("/constellations/:id/freeze", async (req, res) => {
  const parsed = z.object({ frozen: z.boolean(), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const c = await findConstellation(res, req.params.id);
  if (!c) return;
  if (!!c.frozenAt === parsed.data.frozen) {
    res.json({ ok: true, message: parsed.data.frozen ? `${c.name} is already frozen.` : `${c.name} isn't frozen.` });
    return;
  }
  await db.update(constellations).set({ frozenAt: parsed.data.frozen ? new Date() : null }).where(eq(constellations.id, c.id));
  await constellationChanged(c.id);
  await logAction({
    adminId: admin(res).id,
    action: parsed.data.frozen ? "Froze a constellation" : "Unfroze a constellation",
    targetUserId: c.ownerId,
    targetLabel: c.name,
    details: { constellationId: c.id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    message: parsed.data.frozen ? `${c.name} is frozen. Members can read, but nobody can post or join.` : `${c.name} is unfrozen.`,
  });
});

// POST /admin/constellations/:id/invites  { off, note }
constellationsAdminRouter.post("/constellations/:id/invites", async (req, res) => {
  const parsed = z.object({ off: z.boolean(), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const c = await findConstellation(res, req.params.id);
  if (!c) return;
  await db.update(constellations).set({ invitesOffAt: parsed.data.off ? (c.invitesOffAt ?? new Date()) : null }).where(eq(constellations.id, c.id));
  await constellationChanged(c.id);
  await logAction({
    adminId: admin(res).id,
    action: parsed.data.off ? "Turned off a constellation's invites" : "Turned a constellation's invites back on",
    targetUserId: c.ownerId,
    targetLabel: c.name,
    details: { constellationId: c.id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    message: parsed.data.off ? `${c.name}'s invite links stopped working, and no new ones can be made.` : `${c.name}'s invite links work again.`,
  });
});

// POST /admin/constellations/:id/transfer  { username, note } — a member becomes the Owner.
constellationsAdminRouter.post("/constellations/:id/transfer", async (req, res) => {
  const parsed = z
    .object({ username: z.string({ error: "Enter their username." }).trim().min(1, "Enter their username.").max(40), note: noteSchema })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const c = await findConstellation(res, req.params.id);
  if (!c) return;
  const name = parsed.data.username.replace(/^@/, "").toLowerCase();
  const [to] = await db.select({ id: users.id, username: users.username }).from(users).where(sql`lower(${users.username}) = ${name}`);
  const fail = (message: string, status = 409) => res.status(status).json({ error: "invalid", fields: { username: message }, message });
  if (!to) return fail("No one has that username.", 404);
  if (to.id === c.ownerId) return fail("They're already the Owner.");
  const [member] = await db
    .select({ userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, c.id), eq(constellationMembers.userId, to.id)));
  if (!member) return fail(`@${to.username} isn't in ${c.name}.`);
  if (await deletionPending(to.id)) return fail("Their account is set to be deleted.");
  if (await isRestricted(to.id)) return fail("A family-managed account can't own a constellation.");
  const theirs = await db.$count(constellations, and(eq(constellations.ownerId, to.id), isNull(constellations.takenDownAt)));
  if (theirs >= CONSTELLATIONS_OWNED_MAX) return fail(`They already own ${CONSTELLATIONS_OWNED_MAX} constellations, the most anyone can.`);
  const [from] = await db.select({ username: users.username }).from(users).where(eq(users.id, c.ownerId));
  await transferOwnership(c.id, c.ownerId, to.id);
  await syncNebulaAccess(c.id, { userIds: [c.ownerId, to.id] });
  await logModeration(c.id, null, "ownership_transferred", to.id);
  await constellationChanged(c.id);
  for (const id of [c.ownerId, to.id]) emitToUser(id, "constellations:changed", {}, true);
  await logAction({
    adminId: admin(res).id,
    action: "Transferred a constellation",
    targetUserId: to.id,
    targetLabel: `${c.name}: @${from?.username ?? "someone"} → @${to.username}`,
    details: { constellationId: c.id, fromId: c.ownerId, toId: to.id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `@${to.username} owns ${c.name} now. @${from?.username ?? "The old Owner"} keeps an Admin role.` });
});
