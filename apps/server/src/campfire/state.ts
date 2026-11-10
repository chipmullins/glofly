import { asc, desc, eq, inArray } from "drizzle-orm";
import type { CampaignMember, CharacterView, TableState } from "@glofly/shared";
import { db } from "../db";
import {
  campfireCharacters,
  campfireHandouts,
  campfireMembers,
  campfirePending,
  campfireRolls,
  campfireScenes,
  campfireTokens,
  campfireTracks,
  users,
} from "../db/schema";
import { campaignRow, recordedGms, rolesAt, settingsOf, type CampaignRow, type Table } from "./perms";
import { currentSeq, presentAt, sendCampfire } from "./live";
import {
  campaignOut,
  characterOut,
  charInfo,
  combatOut,
  handoutSummary,
  handoutVisible,
  pendingOut,
  rollOut,
  rollVisible,
  sceneOut,
  tokenOut,
  tokenVisible,
  trackOut,
  type CharacterInfo,
  type SceneRow,
  type TokenRow,
  type Viewer,
} from "./view";

// Loading a table for one viewer, and sending live events to everyone at it, each filtered for
// its recipient. Events go to the people at the table (presence) and the campaign's GMs.

const viewerOf = (t: Table): Viewer => ({ userId: t.userId, gm: t.gm });

// Who gets a campaign's events, re-checked every few seconds (so someone who loses access, like
// leaving the group, stops hearing about it at once or within 5 s).
const AUDIENCE_MS = 5000;
const audiences = new Map<string, { at: number; viewers: Viewer[] }>();
export const forgetAudience = (campaignId: string) => audiences.delete(campaignId);

export async function audienceOf(campaign: CampaignRow): Promise<Viewer[]> {
  const cached = audiences.get(campaign.id);
  if (cached && Date.now() - cached.at < AUDIENCE_MS) return cached.viewers;
  const ids = [...new Set([...presentAt(campaign.id), ...(await recordedGms(campaign))])];
  const roles = await rolesAt(campaign, ids);
  // GMs only hear about a table while they can be at it; players only while they're at it.
  const present = new Set(presentAt(campaign.id));
  const viewers = [...roles]
    .filter(([id, role]) => role === "gm" || present.has(id))
    .map(([userId, role]) => ({ userId, gm: role === "gm" }));
  audiences.set(campaign.id, { at: Date.now(), viewers });
  return viewers;
}

/**
 * Sends an event to everyone at a table, built for each recipient (null: they get nothing).
 * `only`: just these people (still checked against who can be there).
 */
export async function broadcast(
  campaign: CampaignRow,
  event: string,
  build: (viewer: Viewer) => Record<string, unknown> | null,
  only?: string[],
): Promise<void> {
  for (const viewer of await audienceOf(campaign)) {
    if (only && !only.includes(viewer.userId)) continue;
    const payload = build(viewer);
    if (payload) sendCampfire(viewer.userId, campaign.id, event, payload);
  }
}

export async function charactersInfo(campaignId: string): Promise<CharacterInfo> {
  return charInfo(
    await db
      .select({ id: campfireCharacters.id, kind: campfireCharacters.kind, ownerId: campfireCharacters.ownerId })
      .from(campfireCharacters)
      .where(eq(campfireCharacters.campaignId, campaignId)),
  );
}

export async function sceneRow(sceneId: string): Promise<SceneRow | null> {
  const [row] = await db.select().from(campfireScenes).where(eq(campfireScenes.id, sceneId));
  return row ?? null;
}

export async function tokensOf(sceneId: string): Promise<TokenRow[]> {
  return db.select().from(campfireTokens).where(eq(campfireTokens.sceneId, sceneId)).orderBy(asc(campfireTokens.z), asc(campfireTokens.createdAt));
}

/** Players only get events about the scene everyone is on; GMs about every scene. */
const seesScene = (campaign: CampaignRow, sceneId: string, viewer: Viewer) => viewer.gm || campaign.activeSceneId === sceneId;

/**
 * A token changed (before → after; null = it didn't exist / it's gone). Each viewer gets an
 * upsert if they can see it now, a delete if they could before and can't now (moved into fog,
 * hidden, deleted), and nothing otherwise.
 */
