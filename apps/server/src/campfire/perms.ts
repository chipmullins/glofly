import { and, eq, inArray, isNull } from "drizzle-orm";
import { DEFAULT_CAMPAIGN_SETTINGS, type CampaignRole, type CampaignSettings } from "@glofly/shared";
import { db } from "../db";
import { campfireCampaigns, campfireMembers, conversationMembers } from "../db/schema";
import { can, frozen, FROZEN_MESSAGE, standingOf } from "../constellations/perms";
import { chatKind, nebulaOfChat } from "../constellations/chats";
import { seesNebulaChat } from "../constellations/access";
import { deletionPending, isRestricted } from "../friends/rules";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";

// Who may do what at a Campfire table. Checked on every request and every live event.
//
// Constellation campaigns: anyone in the constellation who can see the voice nebula it was made
// from. GMs: whoever has "Run Campfire games" (Owner/Admins), the campaign's creator, and people
// a GM made GMs. Restricted (family) accounts are refused (constellations refuse them anyway).
// Chat campaigns: the group chat's members; the creator and people a GM made GMs are GMs.
// Frozen constellations, timed-out members and accounts being deleted can look but not change.

export type CampaignRow = typeof campfireCampaigns.$inferSelect;

export type Table = {
  campaign: CampaignRow;
  userId: string;
  role: CampaignRole;
  gm: boolean;
  /** Why they can look but not change anything (null: they can) */
  readOnly: string | null;
  /** Constellation Owner, or can edit its settings (may delete any campaign in it) */
  admin: boolean;
};

export type HomeRef = { kind: "nebula"; conversationId: string; constellationId: string } | { kind: "chat"; conversationId: string };

const TIMED_OUT = "You're timed out for now, so you can watch but not play.";
const LEAVING = "Your account is being deleted, so you can't change anything here.";

export const settingsOf = (raw: unknown): CampaignSettings => {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<CampaignSettings>;
  return {
    gmApprovesDamage: typeof s.gmApprovesDamage === "boolean" ? s.gmApprovesDamage : DEFAULT_CAMPAIGN_SETTINGS.gmApprovesDamage,
    showMonsterHp: s.showMonsterHp === "exact" || s.showMonsterHp === "none" ? s.showMonsterHp : "bloodied",
    diceVisibility: s.diceVisibility === "gm" ? "gm" : "all",
  };
};

async function inChat(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  return !!row;
}

/**
 * A place campaigns live (a voice nebula's conversation, or a group chat) that this person can
 * use, and whether they may start a campaign there. Null: not theirs (or not a place for one).
 */
export async function homeFor(
  kind: string,
  id: string,
  userId: string,
): Promise<{ home: HomeRef; canCreate: boolean; why: string | null; code: string | null } | null> {
  if (kind === "nebula") {
    const nebula = await nebulaOfChat(id);
    if (!nebula || nebula.kind !== "voice") return null;
    if (await isRestricted(userId)) return null;
    const s = await standingOf(nebula.constellationId, userId);
    if (!s || !(await seesNebulaChat(userId, id))) return null;
    let why: string | null = null;
    let code: string | null = "forbidden";
    if (!can(s, "runGames")) why = "Your role doesn't allow running games here.";
    else if (await frozen(nebula.constellationId)) why = FROZEN_MESSAGE;
    else if (s.timedOutUntil) why = TIMED_OUT;
    else if (await lockedDown(userId)) [why, code] = [LOCKDOWN_MESSAGE.message, LOCKDOWN_MESSAGE.error];
    else if (await deletionPending(userId)) why = LEAVING;
    return { home: { kind: "nebula", conversationId: id, constellationId: nebula.constellationId }, canCreate: !why, why, code: why ? code : null };
  }
  if (kind === "chat") {
    if ((await chatKind(id)) !== "group" || !(await inChat(id, userId))) return null;
    let why: string | null = null;
    let code: string | null = "forbidden";
    if (await lockedDown(userId)) [why, code] = [LOCKDOWN_MESSAGE.message, LOCKDOWN_MESSAGE.error];
    else if (await deletionPending(userId)) why = LEAVING;
    return { home: { kind: "chat", conversationId: id }, canCreate: !why, why, code: why ? code : null };
  }
  return null;
}

export async function campaignRow(campaignId: string): Promise<CampaignRow | null> {
  const [row] = await db
    .select()
    .from(campfireCampaigns)
    .where(and(eq(campfireCampaigns.id, campaignId), isNull(campfireCampaigns.deletedAt)));
  return row ?? null;
}

/** Where someone stands at a campaign's table, or null if they can't be there. */
export async function tableFor(campaignOrId: string | CampaignRow, userId: string): Promise<Table | null> {
  const campaign = typeof campaignOrId === "string" ? await campaignRow(campaignOrId) : campaignOrId;
  if (!campaign || campaign.deletedAt) return null;
  const [member] = await db
    .select({ role: campfireMembers.role })
    .from(campfireMembers)
    .where(and(eq(campfireMembers.campaignId, campaign.id), eq(campfireMembers.userId, userId)));
  let gm = member?.role === "gm" || campaign.createdBy === userId;
  let readOnly: string | null = null;
  let admin = false;
  if (campaign.homeConversationId) {
    if (!campaign.constellationId || (await isRestricted(userId))) return null;
    const s = await standingOf(campaign.constellationId, userId);
    if (!s || !(await seesNebulaChat(userId, campaign.homeConversationId))) return null;
    gm ||= can(s, "runGames");
    admin = can(s, "manageConstellation");
    if (await frozen(campaign.constellationId)) readOnly = FROZEN_MESSAGE;
    else if (s.timedOutUntil) readOnly = TIMED_OUT;
  } else if (campaign.conversationId) {
    if (!(await inChat(campaign.conversationId, userId))) return null;
  } else return null;
  if (!readOnly && (await deletionPending(userId))) readOnly = LEAVING;
  return { campaign, userId, role: gm ? "gm" : "player", gm, readOnly, admin };
}

/** Makes sure someone at the table has a member row (players join by opening it). */
export async function ensureMember(campaignId: string, userId: string): Promise<void> {
  await db.insert(campfireMembers).values({ campaignId, userId, role: "player" }).onConflictDoNothing();
}

/** Of these people, who can be at this table, and as what. */
export async function rolesAt(campaign: CampaignRow, userIds: string[]): Promise<Map<string, CampaignRole>> {
  const out = new Map<string, CampaignRole>();
  for (const id of [...new Set(userIds)]) {
    const t = await tableFor(campaign, id);
    if (t) out.set(id, t.role);
  }
  return out;
}

/** The GMs on record (member rows and the creator), before checking they can still be there. */
export async function recordedGms(campaign: CampaignRow): Promise<string[]> {
  const rows = await db
    .select({ userId: campfireMembers.userId })
    .from(campfireMembers)
    .where(and(eq(campfireMembers.campaignId, campaign.id), eq(campfireMembers.role, "gm")));
  return [...new Set([...rows.map((r) => r.userId), ...(campaign.createdBy ? [campaign.createdBy] : [])])];
}

/** Which of these people are in the campaign's home (for whispers and handouts shared with some). */
export async function inHome(campaign: CampaignRow, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const conversationId = campaign.homeConversationId ?? campaign.conversationId;
  if (!conversationId) return [];
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), inArray(conversationMembers.userId, userIds)));
  return rows.map((r) => r.userId);
}
