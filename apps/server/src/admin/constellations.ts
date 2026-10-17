import { Router } from "express";
import { and, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
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
import { memberIdsOf } from "../constellations/activity";
import { deleteConstellation } from "../constellations/routes";
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

export const constellationsAdminRouter = Router();

const idParam = z.uuid();

constellationsAdminRouter.get("/constellations", async (req, res) => {
  const q = z.string().trim().max(60).catch("").parse(req.query.q);
  const status = z.enum(["all", "live", "taken_down"]).catch("all").parse(req.query.status);
  const offset = z.coerce.number().int().min(0).catch(0).parse(req.query.offset);
  const memberCount = sql<number>`(select count(*)::int from ${constellationMembers} cm where cm.constellation_id = ${constellations.id})`;
  const openReports = sql<number>`(select count(*)::int from ${reports} r join ${nebulas} n on n.conversation_id = r.conversation_id where n.constellation_id = ${constellations.id} and r.status = 'open')`;
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
    })
    .from(constellations)
    .innerJoin(users, eq(users.id, constellations.ownerId))
    .where(
      and(
        q ? ilike(constellations.name, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
        status === "live" ? sql`${constellations.takenDownAt} is null` : status === "taken_down" ? isNotNull(constellations.takenDownAt) : undefined,
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
    })),
    hasMore: rows.length > 50,
  });
});

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
      messages: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${nebulas.conversationId})`,
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
