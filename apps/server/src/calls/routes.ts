import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { callParticipants, calls } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { canMessage } from "../friends/rules";
import { access, announce, canPost, postEvent } from "../messages/routes";
import { callToken, LIVEKIT_URL, livekitConfigured } from "./livekit";
import {
  activeCallOf,
  activeCallsFor,
  announceCall,
  answerCall,
  callInfo,
  closeCall,
  startRinging,
  type CallRow,
} from "./service";

// Voice and video calls (1-on-1 for now; group calls come next).
//
//   POST /calls                 { conversationId, video }  start a call → { call, token, url }
//   GET  /calls/active                                     ringing / ongoing calls in my chats
//   POST /calls/:id/answer                                  → { call, token, url }
//   POST /calls/:id/join                                    back into a call I'm part of (after a restart)
//   POST /calls/:id/decline
//   POST /calls/:id/leave                                   hang up (or cancel while it rings)

export const callsRouter = Router();
callsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

const idParam = z.uuid();
/** 1-on-1 calls: at most two people in a room. */
const DM_ROOM_SIZE = 2;

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
  res.status(503).json({
    error: "calls_unavailable",
    message: "Calls aren't set up on this server yet.",
  });
  return true;
}

/** A pass into the call's room, with where to find it. */
async function joinDetails(row: CallRow, user: Me) {
  return { call: callInfo(row), token: await callToken(row.id, user, DM_ROOM_SIZE), url: LIVEKIT_URL };
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

const notFound = (res: Response) => res.status(404).json({ error: "not_found" });

// POST /calls  { conversationId, video } — call a friend.
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
  if (chat.kind === "group") {
    res.status(400).json({ error: "invalid", message: "Group calls are coming soon." });
    return;
  }
  if (!(await canPost(chat, user.id)) || !chat.partner) {
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  if (await activeCallOf(user.id)) {
    res.status(409).json({ error: "busy", message: "You're already in a call. Hang up first." });
    return;
  }
  if (await activeCallOf(chat.partner)) {
    res.status(409).json({ error: "busy", message: "They're on another call right now. Try again in a bit." });
    return;
  }

  let started: { call: CallRow; line: Awaited<ReturnType<typeof postEvent>> };
  try {
    started = await db.transaction(async (tx) => {
      const [call] = await tx.insert(calls).values({ conversationId, callerId: user.id, video }).returning();
      await tx.insert(callParticipants).values({ callId: call.id, userId: user.id });
      const line = await postEvent(tx, conversationId, user.id, {
        type: "call",
        callId: call.id,
        video,
        status: "ringing",
        durationSec: null,
      });
      const [withLine] = await tx
        .update(calls)
        .set({ messageId: line.id })
        .where(eq(calls.id, call.id))
        .returning();
      return { call: withLine, line };
    });
  } catch (err) {
    // There's already a call ringing or going in this chat (say, you both pressed call at once).
    if ((err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      res.status(409).json({ error: "already_calling", message: "There's already a call in this chat." });
      return;
    }
    throw err;
  }

  await announce(started.line, chat.memberIds);
  await announceCall(started.call);
  startRinging(started.call.id);
  res.status(201).json(await joinDetails(started.call, user));
});

// GET /calls/active — calls ringing or going on in my chats right now.
callsRouter.get("/active", async (_req, res) => {
  const myId = me(res).id;
  const rows = await activeCallsFor(myId);
  const result = [];
  for (const row of rows) {
    const [mine] = await db
      .select({ leftAt: callParticipants.leftAt })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.userId, myId)));
    // `joined`: I'm in this call (so the app can offer to rejoin rather than ring).
    result.push({ call: callInfo(row), joined: !!mine && mine.leftAt === null });
  }
  res.json({ calls: result });
});

// POST /calls/:id/answer — pick up a call to me.
callsRouter.post("/:id/answer", actionLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row, chat } = found;
  if (row.callerId === user.id) {
    res.status(400).json({ error: "invalid", message: "You can't answer your own call." });
    return;
  }
  if (!chat.partner || !(await canMessage(user.id, chat.partner))) {
    await closeCall(row.id, "not_allowed");
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  if (row.status !== "ringing") {
    res.status(409).json({ error: "call_over", message: "This call has already ended." });
    return;
  }
  const other = await activeCallOf(user.id);
  if (other && other.id !== row.id) {
    res.status(409).json({ error: "busy", message: "Hang up your other call first." });
    return;
  }
  const answered = await answerCall(row.id, user.id);
  if (!answered) {
    res.status(409).json({ error: "call_over", message: "This call has already ended." });
    return;
  }
  res.json(await joinDetails(answered, user));
});

// POST /calls/:id/join — back into a call I'm part of (the app restarted, or lost its connection).
callsRouter.post("/:id/join", actionLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row, chat } = found;
  const [mine] = await db
    .select()
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.userId, user.id)));
  const canRejoin = !!mine && (row.status === "ongoing" || (row.status === "ringing" && row.callerId === user.id));
  if (!canRejoin) {
    res.status(409).json({ error: "call_over", message: "This call has already ended." });
    return;
  }
  if (!chat.partner || !(await canMessage(user.id, chat.partner))) {
    await closeCall(row.id, "not_allowed");
    res.status(403).json({ error: "forbidden", message: "You can only call your friends." });
    return;
  }
  if (mine.leftAt) {
    await db
      .update(callParticipants)
      .set({ leftAt: null })
      .where(and(eq(callParticipants.callId, row.id), eq(callParticipants.userId, user.id)));
  }
  res.json(await joinDetails(row, user));
});

// POST /calls/:id/decline — don't pick up.
callsRouter.post("/:id/decline", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  if (found.row.callerId !== user.id && found.row.status === "ringing") {
    await closeCall(found.row.id, "declined");
  }
  res.status(204).end();
});

// POST /calls/:id/leave — hang up. While it's still ringing, the caller hanging up cancels it.
callsRouter.post("/:id/leave", actionLimiter, async (req, res) => {
  const user = me(res);
  const found = await myCall(req.params.id, user.id);
  if (!found) {
    notFound(res);
    return;
  }
  const { row } = found;
  if (row.status === "ringing") {
    // The person being called "leaving" a ringing call is declining it.
    await closeCall(row.id, row.callerId === user.id ? "hang_up" : "declined");
  } else if (row.status === "ongoing") {
    // 1-on-1: when either person hangs up, the call is over.
    await closeCall(row.id, "hang_up");
  }
  res.status(204).end();
});
