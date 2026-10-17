import { randomInt, randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  TRIVIA,
  TRIVIA_COUNT,
  WORDS,
  gameFallback,
  guessWord,
  newTicTacToe,
  newTrivia,
  newWordGuess,
  pickTrivia,
  playTicTacToe,
  revealTrivia,
  type GameState,
  type Trivia,
  type WordGuess,
} from "@glofly/shared";
import { requireAuth } from "../auth/sessions";
import { db } from "../db";
import { messages, pollVotes, type GameInfo } from "../db/schema";
import { emitToUser } from "../realtime";
import { storage } from "../storage";
import { access, canPost, messageIn, postSpecial, sendUpdated } from "./routes";
import { pollFallback, POLL_OPTIONS_MAX, POLL_TEXT_MAX } from "./polls";
import { previewImageKey } from "./links";
import { removePreviewImage } from "./previews";

// 0.5.0 chat extras, all under /conversations/:id:
//
//   GET    /messages/:mid/preview-image     a link preview's picture
//   DELETE /messages/:mid/preview           remove the preview from your own message
//   POST   /polls                           { question, options[2–6], multi }   (groups)
//   PUT    /messages/:mid/vote              { options: number[] }  ([] takes your vote back)
//   POST   /messages/:mid/close-poll        whoever asked can close it
//   POST   /games                           { kind: tictactoe | wordguess | trivia }
//   POST   /messages/:mid/move              { square } | { word } | { question, choice } | { reveal: true }
//   POST   /fireflies                       { emoji: ❤️ | 🔥 }  a firefly swarm across the chat

export const extrasRouter = Router();
extrasRouter.use(requireAuth);

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message },
  });
const createLimiter = limiter(60_000, 15, "That's a lot at once. Wait a minute and try again.");
const moveLimiter = limiter(10_000, 30, "Slow down a little and try again.");
const fireflyLimiter = limiter(60_000, 10, "That's a lot of fireflies! Give them a minute.");

const notFound = (res: Response) => res.status(404).json({ error: "not_found" });

/** A chat I'm in and may post in, and (optionally) one of its messages. Answers the request otherwise. */
async function load(res: Response, conversationRaw: unknown, messageRaw?: unknown) {
  const conversationId = idParam.safeParse(conversationRaw);
  if (!conversationId.success) return void notFound(res);
  const chat = await access(conversationId.data, me(res).id);
  if (!chat) return void notFound(res);
  let message = null;
  if (messageRaw !== undefined) {
    const messageId = idParam.safeParse(messageRaw);
    message = messageId.success ? await messageIn(conversationId.data, messageId.data) : null;
    if (!message || message.deletedAt || message.event) return void notFound(res);
  }
  return { chat, conversationId: conversationId.data, message };
}

async function mayPost(res: Response, chat: NonNullable<Awaited<ReturnType<typeof access>>>): Promise<boolean> {
  if (await canPost(chat, me(res).id)) return true;
  res.status(403).json({ error: "forbidden", message: "You can only do that in chats with friends." });
  return false;
}

// ---- Link previews ----

extrasRouter.get("/:id/messages/:mid/preview-image", async (req, res) => {
  const found = await load(res, req.params.id, req.params.mid);
  if (!found) return;
  const file = found.message?.linkPreview?.image ? await storage.get(previewImageKey(found.conversationId, found.message.id)) : null;
  if (!file) return void notFound(res);
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=86400");
  file.stream.pipe(res);
});

extrasRouter.delete("/:id/messages/:mid/preview", async (req, res) => {
  const found = await load(res, req.params.id, req.params.mid);
  if (!found?.message) return;
  if (found.message.senderId !== me(res).id) {
    res.status(403).json({ error: "forbidden", message: "Only whoever sent it can remove its preview." });
    return;
  }
  await db.update(messages).set({ linkPreview: null }).where(eq(messages.id, found.message.id));
  await removePreviewImage(found.message.id);
  res.json({ message: await sendUpdated(found.message.id, found.conversationId) });
});

// ---- Polls ----

const pollText = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(POLL_TEXT_MAX));

extrasRouter.post("/:id/polls", createLimiter, async (req, res) => {
  const found = await load(res, req.params.id);
  if (!found) return;
  const { chat, conversationId } = found;
  if (chat.kind !== "group") {
    res.status(400).json({ error: "invalid", message: "Polls are for groups." });
    return;
  }
  if (!(await mayPost(res, chat))) return;
  const parsed = z
    .object({ question: pollText, options: z.array(pollText).min(2).max(POLL_OPTIONS_MAX), multi: z.boolean().optional() })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: `Ask a question and give 2 to ${POLL_OPTIONS_MAX} choices.` });
    return;
  }
  const options = [...new Set(parsed.data.options)];
  if (options.length < 2) {
    res.status(400).json({ error: "invalid", message: "Give at least two different choices." });
    return;
  }
  const message = await postSpecial(
    chat,
    conversationId,
    me(res).id,
    {
      body: pollFallback(parsed.data.question, options),
      poll: { question: parsed.data.question, options, multi: !!parsed.data.multi, closedAt: null },
    },
    res.locals.sessionId,
  );
  res.status(201).json({ message });
});