export async function emitToken(campaign: CampaignRow, scene: SceneRow, before: TokenRow | null, after: TokenRow | null): Promise<void> {
  const chars = await charactersInfo(campaign.id);
  const settings = settingsOf(campaign.settings);
  await broadcast(campaign, "campfire:token", (v) => {
    if (!seesScene(campaign, scene.id, v)) return null;
    const was = !!before && tokenVisible(before, scene, v, chars);
    const is = !!after && tokenVisible(after, scene, v, chars);
    if (is) return { op: "upsert", token: tokenOut(after!, v, chars, settings) };
    if (was) return { op: "delete", tokenId: (before ?? after)!.id, sceneId: scene.id };
    return null;
  });
}

/** The fog changed (or the built map): everyone gets the fog, the map pieces and the tokens they can now see. */
export async function emitFog(campaign: CampaignRow, scene: SceneRow): Promise<void> {
  const chars = await charactersInfo(campaign.id);
  const settings = settingsOf(campaign.settings);
  const tokens = await tokensOf(scene.id);
  await broadcast(campaign, "campfire:fog", (v) => {
    if (!seesScene(campaign, scene.id, v)) return null;
    const out = sceneOut(scene, v);
    return { sceneId: scene.id, fog: out.fog, built: out.built, tokens: tokens.filter((t) => tokenVisible(t, scene, v, chars)).map((t) => tokenOut(t, v, chars, settings)) };
  });
}

export async function sceneList(campaign: CampaignRow) {
  const rows = await db
    .select({ id: campfireScenes.id, name: campfireScenes.name, position: campfireScenes.position })
    .from(campfireScenes)
    .where(eq(campfireScenes.campaignId, campaign.id))
    .orderBy(asc(campfireScenes.position), asc(campfireScenes.createdAt));
  return rows.map((r) => ({ ...r, active: r.id === campaign.activeSceneId }));
}

/** A scene changed, was activated or deleted. Players hear only about the active one (and the list). */
export async function emitScene(campaign: CampaignRow, op: "upsert" | "activate" | "delete", sceneId: string): Promise<void> {
  const fresh = (await campaignRow(campaign.id)) ?? campaign;
  const scene = op === "delete" ? null : await sceneRow(sceneId);
  const allScenes = await sceneList(fresh);
  const chars = op === "activate" ? await charactersInfo(fresh.id) : null;
  const tokens = op === "activate" && scene ? await tokensOf(scene.id) : [];
  const settings = settingsOf(fresh.settings);
  await broadcast(fresh, "campfire:scene", (v) => {
    const visible = !!scene && seesScene(fresh, scene.id, v);
    if (!v.gm && op === "upsert" && !visible) return null;
    return {
      op,
      sceneId,
      scene: visible ? sceneOut(scene!, v) : null,
      scenes: v.gm ? allScenes : allScenes.filter((s) => s.active),
      ...(op === "activate" && visible ? { tokens: tokens.filter((t) => tokenVisible(t, scene!, v, chars!)).map((t) => tokenOut(t, v, chars!, settings)) } : {}),
    };
  });
}

/** A character changed: the owner and GMs get it all, other players a PC's public part. */
export async function emitCharacter(campaign: CampaignRow, characterId: string): Promise<void> {
  const [row] = await db.select().from(campfireCharacters).where(eq(campfireCharacters.id, characterId));
  await broadcast(campaign, "campfire:character", (v) => {
    if (!row) return { op: "delete", characterId };
    const out = characterOut(row, v);
    return out ? { op: "upsert", character: out } : null;
  });
}

export async function emitCombat(campaign: CampaignRow): Promise<void> {
  const fresh = (await campaignRow(campaign.id)) ?? campaign;
  const visible = await visibleTokenIdsFor(fresh);
  await broadcast(fresh, "campfire:combat", (v) => ({ combat: combatOut(fresh.combat, v, visible(v)) }));
}

/** Per viewer, which tokens of the active scene they can see (for the turn order). */
export async function visibleTokenIdsFor(campaign: CampaignRow): Promise<(v: Viewer) => Set<string>> {
  const scene = campaign.activeSceneId ? await sceneRow(campaign.activeSceneId) : null;
  const tokens = scene ? await tokensOf(scene.id) : [];
  const chars = await charactersInfo(campaign.id);
  // Turn order entries may be tokens on any scene: GMs see all of them anyway.
  return (v) => new Set(scene ? tokens.filter((t) => tokenVisible(t, scene, v, chars)).map((t) => t.id) : []);
}

