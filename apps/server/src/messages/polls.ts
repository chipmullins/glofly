import { asc, inArray } from "drizzle-orm";
import type { Poll } from "@glofly/shared";
import { db } from "../db";
import { pollVotes, type PollInfo } from "../db/schema";

// Polls (0.5.0): the votes behind them, and how a poll looks to the apps.

export const POLL_OPTIONS_MAX = 6;
export const POLL_TEXT_MAX = 120;

/** Votes on these poll messages: message id → (option, user) in the order they were cast. */
export async function votesFor(messageIds: string[]): Promise<Map<string, { option: number; userId: string }[]>> {
  const map = new Map<string, { option: number; userId: string }[]>();
  if (!messageIds.length) return map;
  const rows = await db
    .select({ messageId: pollVotes.messageId, option: pollVotes.option, userId: pollVotes.userId })
    .from(pollVotes)
    .where(inArray(pollVotes.messageId, messageIds))
    .orderBy(asc(pollVotes.createdAt));
  for (const r of rows) {
    const list = map.get(r.messageId) ?? [];
    list.push({ option: r.option, userId: r.userId });
    map.set(r.messageId, list);
  }
  return map;
}

/** A poll with who picked each option. */
export function pollView(poll: PollInfo, votes: { option: number; userId: string }[]): Poll {
  return {
    question: poll.question,
    multi: poll.multi,
    closedAt: poll.closedAt,
    options: poll.options.map((text, i) => ({ text, votes: votes.filter((v) => v.option === i).map((v) => v.userId) })),
  };
}

/** The text older apps show for a poll. */
export function pollFallback(question: string, options: string[]): string {
  return `📊 Poll: ${question}\n${options.map((o) => `• ${o}`).join("\n")}\n(Vote in the newest Glofly)`;
}
