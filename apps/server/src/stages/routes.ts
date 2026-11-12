import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  STAGE_LISTENERS_MAX,
  STAGE_SPEAKERS_MAX,
  cleanStageTopic,
  type MyStage,
  type StagePass,
} from "@glofly/shared";
import { db } from "../db";
import { nebulas, stagePeople, stages } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { emitToUser } from "../realtime";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";
import { LIVEKIT_URL, livekitConfigured, removeByPrefix, removeFromRoom, stageToken } from "../calls/livekit";
import { can, FROZEN_MESSAGE, frozen, outranks, standingOf, type Standing } from "../constellations/perms";
import { seesNebulaChat } from "../constellations/access";
import { logModeration } from "../constellations/activity";
import { announce, endStage, liveStageOf, remember, roomOf, speakersOf, stateOf, type LiveStage, type Person } from "./state";

// Communities round 2 (Nov 2026), board 3a: stage nebulas.
//
//   GET    /constellations/:id/nebulas/:nid/stage            { stage | null, me }
//   POST   /constellations/:id/nebulas/:nid/stage            { topic, handsOn?, listenerChat?, speakerLimit? } start it (Manage stages) → StagePass
//   PATCH  /constellations/:id/nebulas/:nid/stage            { topic?, handsOn?, listenerChat?, speakerLimit? } (Manage stages)
//   DELETE /constellations/:id/nebulas/:nid/stage            end it for everyone (Manage stages)
//   POST   …/stage/join   { as: "listener" | "speaker" }      a pass for the room (speaker: up, asked up, or a manager)
//   POST   …/stage/ping                                       "still here" every 30 s → { role } (null: not on it any more)
//   POST   …/stage/leave                                      leave quietly
//   POST   …/stage/hand   { up }                              raise / lower my hand
//   POST   …/stage/invite { userId, invited }                 ask someone up / take it back (Manage stages)
//   POST   …/stage/audience { userId }                        move a speaker to the audience (Manage stages, or yourself)
//
// Every route is after the Pause gate (mounted in index.ts with the other constellation routes).

