import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { calls, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { canMessage } from "../friends/rules";
import { access, announce, canPost, GROUP_MAX, postEvent, summaryOf, type Access } from "../messages/routes";
import { addPeopleToCall } from "./add";
import { callToken, LIVEKIT_URL, livekitConfigured } from "./livekit";
import {
  activeCallOf,
  activeCallsFor,
  announceCall,
  closeCall,
  declineCall,
  describe,
  isInCall,
  joinCall,
  leaveCall,
  peopleInCall,
  ringMore,
  startCall,
  stayInCall,
  type CallRow,
} from "./service";
import {
  controlWatch,
  previewVideo,
  othersNeedUpdate,
  reactWatch,
  reportWatch,
  setWatchControl,
  startWatch,
  stopWatch,
  siteLevel,
  watchUpdate,
  type WatchProblem,
} from "./watch";
import { isWatchReaction, VOICE_NEBULA_MAX, watchLinkFrom } from "@glofly/shared";
import { isVoiceMuted } from "./voiceMutes";

// Voice and video calls: 1-on-1 and group (up to 25 people).
//
//   POST /calls                 { conversationId, video, ring? }  start a call → { call, token, url }
//                               ring (groups, 0.5.2): only these people are rung; the rest can join
//   GET  /calls/active                                     ringing / ongoing calls in my chats
//   POST /calls/:id/answer                                  pick up → { call, token, url }
//   POST /calls/:id/join                                    join a group call, or get back into mine
//   POST /calls/:id/ring        { userIds }                groups: ring people who aren't in it
//   POST /calls/:id/decline
//   POST /calls/:id/leave                                   hang up (or cancel while it rings)
//   POST /calls/:id/add         { userIds }                0.5.2 Add people (calls/add.ts): a 1-on-1
//                                                           call moves to a new group; a group call
//                                                           rings them (adding friends to the group)
//                                                           → { call, conversation, moved }
//   POST /calls/:id/stay                                    0.5.2 groups: on your own, keep the call
//                                                           going another 7 minutes
//
// Watch Together (0.5.0, calls/watch.ts): a YouTube video everyone in the call watches together.
//   GET    /calls/watch/preview?link=     what a YouTube link is (title, channel, picture)
//   GET    /calls/:id/watch               what the call is watching → { callId, watch, serverNow }
//   POST   /calls/:id/watch               { link, control? }  start (or change) the video
//   POST   /calls/:id/watch/control       { action: play|pause|seek|back|forward, to? }
//   POST   /calls/:id/watch/settings      { control: everyone|starter }  (whoever picked it)
//   POST   /calls/:id/watch/report        { videoId, durationSec, title? }  a player says how long it is
//   POST   /calls/:id/watch/react         { reaction }  a firefly over the video
//   DELETE /calls/:id/watch               stop watching

export const callsRouter = Router();
callsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

const idParam = z.uuid();

const startLimiter = rateLimit("calls:start", {
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of calls. Wait a few minutes and try again." },
});

const addLimiter = rateLimit("calls:add", {
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of adding. Wait a few minutes and try again." },
});

const actionLimiter = rateLimit("calls:action", {
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

function notSetUp(res: Response): boolean {
  if (livekitConfigured) return false;
  res.status(503).json({ error: "calls_unavailable", message: "Calls aren't set up on this server yet." });
  return true;
}

/**
 * A pass into the call's room, with where to find it. Normal calls hold a group's worth of people
 * (0.5.2: a 1-on-1 call can become a group call without moving rooms; before, 1-on-1 rooms held 2);
 * voice nebulas 50 (2.0), where someone a moderator muted gets a pass without their microphone.
 * Only Glofly hands out passes, so nobody else gets in.
 */
export async function joinDetails(row: CallRow, user: Me, chat: Pick<Access, "kind">) {
  const size = chat.kind === "nebula" ? VOICE_NEBULA_MAX : GROUP_MAX;
  const microphone = chat.kind !== "nebula" || !isVoiceMuted(row.id, user.id);
  return { call: await describe(row), token: await callToken(row.id, user, size, microphone), url: LIVEKIT_URL };
}

/** A call in one of my chats (null otherwise, so other people's calls stay invisible). */
async function myCall(idRaw: unknown, myId: string) {
  const id = idParam.safeParse(idRaw);
  if (!id.success) return null;
  const [row] = await db.select().from(calls).where(eq(calls.id, id.data));
  if (!row) return null;
  const chat = await access(row.conversationId, myId);
  return chat ? { row, chat } : null;
}

/** 1-on-1 calls need us to still be friends; group calls just need me in the group. */
async function allowed(chat: Access, myId: string): Promise<boolean> {
  if (chat.kind !== "dm") return canPost(chat, myId); // groups; voice nebulas (not while timed out)
  return !!chat.partner && (await canMessage(myId, chat.partner));
}

/** A voice nebula's room that's already full (2.0), for someone not in it yet. Answers 409 if so. */
async function nebulaRoomFull(res: Response, row: CallRow, chat: Access, myId: string): Promise<boolean> {
  if (chat.kind !== "nebula") return false;
  const inRoom = await peopleInCall(row.id);
  if (inRoom.includes(myId) || inRoom.length < VOICE_NEBULA_MAX) return false;
  res.status(409).json({ error: "invalid", message: `This voice nebula is full (${VOICE_NEBULA_MAX} people).` });
  return true;
}

const notFound = (res: Response) => res.status(404).json({ error: "not_found" });
const callOver = (res: Response) =>
  res.status(409).json({ error: "call_over", message: "This call has already ended." });
const ACTIVE = ["ringing", "ongoing"];

// POST /calls  { conversationId, video } — call a friend, or the whole group.
callsRouter.post("/", startLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const parsed = z
    .object({ conversationId: idParam, video: z.boolean(), ring: z.array(idParam).min(1).max(GROUP_MAX).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick someone to call." });
    return;
  }
  const { conversationId, video } = parsed.data;
  const chat = await access(conversationId, user.id);
  if (!chat) {
    notFound(res);
    return;
  }
  if (chat.kind === "nebula") {
    // Voice nebulas are dropped into (POST /constellations/:id/nebulas/:nebulaId/voice), never rung.
    res.status(400).json({ error: "invalid", message: "Join the voice nebula instead." });
    return;
  }
  if (!(await allowed(chat, user.id))) {
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  if (chat.memberIds.length < 2) {
    res.status(400).json({ error: "invalid", message: "There's nobody else here to call." });
    return;
  }
  if (await activeCallOf(user.id)) {
    res.status(409).json({ error: "busy", message: "You're already in a call. Hang up first." });
    return;
  }
  if (chat.kind === "dm" && chat.partner && (await activeCallOf(chat.partner))) {
    res.status(409).json({ error: "busy", message: "They're on another call right now. Try again in a bit." });
    return;
  }
  // Groups (0.5.2): ring only some of the group. Everyone picked must be in it (not you).
  let ringOnly: string[] | null = null;
  if (parsed.data.ring) {
    const picked = [...new Set(parsed.data.ring)];
    if (chat.kind !== "group" || picked.some((id) => id === user.id || !chat.memberIds.includes(id))) {
      res.status(400).json({ error: "invalid", message: "Pick people in the group to ring." });
      return;
    }
    ringOnly = picked;
  }

  let started: Awaited<ReturnType<typeof startCall>>;
  const posted: { line?: Awaited<ReturnType<typeof postEvent>> } = {};
  try {
    started = await startCall(conversationId, user.id, video, async (tx, callId) => {
      posted.line = await postEvent(tx, conversationId, user.id, {
        type: "call",
        callId,
        video,
        status: "ringing",
        durationSec: null,
      });
      return posted.line;
    }, ringOnly);
  } catch (err) {
    // There's already a call ringing or going in this chat (say, two people pressed call at once).
    const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "already_calling", message: "There's already a call in this chat." });
      return;
    }
    throw err;
  }

  if (posted.line) await announce(posted.line, chat.memberIds);
  await announceCall(started.call);
  res.status(201).json(await joinDetails(started.call, user, chat));
});

// GET /calls/active — calls ringing or going on in my chats right now.
callsRouter.get("/active", async (_req, res) => {
  const myId = me(res).id;
  const result = [];
  for (const row of await activeCallsFor(myId)) {
    // `joined`: I'm in this call (maybe on another device), so the app offers to switch rather than ring.
    result.push({ call: await describe(row), joined: await isInCall(row.id, myId) });
  }
  res.json({ calls: result });
});

// POST /calls/:id/answer — pick up a call I'm being rung for.
callsRouter.post("/:id/answer", actionLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row, chat } = found;
  if (row.callerId === user.id && chat.kind === "dm") {
    res.status(400).json({ error: "invalid", message: "You can't answer your own call." });
    return;
  }
  if (!(await allowed(chat, user.id))) {
    if (chat.kind === "dm") await closeCall(row.id, "not_allowed");
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  // 1-on-1: only while it rings. Groups: any time it's going on.
  if (chat.kind === "dm" ? row.status !== "ringing" : !ACTIVE.includes(row.status)) {
    callOver(res);
    return;
  }
  const other = await activeCallOf(user.id);
  if (other && other.id !== row.id) {
    res.status(409).json({ error: "busy", message: "Hang up your other call first." });
    return;
  }
  if (chat.kind === "dm" && (await isInCall(row.id, user.id))) {
    callOver(res); // already answered (on another device)
    return;
  }
  if (await nebulaRoomFull(res, row, chat, user.id)) return;
  const joined = await joinCall(row.id, user.id);
  if (!joined) {
    callOver(res);
    return;
  }
  res.json(await joinDetails(joined, user, chat));
});