export async function emitPending(campaign: CampaignRow): Promise<void> {
  const rows = await db.select().from(campfirePending).where(eq(campfirePending.campaignId, campaign.id)).orderBy(asc(campfirePending.createdAt));
  const pending = rows.map(pendingOut);
  await broadcast(campaign, "campfire:pending", (v) => (v.gm ? { pending } : null));
}

export async function membersOf(campaign: CampaignRow): Promise<CampaignMember[]> {
  const rows = await db
    .select({ userId: campfireMembers.userId, role: campfireMembers.role, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion })
    .from(campfireMembers)
    .innerJoin(users, eq(users.id, campfireMembers.userId))
    .where(eq(campfireMembers.campaignId, campaign.id))
    .orderBy(asc(campfireMembers.joinedAt));
  const roles = await rolesAt(campaign, rows.map((r) => r.userId));
  return rows
    .filter((r) => roles.has(r.userId))
    .map((r) => ({
      userId: r.userId,
      role: roles.get(r.userId)!,
      user: { id: r.userId, username: r.username, displayName: r.displayName, avatarVersion: r.avatarVersion },
    }));
}

/** GET /campfire/campaigns/:id: the whole table for one viewer. */
export async function tableState(t: Table): Promise<TableState> {
  const v = viewerOf(t);
  const c = t.campaign;
  const scene = c.activeSceneId ? await sceneRow(c.activeSceneId) : null;
  const chars = await db.select().from(campfireCharacters).where(eq(campfireCharacters.campaignId, c.id)).orderBy(asc(campfireCharacters.createdAt));
  const info = charInfo(chars);
  const settings = settingsOf(c.settings);
  const tokens = scene ? (await tokensOf(scene.id)).filter((tk) => tokenVisible(tk, scene, v, info)) : [];
  const rolls = await db.select().from(campfireRolls).where(eq(campfireRolls.campaignId, c.id)).orderBy(desc(campfireRolls.createdAt)).limit(200);
  const handouts = await db.select().from(campfireHandouts).where(eq(campfireHandouts.campaignId, c.id)).orderBy(asc(campfireHandouts.createdAt));
  const tracks = await db.select().from(campfireTracks).where(eq(campfireTracks.campaignId, c.id)).orderBy(asc(campfireTracks.createdAt));
  const pending = t.gm ? await db.select().from(campfirePending).where(eq(campfirePending.campaignId, c.id)).orderBy(asc(campfirePending.createdAt)) : [];
  const scenes = await sceneList(c);
  return {
    campaign: campaignOut(c, t),
    myRole: t.role,
    seq: currentSeq(c.id, t.userId),
    members: await membersOf(c),
    scenes: t.gm ? scenes : scenes.filter((s) => s.active),
    scene: scene ? sceneOut(scene, v) : null,
    tokens: tokens.map((tk) => tokenOut(tk, v, info, settings)),
    characters: chars.map((ch) => characterOut(ch, v)).filter((x): x is CharacterView => !!x),
    combat: combatOut(c.combat, v, new Set(tokens.map((tk) => tk.id))),
    music: c.music,
    pending: pending.map(pendingOut),
    rolls: rolls
      .filter((r) => rollVisible(r, v))
      .slice(0, 50)
      .map(rollOut),
    handouts: handouts.filter((h) => handoutVisible(h, v)).map(handoutSummary),
    tracks: tracks.map(trackOut),
    present: presentAt(c.id),
    serverNow: Date.now(),
  };
}

/** Tokens of several ids, with their scenes (for attacks and the turn order). */
export async function tokensWithScenes(ids: string[]): Promise<{ token: TokenRow; scene: SceneRow }[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ token: campfireTokens, scene: campfireScenes })
    .from(campfireTokens)
    .innerJoin(campfireScenes, eq(campfireScenes.id, campfireTokens.sceneId))
    .where(inArray(campfireTokens.id, ids));
  return rows;
}