extrasRouter.put("/:id/messages/:mid/vote", moveLimiter, async (req, res) => {
  const found = await load(res, req.params.id, req.params.mid);
  if (!found?.message) return;
  const { chat, conversationId, message } = found;
  if (!message.poll) return void notFound(res);
  if (!(await mayPost(res, chat))) return;
  if (message.poll.closedAt) {
    res.status(409).json({ error: "closed", message: "This poll is closed." });
    return;
  }
  const picked = z.array(z.number().int().min(0).max(message.poll.options.length - 1)).max(POLL_OPTIONS_MAX).safeParse(req.body?.options);
  const options = picked.success ? [...new Set(picked.data)] : null;
  if (!options || (!message.poll.multi && options.length > 1)) {
    res.status(400).json({ error: "invalid", message: "Pick a choice." });
    return;
  }
  const myId = me(res).id;
  await db.transaction(async (tx) => {
    await tx.delete(pollVotes).where(and(eq(pollVotes.messageId, message.id), eq(pollVotes.userId, myId)));
    if (options.length) await tx.insert(pollVotes).values(options.map((option) => ({ messageId: message.id, userId: myId, option })));
  });
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

extrasRouter.post("/:id/messages/:mid/close-poll", moveLimiter, async (req, res) => {
  const found = await load(res, req.params.id, req.params.mid);
  if (!found?.message) return;
  const { conversationId, message } = found;
  if (!message.poll) return void notFound(res);
  if (message.senderId !== me(res).id) {
    res.status(403).json({ error: "forbidden", message: "Only whoever asked can close the poll." });
    return;
  }
  if (!message.poll.closedAt) {
    await db.update(messages).set({ poll: { ...message.poll, closedAt: new Date().toISOString() } }).where(eq(messages.id, message.id));
  }
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

// ---- Mini games ----

extrasRouter.post("/:id/games", createLimiter, async (req, res) => {
  const found = await load(res, req.params.id);
  if (!found) return;
  const { chat, conversationId } = found;
  if (!(await mayPost(res, chat))) return;
  const kind = z.enum(["tictactoe", "wordguess", "trivia"]).safeParse(req.body?.kind);
  if (!kind.success) {
    res.status(400).json({ error: "invalid", message: "Pick a game." });
    return;
  }
  const myId = me(res).id;
  let game: GameState & { secret?: string };
  if (kind.data === "tictactoe") game = newTicTacToe(myId);
  else if (kind.data === "wordguess") game = { ...newWordGuess(), secret: WORDS[randomInt(WORDS.length)] };
  else {
    const pool = [...TRIVIA];
    const picked = [];
    for (let i = 0; i < TRIVIA_COUNT && pool.length; i++) picked.push(pool.splice(randomInt(pool.length), 1)[0]);
    game = newTrivia(myId, picked);
  }
  const message = await postSpecial(
    chat,
    conversationId,
    myId,
    { body: gameFallback(kind.data), game: game as unknown as GameInfo },
    res.locals.sessionId,
  );
  res.status(201).json({ message });
});

class MoveRefused extends Error {}

extrasRouter.post("/:id/messages/:mid/move", moveLimiter, async (req, res) => {
  const found = await load(res, req.params.id, req.params.mid);
  if (!found?.message) return;
  const { chat, conversationId, message } = found;
  if (!message.game) return void notFound(res);
  if (!(await mayPost(res, chat))) return;
  const myId = me(res).id;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    await db.transaction(async (tx) => {
      // One move at a time per game: the row is locked while this one is checked.
      const [row] = await tx.select({ game: messages.game }).from(messages).where(eq(messages.id, message.id)).for("update");
      const g = row?.game as unknown as (GameState & { secret?: string }) | null;
      if (!g) throw new MoveRefused("This game is gone.");
      let next: (GameState & { secret?: string }) | string;
      if (g.kind === "tictactoe") next = playTicTacToe(g, myId, Number(body.square));
      else if (g.kind === "wordguess") {
        const secret = (g as WordGuess & { secret?: string }).secret ?? "";
        const played = typeof body.word === "string" ? guessWord(g, myId, body.word, secret) : "Guess a word.";
        next = typeof played === "string" ? played : { ...played, secret };
      } else {
        const t = g as Trivia;
        if (body.reveal === true) {
          if (t.host !== myId) throw new MoveRefused("Only whoever started the game can show the answer early.");
          next = revealTrivia(t);
        } else {
          const picked = pickTrivia(t, myId, Number(body.question), Number(body.choice));
          if (typeof picked === "string") next = picked;
          else {
            // Everyone in the chat has answered: show the answer and move on.
            const answered = new Set(picked.picks.filter((p) => p.question === picked.current).map((p) => p.userId));
            next = chat.memberIds.every((id) => answered.has(id)) ? revealTrivia(picked) : picked;
          }
        }
      }
      if (typeof next === "string") throw new MoveRefused(next);
      await tx.update(messages).set({ game: next as unknown as GameInfo }).where(eq(messages.id, message.id));
    });
  } catch (err) {
    if (err instanceof MoveRefused) {
      res.status(409).json({ error: "refused", message: err.message });
      return;
    }
    throw err;
  }
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

// ---- Firefly reactions across the chat ----

extrasRouter.post("/:id/fireflies", fireflyLimiter, async (req, res) => {
  const found = await load(res, req.params.id);
  if (!found) return;
  const { chat, conversationId } = found;
  if (!(await mayPost(res, chat))) return;
  const emoji = req.body?.emoji === "🔥" ? "🔥" : req.body?.emoji === "❤️" ? "❤️" : null;
  if (!emoji) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const payload = { conversationId, userId: me(res).id, emoji, id: randomUUID() };
  for (const userId of chat.memberIds) emitToUser(userId, "chat:fireflies", payload);
  res.status(204).end();
});