// POST /calls/:id/join — join a group call that's going on, or get back into a call I'm in
// (the app restarted, the connection dropped, or I'm moving it to this device).
callsRouter.post("/:id/join", actionLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row, chat } = found;
  if (!ACTIVE.includes(row.status)) {
    callOver(res);
    return;
  }
  if (!(await allowed(chat, user.id))) {
    if (chat.kind === "dm") await closeCall(row.id, "not_allowed");
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  const inIt = await isInCall(row.id, user.id);
  if (chat.kind === "dm") {
    // 1-on-1: only someone already in the call can get back in (answering is separate).
    if (!inIt) {
      callOver(res);
      return;
    }
    res.json(await joinDetails(row, user, chat));
    return;
  }
  const other = await activeCallOf(user.id);
  if (other && other.id !== row.id) {
    res.status(409).json({ error: "busy", message: "Hang up your other call first." });
    return;
  }
  if (!inIt && (await nebulaRoomFull(res, row, chat, user.id))) return;
  const joined = inIt ? row : await joinCall(row.id, user.id);
  if (!joined) {
    callOver(res);
    return;
  }
  res.json(await joinDetails(joined, user, chat));
});

// POST /calls/:id/ring  { userIds } — group calls: ring people in the group who aren't in the call.
callsRouter.post("/:id/ring", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  const parsed = z.object({ userIds: z.array(idParam).min(1).max(GROUP_MAX) }).safeParse(req.body);
  if (!found) {
    notFound(res);
    return;
  }
  if (!parsed.success || found.chat.kind !== "group") {
    res.status(400).json({ error: "invalid", message: "Pick people in the group to ring." });
    return;
  }
  const { row, chat } = found;
  if (!ACTIVE.includes(row.status)) {
    callOver(res);
    return;
  }
  if (!(await isInCall(row.id, user.id))) {
    res.status(403).json({ error: "forbidden", message: "Join the call first." });
    return;
  }
  const targets = [...new Set(parsed.data.userIds)].filter((id) => id !== user.id && chat.memberIds.includes(id));
  const notIn = [];
  for (const id of targets) if (!(await isInCall(row.id, id))) notIn.push(id);
  if (notIn.length) await ringMore(row.id, notIn);
  res.status(204).end();
});

