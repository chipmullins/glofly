import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { calls } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { canMessage } from "../friends/rules";
import { access, announce, canPost, GROUP_MAX, postEvent, type Access } from "../messages/routes";
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
  ringMore,
  startCall,
  type CallRow,
} from "./service";

// Voice and video calls: 1-on-1 and group (up to 25 people).
//
//   POST /calls                 { conversationId, video }  start a call → { call, token, url }
//   GET  /calls/active                                     ringing / ongoing calls in my chats
//   POST /calls/:id/answer                                  pick up → { call, token, url }
//   POST /calls/:id/join                                    join a group call, or get back into mine
//   POST /calls/:id/ring        { userIds }                groups: ring people who aren't in it
//   POST /calls/:id/decline
//   POST /calls/:id/leave                                   hang up (or cancel while it rings)

export const callsRouter = Router();
callsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

const idParam = z.uuid();

const startLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of calls. Wait a few minutes and try again." },
});

const actionLimiter = rateLimit({
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

/** A pass into the call's room, with where to find it. 1-on-1 rooms hold 2; group rooms 25. */
async function joinDetails(row: CallRow, user: Me, chat: Access) {
  const size = chat.kind === "group" ? GROUP_MAX : 2;
  return { call: await describe(row), token: await callToken(row.id, user, size), url: LIVEKIT_URL };
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
  if (chat.kind === "group") return canPost(chat, myId);
  return !!chat.partner && (await canMessage(myId, chat.partner));
}

const notFound = (res: Response) => res.status(404).json({ error: "not_found" });
const callOver = (res: Response) =>
  res.status(409).json({ error: "call_over", message: "This call has already ended." });
const ACTIVE = ["ringing", "ongoing"];

// POST /calls  { conversationId, video } — call a friend, or the whole group.
callsRouter.post("/", startLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const parsed = z.object({ conversationId: idParam, video: z.boolean() }).safeParse(req.body);
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
    });
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
