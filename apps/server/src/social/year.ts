import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { yearInGlowSeason, type PublicUser, type YearInGlow } from "@glofly/shared";
import { db } from "../db";
import { attachments, callParticipants, calls, conversationMembers, conversations, messageReactions, messages, users } from "../db/schema";
import { longestGlowOf, TIME_ZONE } from "./glows";

// Year in Glow (0.5.0): a recap of someone's year on Glofly, worked out from their own messages,
// calls and reactions when they open it. Only ever about the person asking (other people appear
// only as "who you wrote to most", by name).

const EMOJI = /\p{Extended_Pictographic}/u;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

/** The emoji in some text (whole emoji, skin tones and families kept together). */
function emojiIn(text: string): string[] {
  if (!EMOJI.test(text)) return [];
  const out: string[] = [];
  const parts = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
  for (const p of parts) if (EMOJI.test(p)) out.push(p);
  return out;
}

export async function yearInGlow(userId: string, askedYear?: number): Promise<YearInGlow> {
  const season = yearInGlowSeason(new Date());
  const year = askedYear ?? season.year;
  const soFar = year === new Date().getFullYear() && new Date().getMonth() !== 11;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const mine = and(eq(messages.senderId, userId), isNull(messages.event), isNull(messages.deletedAt), gte(messages.createdAt, from), lt(messages.createdAt, to));

  const [{ count: messagesSent }] = await db.select({ count: sql<number>`count(*)::int` }).from(messages).where(mine);

  const partner = conversationMembers.userId;
  const topFriends = await db
    .select({ userId: partner, messages: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.kind, "dm")))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), ne(conversationMembers.userId, userId)))
    .where(mine)
    .groupBy(partner)
    .orderBy(desc(sql`count(*)`))
    .limit(3);

  const [group] = await db
    .select({ conversationId: messages.conversationId, name: conversations.name, messages: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.kind, "group")))
    .where(mine)
    .groupBy(messages.conversationId, conversations.name)
    .orderBy(desc(sql`count(*)`))
    .limit(1);

  const callRows = await db
    .select({ joinedAt: callParticipants.joinedAt, leftAt: callParticipants.leftAt, endedAt: calls.endedAt })
    .from(callParticipants)
    .innerJoin(calls, eq(calls.id, callParticipants.callId))
    .where(and(eq(callParticipants.userId, userId), isNotNull(callParticipants.joinedAt), gte(callParticipants.joinedAt, from), lt(callParticipants.joinedAt, to)));
  let callMs = 0;
  for (const c of callRows) {
    const end = c.leftAt ?? c.endedAt;
    if (c.joinedAt && end && end > c.joinedAt) callMs += Math.min(end.getTime() - c.joinedAt.getTime(), 12 * 3600 * 1000);
  }

  // Emoji: in your messages (the most recent 20,000 this year) and your reactions.
  const bodies = await db.select({ body: messages.body }).from(messages).where(and(mine, isNull(messages.gif))).orderBy(desc(messages.createdAt)).limit(20_000);
  const counts = new Map<string, number>();
  for (const b of bodies) for (const e of emojiIn(b.body)) counts.set(e, (counts.get(e) ?? 0) + 1);
  const reactions = await db
    .select({ emoji: messageReactions.emoji, n: sql<number>`count(*)::int` })
    .from(messageReactions)
    .where(and(eq(messageReactions.userId, userId), gte(messageReactions.createdAt, from), lt(messageReactions.createdAt, to)))
    .groupBy(messageReactions.emoji);
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + r.n);
  const topEmoji = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([emoji, count]) => ({ emoji, count }));

  const [{ count: gifsSent }] = await db.select({ count: sql<number>`count(*)::int` }).from(messages).where(and(mine, isNotNull(messages.gif)));
  const [{ count: photosSent }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(mine, eq(attachments.kind, "image")));

  const day = sql<string>`to_char(${messages.createdAt} at time zone ${TIME_ZONE}, 'YYYY-MM-DD')`;
  const [busiest] = await db
    .select({ day, messages: sql<number>`count(*)::int` })
    .from(messages)
    .where(mine)
    .groupBy(sql`1`) // the day column (written once, so its time zone is one parameter)
    .orderBy(desc(sql`count(*)`))
    .limit(1);

  const longestGlow = await longestGlowOf(userId);
  const ids = [...new Set([...topFriends.map((f) => f.userId), ...(longestGlow ? [longestGlow.userId] : [])])];
  const people: PublicUser[] = ids.length
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion })
        .from(users)
        .where(and(inArray(users.id, ids), isNull(users.deleteAfter)))
    : [];
  const known = new Set(people.map((p) => p.id));

  return {
    year,
    soFar,
    messagesSent,
    topFriends: topFriends.filter((f) => known.has(f.userId)),
    topGroup: group ? { conversationId: group.conversationId, name: group.name ?? "Your group", messages: group.messages } : null,
    longestGlow: longestGlow && known.has(longestGlow.userId) ? longestGlow : null,
    calls: callRows.length,
    callMinutes: Math.round(callMs / 60_000),
    topEmoji,
    gifsSent,
    photosSent,
    busiestDay: busiest && busiest.messages > 0 ? { day: busiest.day, messages: busiest.messages } : null,
    people,
  };
}