export const stagesRouter = Router();
const PATHS = ["/:id/nebulas/:nid/stage", "/:id/nebulas/:nid/stage/*rest"];
stagesRouter.use(PATHS, requireAuth);
stagesRouter.use(PATHS, async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

type Me = { id: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const bad = (res: Response, message: string, status = 400) => res.status(status).json({ error: status === 403 ? "forbidden" : status === 409 ? "conflict" : "invalid", message });
const notFound = (res: Response) => res.status(404).json({ error: "not_found", message: "That nebula isn't there any more." });

const limiter = (name: string, limit: number) =>
  rateLimit(name, {
    windowMs: 10 * 60 * 1000,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message: "That's a lot. Wait a few minutes and try again." },
  });
const joinLimiter = limiter("stages:join", 60);
const changeLimiter = limiter("stages:change", 200);
// Pings come every 30 s; this leaves room for a few open devices.
const pingLimiter = limiter("stages:ping", 200);

/** Room size: every listener plus every possible speaker (and a little room for reconnects). */
const ROOM_SIZE = STAGE_LISTENERS_MAX + STAGE_SPEAKERS_MAX + 20;

type Found = { s: Standing; n: typeof nebulas.$inferSelect };

/** The stage nebula and my standing (404s for anything I can't see). */
async function stageNebula(req: Request, res: Response): Promise<Found | null> {
  const id = idParam.safeParse(req.params.id);
  const nid = idParam.safeParse(req.params.nid);
  if (!id.success || !nid.success) {
    notFound(res);
    return null;
  }
  const s = await standingOf(id.data, me(res).id);
  const [n] = s ? await db.select().from(nebulas).where(and(eq(nebulas.id, nid.data), eq(nebulas.constellationId, id.data))) : [];
  if (!s || !n || !(await seesNebulaChat(s.userId, n.conversationId))) {
    notFound(res);
    return null;
  }
  if (n.kind !== "stage") {
    bad(res, "That's not a stage nebula.");
    return null;
  }
  return { s, n };
}

const manages = (s: Standing) => can(s, "manageStages");

function myStage(stage: LiveStage | null, s: Standing): MyStage {
  const p = stage?.people.get(s.userId);
  const here = stage?.here.get(s.userId);
  const role: MyStage["role"] = !stage
    ? null
    : here && here.speaker && p?.speaker
      ? "speaker"
      : p?.invited && !p.speaker
        ? "invited"
        : here
          ? "listener"
          : null;
  return { role, handUp: !!p?.handAt && !p.speaker, manage: manages(s) };
}

/** Why I can't speak or raise a hand right now (null: I can). */
async function cantTalk(s: Standing): Promise<string | null> {
  if (s.timedOutUntil) return "You're timed out for now, so you can listen but not speak.";
  if (await frozen(s.constellationId)) return FROZEN_MESSAGE;
  if (await lockedDown(s.userId)) return LOCKDOWN_MESSAGE.message;
  return null;
}

async function savePerson(stage: LiveStage, userId: string, p: Person): Promise<void> {
  stage.people.set(userId, p);
  await db
    .insert(stagePeople)
    .values({ stageId: stage.id, userId, ...p })
    .onConflictDoUpdate({ target: [stagePeople.stageId, stagePeople.userId], set: { speaker: p.speaker, invited: p.invited, handAt: p.handAt, upAt: p.upAt } });
}

const blank = (): Person => ({ speaker: false, invited: false, handAt: null, upAt: null });

async function passFor(stage: LiveStage, s: Standing, user: Me, role: "speaker" | "listener"): Promise<StagePass> {
  const room = roomOf(stage.id);
  // One pass at a time per person: a new one replaces the old (a listener coming up, a speaker going down).
  if (role === "speaker") await removeByPrefix(room, `listen:${user.id}:`);
  else await removeFromRoom(room, user.id);
  const { token } = await stageToken(room, user, role, ROOM_SIZE);
  stage.here.set(user.id, { at: Date.now(), speaker: role === "speaker" });
  if (role === "speaker") stage.lastSpeakerAt = Date.now();
  announce(stage.nebulaId);
  return { url: LIVEKIT_URL, token, room, role, stage: stateOf(stage, manages(s)), me: myStage(stage, s) };
}

const settingsBody = z.object({
  topic: z.string().max(200).optional(),
  handsOn: z.boolean().optional(),
  listenerChat: z.boolean().optional(),
  speakerLimit: z.number().int().min(1).max(STAGE_SPEAKERS_MAX).optional(),
});

stagesRouter.get("/:id/nebulas/:nid/stage", async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  res.json({ stage: stage ? stateOf(stage, manages(f.s)) : null, me: myStage(stage, f.s) });
});

stagesRouter.post("/:id/nebulas/:nid/stage", changeLimiter, async (req, res) => {
  if (!livekitConfigured) {
    res.status(503).json({ error: "calls_unavailable", message: "Voice isn't set up on this server yet." });
    return;
  }
  const f = await stageNebula(req, res);
  if (!f) return;
  if (!manages(f.s)) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  const why = await cantTalk(f.s);
  if (why) {
    bad(res, why, 403);
    return;
  }
  const parsed = settingsBody.safeParse(req.body);
  const topic = cleanStageTopic(parsed.success ? parsed.data.topic : null);
  if (!parsed.success || !topic) {
    bad(res, "Give the stage a topic (up to 80 characters).");
    return;
  }
  if (await liveStageOf(f.n.id)) {
    bad(res, "A stage is already live here.", 409);
    return;
  }
  const speakerLimit = parsed.data.speakerLimit ?? f.n.stageSpeakerLimit;
  const [row] = await db
    .insert(stages)
    .values({ nebulaId: f.n.id, topic, startedBy: f.s.userId, handsOn: parsed.data.handsOn ?? true, listenerChat: parsed.data.listenerChat ?? false, speakerLimit })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    bad(res, "A stage is already live here.", 409);
    return;
  }
  const stage: LiveStage = {
    id: row.id,
    nebulaId: f.n.id,
    constellationId: f.s.constellationId,
    conversationId: f.n.conversationId,
    topic,
    startedBy: f.s.userId,
    startedAt: row.startedAt,
    handsOn: row.handsOn,
    listenerChat: row.listenerChat,
    speakerLimit,
    people: new Map(),
    here: new Map(),
    lastSpeakerAt: Date.now(),
  };
  remember(stage);
  await savePerson(stage, f.s.userId, { speaker: true, invited: false, handAt: null, upAt: new Date() });
  await logModeration(f.s.constellationId, f.s.userId, "stage_started", null, { nebula: f.n.name, topic });
  res.status(201).json(await passFor(stage, f.s, me(res), "speaker"));
});

