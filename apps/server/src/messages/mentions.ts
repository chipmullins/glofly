import { inArray } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

// @mentions in group chats. A message mentions someone when it contains "@theirusername" and
// they're in the group right now. The app highlights these and always notifies the person
// mentioned, even in a chat they muted. (The pattern is shared with the apps: @glofly/shared.)

import { mentionedNames } from "@glofly/shared";
export { MENTION_PATTERN, mentionedNames } from "@glofly/shared";

/** Which of these group members the text mentions (never the sender). */
export async function mentionsIn(body: string, memberIds: string[], senderId: string): Promise<string[]> {
  const names = mentionedNames(body);
  const others = memberIds.filter((id) => id !== senderId);
  if (!names.length || !others.length) return [];
  const rows = await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, others));
  return rows.filter((r) => names.includes(r.username.toLowerCase())).map((r) => r.id);
}
