import { inArray } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

// @mentions in group chats. A message mentions someone when it contains "@theirusername" and
// they're in the group right now. The app highlights these and always notifies the person
// mentioned, even in a chat they muted. (The app uses the same pattern: lib/mentions.ts.)

/** "@maya.p" anywhere a word could start (not inside an email address like a@b.com). */
export const MENTION_PATTERN = /(?<![\w@.])@([a-zA-Z0-9](?:[a-zA-Z0-9._]*[a-zA-Z0-9])?)/g;

/** The usernames a text mentions (lower case, each once). */
export function mentionedNames(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) names.add(match[1].toLowerCase());
  return [...names].slice(0, 50);
}

/** Which of these group members the text mentions (never the sender). */
export async function mentionsIn(body: string, memberIds: string[], senderId: string): Promise<string[]> {
  const names = mentionedNames(body);
  const others = memberIds.filter((id) => id !== senderId);
  if (!names.length || !others.length) return [];
  const rows = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, others));
  return rows.filter((r) => names.includes(r.username.toLowerCase())).map((r) => r.id);
}