stagesRouter.patch("/:id/nebulas/:nid/stage", changeLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  if (!manages(f.s)) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  const stage = await liveStageOf(f.n.id);
  if (!stage) {
    bad(res, "There's no stage live here.", 409);
    return;
  }
  const parsed = settingsBody.safeParse(req.body);
  if (!parsed.success) {
    bad(res, "That didn't work.");
    return;
  }
  const changes: Partial<typeof stages.$inferInsert> = {};
  if (parsed.data.topic !== undefined) {
    const topic = cleanStageTopic(parsed.data.topic);
    if (!topic) {
      bad(res, "Give the stage a topic (up to 80 characters).");
      return;
    }
    changes.topic = stage.topic = topic;
  }
  if (parsed.data.handsOn !== undefined) changes.handsOn = stage.handsOn = parsed.data.handsOn;
  if (parsed.data.listenerChat !== undefined) changes.listenerChat = stage.listenerChat = parsed.data.listenerChat;
  if (parsed.data.speakerLimit !== undefined) changes.speakerLimit = stage.speakerLimit = parsed.data.speakerLimit;
  if (Object.keys(changes).length) await db.update(stages).set(changes).where(eq(stages.id, stage.id));
  announce(stage.nebulaId, true);
  res.json({ stage: stateOf(stage, true), me: myStage(stage, f.s) });
});

stagesRouter.delete("/:id/nebulas/:nid/stage", changeLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  if (!manages(f.s)) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  const stage = await liveStageOf(f.n.id);
  if (stage) {
    await endStage(f.n.id);
    await logModeration(f.s.constellationId, f.s.userId, "stage_ended", null, { nebula: f.n.name, topic: stage.topic });
  }
  res.status(204).end();
});

stagesRouter.post("/:id/nebulas/:nid/stage/join", joinLimiter, async (req, res) => {
  if (!livekitConfigured) {
    res.status(503).json({ error: "calls_unavailable", message: "Voice isn't set up on this server yet." });
    return;
  }
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  if (!stage) {
    bad(res, "This stage has ended.", 409);
    return;
  }
  const as = req.body?.as === "speaker" ? "speaker" : "listener";
  const p = stage.people.get(f.s.userId) ?? blank();
  if (as === "speaker") {
    if (!p.speaker && !p.invited && !manages(f.s)) {
      bad(res, "Raise your hand and wait to be asked up.", 403);
      return;
    }
    const why = await cantTalk(f.s);
    if (why) {
      bad(res, why, 403);
      return;
    }
    const up = speakersOf(stage).filter((id) => id !== f.s.userId);
    if (up.length >= stage.speakerLimit) {
      bad(res, `The stage is full (${stage.speakerLimit} speakers).`, 409);
      return;
    }
    if (!p.speaker || p.invited || p.handAt) await savePerson(stage, f.s.userId, { speaker: true, invited: false, handAt: null, upAt: p.upAt ?? new Date() });
    res.json(await passFor(stage, f.s, me(res), "speaker"));
    return;
  }
  const here = stage.here.get(f.s.userId);
  const listening = [...stage.here.values()].filter((h) => !h.speaker).length;
  if (!here && listening >= STAGE_LISTENERS_MAX) {
    bad(res, `This stage is full (${STAGE_LISTENERS_MAX.toLocaleString("en-US")} listening).`, 409);
    return;
  }
  // Coming down to listen: no longer up there.
  if (p.speaker) await savePerson(stage, f.s.userId, { ...p, speaker: false, upAt: null });
  res.json(await passFor(stage, f.s, me(res), "listener"));
});

stagesRouter.post("/:id/nebulas/:nid/stage/ping", pingLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  const here = stage?.here.get(f.s.userId);
  // After a restart nobody is "here": a ping brings them back as what they were.
  if (stage && !here && typeof req.body?.as === "string") {
    const speaker = req.body.as === "speaker" && !!stage.people.get(f.s.userId)?.speaker;
    stage.here.set(f.s.userId, { at: Date.now(), speaker });
    announce(stage.nebulaId);
  } else if (stage && here) here.at = Date.now();
  if (stage && stage.here.get(f.s.userId)?.speaker) stage.lastSpeakerAt = Date.now();
  res.json({ me: myStage(stage, f.s), live: !!stage });
});