// POST /calls/:id/add  { userIds } — Add people (0.5.2, calls/add.ts). 1-on-1: the call moves to
// a new group with everyone; groups: rings them (friends not in the group are added to it first).
callsRouter.post("/:id/add", addLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const parsed = z.object({ userIds: z.array(idParam).min(1).max(GROUP_MAX) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick people to add to the call." });
    return;
  }
  const result = await addPeopleToCall(found.row, found.chat, user.id, parsed.data.userIds);
  if ("status" in result) {
    res.status(result.status).json({ error: result.error, message: result.message });
    return;
  }
  const conversation = await summaryOf(user.id, result.call.conversationId);
  res.json({ call: await describe(result.call), conversation, moved: result.moved });
});

// POST /calls/:id/stay — group calls: you're on your own and want to keep waiting (another 7 minutes).
callsRouter.post("/:id/stay", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  if (found.chat.kind !== "group" || !ACTIVE.includes(found.row.status)) {
    callOver(res);
    return;
  }
  if (!(await isInCall(found.row.id, user.id))) {
    res.status(403).json({ error: "forbidden", message: "Join the call first." });
    return;
  }
  await stayInCall(found.row.id);
  res.status(204).end();
});

// POST /calls/:id/decline — don't pick up.
callsRouter.post("/:id/decline", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row } = found;
  if (row.callerId !== user.id && ACTIVE.includes(row.status) && !(await isInCall(row.id, user.id))) {
    await declineCall(row.id, user.id);
  }
  res.status(204).end();
});

