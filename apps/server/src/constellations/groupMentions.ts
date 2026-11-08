import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { groupMentionsIn } from "@glofly/shared";
import { db } from "../db";
import { constellationMemberRoles, constellationMembers, constellationRoles, messages, users } from "../db/schema";
import { connectedUserIds } from "../realtime";
import { nebulaOfChat } from "./chats";
import { can, standingOf } from "./perms";

// Communities round 4.2 (approved board 24): @everyone, @here and @Role in nebulas.
//
// The server decides what a message really mentions: "@everyone" / "@here" and any role only
// count for people with "Mention @everyone, @here and all roles" (the Owner always); without it,
// only roles marked "Anyone can mention this role" count, and the rest stays plain text that
// notifies nobody. Whoever it reaches is worked out once, when it's sent, and kept on the message
// (`group_mentions`, never sent to apps): only people who can see the nebula (its conversation's
// members), @here only those online right now (not invisible), roles only their holders, and
// never anyone who chose "Ignore @everyone and @here" / "Ignore role mentions" (board 23).

export type GroupMentions = { mentionEveryone: "everyone" | "here" | null; mentionRoles: string[]; groupMentions: string[] };
export const NO_GROUP_MENTIONS: GroupMentions = { mentionEveryone: null, mentionRoles: [], groupMentions: [] };

/** What a nebula message mentions as groups, and who that reaches (never the sender). */
export async function groupMentionsFor(
  text: string,
  conversationId: string,
  memberIds: string[],
  senderId: string,
  // 0.9.3 Live alerts: Glofly posting a ping an admin chose (they were allowed to mention it then).
  trusted = false,
): Promise<GroupMentions> {
  if (!text.includes("@")) return NO_GROUP_MENTIONS;
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return NO_GROUP_MENTIONS;
  const roles = await db
    .select({ id: constellationRoles.id, name: constellationRoles.name, kind: constellationRoles.kind, mentionable: constellationRoles.mentionable })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.constellationId, nebula.constellationId), ne(constellationRoles.kind, "member")));
  const found = groupMentionsIn(text, roles);
  if (!found.everyone && !found.roleIds.length) return NO_GROUP_MENTIONS;
  const standing = trusted ? null : await standingOf(nebula.constellationId, senderId);
  if (!trusted && !standing) return NO_GROUP_MENTIONS;
  const all = trusted || (standing ? can(standing, "mentionEveryone") : false);
  const everyone = all ? found.everyone : null;
  const roleIds = found.roleIds.filter((id) => all || roles.find((r) => r.id === id)?.mentionable);
  if (!everyone && !roleIds.length) return NO_GROUP_MENTIONS;

  const others = memberIds.filter((id) => id !== senderId);
  if (!others.length) return { mentionEveryone: everyone, mentionRoles: roleIds, groupMentions: [] };
  const prefs = await db
    .select({ userId: constellationMembers.userId, ignoreEveryone: constellationMembers.ignoreEveryone, ignoreRoles: constellationMembers.ignoreRoles })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, nebula.constellationId), inArray(constellationMembers.userId, others)));
  const reached = new Set<string>();
  if (everyone) {
    let pool = others;
    if (everyone === "here") {
      const online = await connectedUserIds(others);
      const invisible = online.size
        ? await db.select({ id: users.id }).from(users).where(and(inArray(users.id, [...online]), eq(users.statusPreference, "invisible")))
        : [];
      for (const r of invisible) online.delete(r.id);
      pool = others.filter((id) => online.has(id));
    }
    for (const p of prefs) if (!p.ignoreEveryone && pool.includes(p.userId)) reached.add(p.userId);
  }
  if (roleIds.length) {
    const holders = await db
      .select({ userId: constellationMemberRoles.userId })
      .from(constellationMemberRoles)
      .where(and(inArray(constellationMemberRoles.roleId, roleIds), inArray(constellationMemberRoles.userId, others)));
    const held = new Set(holders.map((h) => h.userId));
    for (const p of prefs) if (!p.ignoreRoles && held.has(p.userId)) reached.add(p.userId);
  }
  return { mentionEveryone: everyone, mentionRoles: roleIds, groupMentions: [...reached] };
}

/** SQL: this message @mentions this person (by name, or @everyone / @here / a role that reached them). */
export const mentionsUserSql = (userId: string) =>
  sql`(${userId}::uuid = any(${messages.mentions}) or ${userId}::uuid = any(${messages.groupMentions}))`;