stagesRouter.post("/:id/nebulas/:nid/stage/leave", async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  if (stage) {
    const p = stage.people.get(f.s.userId);
    stage.here.delete(f.s.userId);
    if (p && (p.speaker || p.handAt)) await savePerson(stage, f.s.userId, { ...p, speaker: false, handAt: null, upAt: null });
    await removeFromRoom(roomOf(stage.id), f.s.userId);
    await removeByPrefix(roomOf(stage.id), `listen:${f.s.userId}:`);
    announce(stage.nebulaId);
  }
  res.status(204).end();
});

stagesRouter.post("/:id/nebulas/:nid/stage/hand", changeLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  if (!stage) {
    bad(res, "This stage has ended.", 409);
    return;
  }
  const up = req.body?.up === true;
  const p = stage.people.get(f.s.userId) ?? blank();
  if (up) {
    if (!stage.handsOn) {
      bad(res, "Raised hands are off for this stage.", 403);
      return;
    }
    const why = await cantTalk(f.s);
    if (why) {
      bad(res, why, 403);
      return;
    }
    if (p.speaker) {
      bad(res, "You're already on stage.", 409);
      return;
    }
  }
  if (up !== !!p.handAt) await savePerson(stage, f.s.userId, { ...p, handAt: up ? new Date() : null });
  announce(stage.nebulaId);
  res.json({ me: myStage(stage, f.s) });
});

stagesRouter.post("/:id/nebulas/:nid/stage/invite", changeLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  if (!manages(f.s)) {
    bad(res, "Your role doesn't allow that here.", 403);
    return;
  }
  const stage = await liveStageOf(f.n.id);
  if (!stage) {
    bad(res, "This stage has ended.", 409);
    return;
  }
  const uid = idParam.safeParse(req.body?.userId);
  const t = uid.success ? await standingOf(f.s.constellationId, uid.data) : null;
  if (!t || !(await seesNebulaChat(t.userId, f.n.conversationId))) {
    res.status(404).json({ error: "not_found", message: "They're not in this constellation." });
    return;
  }
  const invited = req.body?.invited !== false;
  const p = stage.people.get(t.userId) ?? blank();
  if (invited) {
    if (p.speaker && stage.here.get(t.userId)?.speaker) {
      bad(res, "They're already on stage.", 409);
      return;
    }
    if (await cantTalk(t)) {
      bad(res, "They can't speak right now.", 409);
      return;
    }
  }
  await savePerson(stage, t.userId, { ...p, invited });
  emitToUser(t.userId, "stage:invited", { constellationId: f.s.constellationId, nebulaId: f.n.id, byName: me(res).displayName, invited }, true);
  announce(stage.nebulaId);
  res.json({ stage: stateOf(stage, true) });
});

stagesRouter.post("/:id/nebulas/:nid/stage/audience", changeLimiter, async (req, res) => {
  const f = await stageNebula(req, res);
  if (!f) return;
  const stage = await liveStageOf(f.n.id);
  if (!stage) {
    bad(res, "This stage has ended.", 409);
    return;
  }
  const uid = idParam.safeParse(req.body?.userId ?? f.s.userId);
  if (!uid.success) {
    bad(res, "That didn't work.");
    return;
  }
  const self = uid.data === f.s.userId;
  if (!self) {
    if (!manages(f.s)) {
      bad(res, "Your role doesn't allow that here.", 403);
      return;
    }
    const t = await standingOf(f.s.constellationId, uid.data);
    // Only people ranked below you (never the owner), like every other moderation action.
    if (t && !outranks(f.s, t)) {
      bad(res, "You can only do that to people with a lower role than yours.", 403);
      return;
    }
  }
  const p = stage.people.get(uid.data);
  if (p) await savePerson(stage, uid.data, { ...p, speaker: false, invited: false, handAt: null, upAt: null });
  const h = stage.here.get(uid.data);
  if (h) h.speaker = false;
  await removeFromRoom(roomOf(stage.id), uid.data);
  emitToUser(uid.data, "stage:moved", { constellationId: f.s.constellationId, nebulaId: f.n.id }, true);
  announce(stage.nebulaId, true);
  res.json({ stage: stateOf(stage, manages(f.s)) });
});