// POST /calls/:id/leave — hang up. 1-on-1 (or the caller while it still rings): the call ends.
// Group calls carry on until the last person leaves.
callsRouter.post("/:id/leave", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  await leaveCall(found.row.id, user.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// Watch Together (0.5.0). Everything but the preview needs you in the call (on any device).

const watchLimiter = rateLimit("calls:watch", {
  windowMs: 60 * 1000,
  limit: 120, // dragging along the timeline sends a few
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

const reactLimiter = rateLimit("calls:react", {
  windowMs: 10 * 1000,
  limit: 25,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of fireflies! Give it a second." },
});

const previewLimiter = rateLimit("calls:preview", {
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

/** "Jordan" (their display name's first word). */
async function firstNameOf(userId: string): Promise<string> {
  const [u] = await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, userId));
  return u ? u.displayName.trim().split(/\s+/)[0] || u.username : "Someone";
}

const isProblem = (x: unknown): x is WatchProblem =>
  !!x && typeof x === "object" && "status" in x && "error" in x && typeof (x as WatchProblem).status === "number";

function problem(res: Response, p: WatchProblem): void {
  res.status(p.status).json({ error: p.error, message: p.message });
}

/** A call I'm in right now (on any device), still going on. Answers the request otherwise. */
async function callImIn(req: { params: Record<string, unknown> }, res: Response) {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return null;
  }
  if (!ACTIVE.includes(found.row.status)) {
    callOver(res);
    return null;
  }
  if (!(await isInCall(found.row.id, user.id))) {
    res.status(403).json({ error: "forbidden", message: "Join the call first." });
    return null;
  }
  return { ...found, user };
}

/** 0.7.1 apps add ?sites=1: they can show Twitch, Vimeo and Dailymotion, not only YouTube. */
// 0.9.3 apps add ?sites=2: Kick too.
const knowsSites = (req: { query: Record<string, unknown> }) => (req.query.sites === "2" ? 2 : req.query.sites === "1" ? 1 : 0);
const NOT_A_LINK = "That doesn't look like a YouTube, Twitch, Vimeo or Dailymotion link.";

// GET /calls/watch/preview?link= — what a link is, for the Start dialog.
callsRouter.get("/watch/preview", previewLimiter, async (req, res) => {
  const link = typeof req.query.link === "string" ? req.query.link : "";
  const found = watchLinkFrom(link);
  if (!found || knowsSites(req) < siteLevel(found.site)) {
    res.status(400).json({ error: "invalid", message: found ? "That doesn't look like a YouTube link." : NOT_A_LINK });
    return;
  }
  const result = await previewVideo(found.videoId, found.site, found.live);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, message: result.message });
    return;
  }
  res.json(result.preview);
});

// GET /calls/:id/watch — what the call is watching (anyone in the chat may ask).
callsRouter.get("/:id/watch", async (req, res) => {
  const found = await myCall(req.params.id, me(res).id);
  if (!found) {
    notFound(res);
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(watchUpdate(found.row.id, knowsSites(req)));
});

// POST /calls/:id/watch  { link, control? } — start watching a YouTube video together (or change it).
callsRouter.post("/:id/watch", watchLimiter, async (req, res) => {
  const parsed = z
    .object({ link: z.string().min(1).max(500), control: z.enum(["everyone", "starter"]).optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Paste a YouTube link." });
    return;
  }
  const link = watchLinkFrom(parsed.data.link);
  if (!link || knowsSites(req) < siteLevel(link.site)) {
    res.status(400).json({ error: "invalid", message: link ? "That doesn't look like a YouTube link." : NOT_A_LINK });
    return;
  }
  const videoId = link.videoId;
  const found = await callImIn(req, res);
  if (!found) return;
  const preview = await previewVideo(videoId, link.site, link.live);
  if (!preview.ok) {
    res.status(preview.status).json({ error: preview.error, message: preview.message });
    return;
  }
  const result = await startWatch(
    found.row.id,
    found.row.conversationId,
    found.user.id,
    {
      site: link.site,
      videoId,
      live: link.live,
      title: preview.preview.title,
      channel: preview.preview.channel,
      startSec: link.start,
      control: parsed.data.control,
    },
    firstNameOf,
  );
  if (isProblem(result)) {
    problem(res, result);
    return;
  }
  // The first video gets a line in the chat ("Jordan started watching “…” together"). Older apps
  // show it as a plain message from them (packages/shared/src/events.ts).
  if (result.first) {
    try {
      const line = await db.transaction((tx) =>
        postEvent(tx, found.row.conversationId, found.user.id, { type: "watch", videoId, title: result.state.title }),
      );
      await announce(line, found.chat.memberIds);
    } catch (err) {
      console.error("Couldn't post the Watch Together line:", err);
    }
  }
  // Someone in the call is on an app from before 0.7.1, which can only show YouTube.
  const needsUpdate = await othersNeedUpdate(found.row.id, found.row.conversationId, found.user.id, link.site).catch(() => false);
  res.status(201).json({ ...watchUpdate(found.row.id, knowsSites(req)), ...(needsUpdate ? { someoneNeedsUpdate: true } : {}) });
});

// POST /calls/:id/watch/control  { action, to? } — play, pause, skip, ±10 s for everyone.
callsRouter.post("/:id/watch/control", watchLimiter, async (req, res) => {
  const parsed = z
    .object({
      action: z.enum(["play", "pause", "seek", "back", "forward"]),
      to: z.number().finite().min(0).max(48 * 3600).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success || (parsed.data.action === "seek" && parsed.data.to === undefined)) {
    res.status(400).json({ error: "invalid", message: "That didn't work. Try again." });
    return;
  }
  const found = await callImIn(req, res);
  if (!found) return;
  const result = await controlWatch(found.row.id, found.user.id, parsed.data.action, parsed.data.to, firstNameOf);
  if (isProblem(result)) {
    problem(res, result);
    return;
  }
  res.json(watchUpdate(found.row.id, knowsSites(req)));
});

// POST /calls/:id/watch/settings  { control } — whoever picked the video: Everyone or Only me.
callsRouter.post("/:id/watch/settings", watchLimiter, async (req, res) => {
  const parsed = z.object({ control: z.enum(["everyone", "starter"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick Everyone or Only me." });
    return;
  }
  const found = await callImIn(req, res);
  if (!found) return;
  const result = await setWatchControl(found.row.id, found.user.id, parsed.data.control);
  if (isProblem(result)) {
    problem(res, result);
    return;
  }
  res.json(watchUpdate(found.row.id, knowsSites(req)));
});

// POST /calls/:id/watch/report  { videoId, durationSec, title? } — a player found out how long it is.
callsRouter.post("/:id/watch/report", watchLimiter, async (req, res) => {
  const parsed = z
    .object({
      videoId: z.string().regex(/^[A-Za-z0-9_:-]{4,40}$/),
      durationSec: z.number().finite().positive().max(48 * 3600),
      title: z.string().max(300).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const found = await callImIn(req, res);
  if (!found) return;
  await reportWatch(found.row.id, me(res).id, parsed.data.videoId, parsed.data.durationSec, parsed.data.title);
  res.status(204).end();
});

// POST /calls/:id/watch/react  { reaction } — a firefly floats over the video for everyone.
callsRouter.post("/:id/watch/react", reactLimiter, async (req, res) => {
  const reaction = (req.body as { reaction?: unknown } | undefined)?.reaction;
  if (!isWatchReaction(reaction)) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const found = await callImIn(req, res);
  if (!found) return;
  await reactWatch(found.row.id, found.row.conversationId, found.user.id, reaction);
  res.status(204).end();
});

// DELETE /calls/:id/watch — stop watching (for everyone).
callsRouter.delete("/:id/watch", watchLimiter, async (req, res) => {
  const found = await callImIn(req, res);
  if (!found) return;
  const result = await stopWatch(found.row.id, found.user.id, firstNameOf);
  if (result) {
    problem(res, result);
    return;
  }
  res.json(watchUpdate(found.row.id, knowsSites(req)));
});
