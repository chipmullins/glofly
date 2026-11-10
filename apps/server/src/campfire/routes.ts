import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  CAMPFIRE_LIMITS,
  cleanFogShape,
  fogPointCount,
  DEFAULT_CAMPAIGN_SETTINGS,
  EMPTY_BUILT,
  isColor,
  isMapTheme,
  normalizeBuilt,
  normalizeFog,
  normalizeGrid,
  normalizeSheet,
  sizeCells,
  totalLevel,
  type CampaignCharacterCard,
  type CampaignSettings,
  type FogShape,
  type TokenBar,
} from "@glofly/shared";
import { db } from "../db";
import {
  campfireCampaigns,
  campfireCharacters,
  campfireFiles,
  campfireMembers,
  campfireScenes,
  campfireTokens,
  campfireTracks,
} from "../db/schema";
import { isInCall, peopleInCall, reload as callRow } from "../calls/service";
import { onSocketEvent } from "../realtime";
import { forgetCampaign, leaveTable, notePresence, openCallOf, presentAt, sendCampfire, setOpenCall } from "./live";
import { campaignRow, ensureMember, homeFor, inHome, rolesAt, settingsOf, tableFor, type CampaignRow, type Table } from "./perms";
import { bad, cleanText, firstIssue, idParam, limiter, me, notFound, slot, tableOr, uuidList } from "./http";
import { broadcast, charactersInfo, emitFog, emitScene, emitToken, forgetAudience, membersOf, sceneRow, tableState, tokensOf } from "./state";
import { campaignOut, controls, sceneOut, tokenOut, tokenVisible, type SceneRow, type TokenRow } from "./view";
import { monsterBySlug, isSrdSlug } from "./srd";
import { removeStored } from "./files";
import { syncSheetFromToken } from "./sync";

// Campfire (phase 1): campaigns, members, the table being lit in a call, presence, pings, scenes,
// fog and tokens. Attacks, rolls and combat are in play.ts; sheets, handouts, files and music in
// content.ts. Every route checks the table (perms.ts) and every answer is filtered (view.ts).
//
//   GET    /campfire/homes/:kind/:id/campaigns       kind nebula (a voice nebula's chat) | chat (a group)
//   POST   /campfire/campaigns                       { home: { kind, id }, name }
//   GET    /campfire/campaigns/:id                   the table, for me
//   PATCH  /campfire/campaigns/:id                   { name?, settings? } (GM)  · DELETE (creator / constellation admin)
//   POST   /campfire/campaigns/:id/open  { callId }  "Campfire is lit" for the call (GM) · POST …/close
//   POST   /campfire/campaigns/:id/presence          every 30 s while it's open { away? }
//   PUT    /campfire/campaigns/:id/members/:userId   { role } (GM)
//   POST   /campfire/campaigns/:id/ping              { sceneId, x, y }
//   POST   /campfire/campaigns/:id/scenes            (GM) · GET/PATCH/DELETE /campfire/scenes/:id
//   POST   /campfire/campaigns/:id/scenes/:sceneId/activate
//   POST   /campfire/scenes/:id/fog                  { op: reveal | hide | reset | revealAll, shape? }
//   POST   /campfire/scenes/:id/tokens               (GM) · PATCH/DELETE /campfire/tokens/:id
//   live:  campfire:move { tokenId, x, y }           dragging (throttled; PATCH is the fallback)

export const coreRouter = Router();

const createLimiter = limiter("campfire:create", 10, 60 * 60 * 1000, "That's a lot of new campaigns. Try again later.");
const changeLimiter = limiter("campfire:change", 600, 60 * 1000, "That's a lot of changes. Wait a moment and try again.");
// Fog and built-map changes make the server work out what every player sees: fewer of those.
const mapLimiter = limiter("campfire:map", 60, 60 * 1000, "That's a lot of map changes. Wait a moment and try again.");

const COORD = 100_000;
const coord = z.number().finite().min(-COORD).max(COORD).transform(Math.round);

// ───────────── Campaigns ─────────────

coreRouter.get("/homes/:kind/:id/campaigns", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const home = id.success ? await homeFor(req.params.kind, id.data, me(res).id) : null;
  if (!home) return notFound(res, "That place isn't available.");
  const rows = await db
    .select()
    .from(campfireCampaigns)
    .where(
      and(
        home.home.kind === "nebula" ? eq(campfireCampaigns.homeConversationId, home.home.conversationId) : eq(campfireCampaigns.conversationId, home.home.conversationId),
        isNull(campfireCampaigns.deletedAt),
      ),
    )
    .orderBy(asc(campfireCampaigns.createdAt));
  const campaigns = [];
  for (const row of rows) {
    const t = await tableFor(row, me(res).id);
    if (t) {
      const { settings: _s, createdAt: _c, ...summary } = campaignOut(row, t);
      campaigns.push({ ...summary, myCharacter: await myCharacterIn(row.id, me(res).id) });
    }
  }
  res.json({ campaigns, canCreate: home.canCreate && rows.length < CAMPFIRE_LIMITS.campaignsPerHome, why: home.why });
});

/** The Start board's "Your character": my first player character in a campaign, in a few words. */
async function myCharacterIn(campaignId: string, userId: string): Promise<CampaignCharacterCard | null> {
  const [c] = await db
    .select({ id: campfireCharacters.id, name: campfireCharacters.name, portraitFileId: campfireCharacters.portraitFileId, sheet: campfireCharacters.sheet })
    .from(campfireCharacters)
    .where(and(eq(campfireCharacters.campaignId, campaignId), eq(campfireCharacters.ownerId, userId), eq(campfireCharacters.kind, "pc")))
    .orderBy(asc(campfireCharacters.createdAt))
    .limit(1);
  if (!c) return null;
  const sheet = normalizeSheet(c.sheet);
  const classes = sheet.classes.map((k) => k.name).filter(Boolean).join(" / ");
  const who = [sheet.race, classes].filter((x) => x.trim()).join(" ");
  const line = [who, `Level ${Math.max(1, totalLevel(sheet))}`].filter(Boolean).join(" · ");
  return { id: c.id, name: c.name, portraitFileId: c.portraitFileId, line };
}

coreRouter.post("/campaigns", createLimiter, async (req, res) => {
  const parsed = z
    .object({ home: z.object({ kind: z.enum(["nebula", "chat"]), id: z.uuid() }), name: cleanText(CAMPFIRE_LIMITS.campaignName, "The name") })
    .safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const myId = me(res).id;
  const home = await homeFor(parsed.data.home.kind, parsed.data.home.id, myId);
  if (!home) return notFound(res, "That place isn't available.");
  if (!home.canCreate) return bad(res, home.why ?? "You can't start a campaign here.", 403, home.code ?? "forbidden");
  const where =
    home.home.kind === "nebula" ? eq(campfireCampaigns.homeConversationId, home.home.conversationId) : eq(campfireCampaigns.conversationId, home.home.conversationId);
  const created = await db.transaction(async (tx) => {
    // One at a time per place, so two can't squeeze past the limit together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"campfire:" + home.home.conversationId}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(campfireCampaigns)
      .where(and(where, isNull(campfireCampaigns.deletedAt)));
    if (n >= CAMPFIRE_LIMITS.campaignsPerHome) return null;
    const [row] = await tx
      .insert(campfireCampaigns)
      .values({
        name: parsed.data.name,
        constellationId: home.home.kind === "nebula" ? home.home.constellationId : null,
        homeConversationId: home.home.kind === "nebula" ? home.home.conversationId : null,
        conversationId: home.home.kind === "chat" ? home.home.conversationId : null,
        createdBy: myId,
        settings: { ...DEFAULT_CAMPAIGN_SETTINGS },
      })
      .returning();
    await tx.insert(campfireMembers).values({ campaignId: row.id, userId: myId, role: "gm" });
    return row;
  });
  if (!created) return bad(res, `A place can have up to ${CAMPFIRE_LIMITS.campaignsPerHome} campaigns.`, 409);
  res.status(201).json(campaignOut(created, { role: "gm" }));
});

coreRouter.get("/campaigns/:id", async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  await ensureMember(t.campaign.id, t.userId);
  res.json(await tableState(t));
});

const settingsInput = z
  .object({
    gmApprovesDamage: z.boolean().optional(),
    showMonsterHp: z.enum(["bloodied", "exact", "none"]).optional(),
    diceVisibility: z.enum(["all", "gm"]).optional(),
    placeHidden: z.boolean().optional(),
  })
  .strict();

coreRouter.patch("/campaigns/:id", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = z.object({ name: cleanText(CAMPFIRE_LIMITS.campaignName, "The name").optional(), settings: settingsInput.optional() }).safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const settings: CampaignSettings = { ...settingsOf(t.campaign.settings), ...(parsed.data.settings ?? {}) };
  const [row] = await db
    .update(campfireCampaigns)
    .set({ ...(parsed.data.name ? { name: parsed.data.name } : {}), settings, updatedAt: new Date() })
    .where(eq(campfireCampaigns.id, t.campaign.id))
    .returning();
  // Settings change what players see (monster HP): everyone loads the table again.
  await broadcast(row, "campfire:state", () => ({ reason: "settings" }));
  res.json(campaignOut(row, t));
});

coreRouter.delete("/campaigns/:id", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  if (t.campaign.createdBy !== t.userId && !t.admin) return bad(res, "Only whoever made this campaign (or a constellation admin) can delete it.", 403);
  if (t.readOnly && !t.admin) return bad(res, t.readOnly, 403);
  await broadcast(t.campaign, "campfire:state", () => ({ reason: "deleted" }));
  await db.update(campfireCampaigns).set({ deletedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id));
  const callId = openCallOf(t.campaign.id);
  if (callId) await tellCall(t.campaign, callId, "campfire:closed", { callId });
  forgetCampaign(t.campaign.id);
  forgetAudience(t.campaign.id);
  await purgeCampaign(t.campaign.id);
  res.json({ ok: true });
});

/** Removes a deleted campaign for good: its files from storage, then everything else (cascade). */
export async function purgeCampaign(campaignId: string): Promise<void> {
  const files = await db.select({ key: campfireFiles.storageKey }).from(campfireFiles).where(eq(campfireFiles.campaignId, campaignId));
  await removeStored(files.map((f) => f.key));
  await db.delete(campfireCampaigns).where(eq(campfireCampaigns.id, campaignId));
}

/**
 * Every 10 minutes: campaigns that were deleted but not removed yet, and campaigns whose group
 * chat, voice nebula or constellation was deleted (their home became null), go for good.
 */
export async function sweepDeletedCampaigns(): Promise<void> {
  const rows = await db
    .select({ id: campfireCampaigns.id })
    .from(campfireCampaigns)
    .where(sql`${campfireCampaigns.deletedAt} is not null or (${campfireCampaigns.homeConversationId} is null and ${campfireCampaigns.conversationId} is null)`)
    .limit(50);
  for (const r of rows) {
    forgetCampaign(r.id);
    await purgeCampaign(r.id);
  }
}

// ───────────── Lit in a call, presence, members, pings ─────────────

/** The conversation a campaign's calls happen in (the voice nebula's, or the group's). */
const callHome = (c: CampaignRow) => c.homeConversationId ?? c.conversationId;

/** Tells everyone in the call (who can be at the table) about the table being lit or put out. */
async function tellCall(campaign: CampaignRow, callId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const people = await peopleInCall(callId);
  const roles = await rolesAt(campaign, people);
  for (const userId of roles.keys()) sendCampfire(userId, campaign.id, event, payload);
}

coreRouter.post("/campaigns/:id/open", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const callId = idParam.safeParse(req.body?.callId);
  const call = callId.success ? await callRow(callId.data) : null;
  if (!call || call.conversationId !== callHome(t.campaign) || (call.status !== "ongoing" && call.status !== "ringing") || !(await isInCall(call.id, t.userId))) {
    return bad(res, "Join the call first, then light the campfire.", 409, "not_in_call");
  }
  setOpenCall(t.campaign.id, call.id);
  await tellCall(t.campaign, call.id, "campfire:opened", { callId: call.id, name: t.campaign.name, by: t.userId });
  res.json({ ok: true, openInCallId: call.id });
});

coreRouter.post("/campaigns/:id/close", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const callId = openCallOf(t.campaign.id);
  setOpenCall(t.campaign.id, null);
  if (callId) await tellCall(t.campaign, callId, "campfire:closed", { callId });
  res.json({ ok: true });
});

const presenceLimiter = limiter("campfire:presence", 30, 60 * 1000, "Slow down a little.");
coreRouter.post("/campaigns/:id/presence", presenceLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id);
  if (!t) return;
  await ensureMember(t.campaign.id, t.userId);
  const changed = req.body?.away === true ? leaveTable(t.campaign.id, t.userId) : notePresence(t.campaign.id, t.userId, t.role);
  if (changed) {
    forgetAudience(t.campaign.id);
    const present = presentAt(t.campaign.id);
    await broadcast(t.campaign, "campfire:presence", () => ({ present }));
  }
  res.json({ present: presentAt(t.campaign.id) });
});

coreRouter.put("/campaigns/:id/members/:userId", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const userId = idParam.safeParse(req.params.userId);
  const role = z.enum(["gm", "player"]).safeParse(req.body?.role);
  if (!userId.success || !role.success) return bad(res, "Pick game master or player.");
  if (userId.data === t.campaign.createdBy && role.data !== "gm") return bad(res, "Whoever made the campaign stays a game master.", 403);
  if (!(await tableFor(t.campaign, userId.data))) return notFound(res, "They can't be at this table.");
  await db
    .insert(campfireMembers)
    .values({ campaignId: t.campaign.id, userId: userId.data, role: role.data })
    .onConflictDoUpdate({ target: [campfireMembers.campaignId, campfireMembers.userId], set: { role: role.data } });
  forgetAudience(t.campaign.id);
  const members = await membersOf(t.campaign);
  await broadcast(t.campaign, "campfire:members", () => ({ members }));
  // Their view changes completely (GM layer, sheets): their apps load the table again.
  await broadcast(t.campaign, "campfire:state", () => ({ reason: "role" }), [userId.data]);
  res.json({ members });
});

coreRouter.post("/campaigns/:id/ping", async (req, res) => {
  const t = await tableOr(res, req.params.id, { write: true });
  if (!t) return;
  const parsed = z.object({ sceneId: z.uuid(), x: coord, y: coord }).safeParse(req.body);
  if (!parsed.success) return bad(res, "That ping didn't work.");
  const scene = await sceneRow(parsed.data.sceneId);
  if (!scene || scene.campaignId !== t.campaign.id || (!t.gm && scene.id !== t.campaign.activeSceneId)) return notFound(res);
  if (!(await slot(`campfire:ping:${t.userId}`, 1, 1000))) return bad(res, "One ping a second.", 429, "too_many_requests");
  const ping = { userId: t.userId, sceneId: scene.id, x: parsed.data.x, y: parsed.data.y };
  await broadcast(t.campaign, "campfire:ping", (v) => (v.gm || scene.id === t.campaign.activeSceneId ? ping : null));
  res.json({ ok: true });
});

// ───────────── Scenes ─────────────

const fileOfKind = async (campaignId: string, fileId: string | null | undefined, kind: string) => {
  if (!fileId) return true;
  const [f] = await db.select({ kind: campfireFiles.kind }).from(campfireFiles).where(and(eq(campfireFiles.id, fileId), eq(campfireFiles.campaignId, campaignId)));
  return f?.kind === kind;
};
const trackIn = async (campaignId: string, trackId: string | null | undefined) => {
  if (!trackId) return true;
  const [row] = await db.select({ id: campfireTracks.id }).from(campfireTracks).where(and(eq(campfireTracks.id, trackId), eq(campfireTracks.campaignId, campaignId)));
  return !!row;
};

const sceneInput = z.object({
  name: cleanText(CAMPFIRE_LIMITS.sceneName, "The name").optional(),
  widthPx: z.number().int().min(100).max(20_000).optional(),
  heightPx: z.number().int().min(100).max(20_000).optional(),
  grid: z.unknown().optional(),
  theme: z.string().refine(isMapTheme, "Pick a map theme.").optional(),
  built: z.unknown().optional(),
  fog: z.unknown().optional(),
  backgroundFileId: z.uuid().nullable().optional(),
  musicTrackId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

coreRouter.post("/campaigns/:id/scenes", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const parsed = sceneInput.extend({ name: cleanText(CAMPFIRE_LIMITS.sceneName, "The name") }).safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!(await fileOfKind(t.campaign.id, d.backgroundFileId, "map"))) return bad(res, "Upload that map to this campaign first.");
  if (!(await trackIn(t.campaign.id, d.musicTrackId))) return bad(res, "That track isn't in this campaign.");
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: campfireCampaigns.id }).from(campfireCampaigns).where(eq(campfireCampaigns.id, t.campaign.id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(campfireScenes).where(eq(campfireScenes.campaignId, t.campaign.id));
    if (n >= CAMPFIRE_LIMITS.scenesPerCampaign) return null;
    const [row] = await tx
      .insert(campfireScenes)
      .values({
        campaignId: t.campaign.id,
        name: d.name,
        position: d.position ?? n,
        widthPx: d.widthPx,
        heightPx: d.heightPx,
        grid: normalizeGrid(d.grid),
        theme: d.theme ?? "stone",
        built: d.built === undefined ? EMPTY_BUILT : normalizeBuilt(d.built),
        fog: normalizeFog(d.fog),
        backgroundFileId: d.backgroundFileId ?? null,
        musicTrackId: d.musicTrackId ?? null,
      })
      .returning();
    // The first scene is where everyone starts.
    if (!t.campaign.activeSceneId) await tx.update(campfireCampaigns).set({ activeSceneId: row.id, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id));
    return row;
  });
  if (!row) return bad(res, `A campaign can have up to ${CAMPFIRE_LIMITS.scenesPerCampaign} scenes.`, 409);
  await emitScene(t.campaign, t.campaign.activeSceneId ? "upsert" : "activate", row.id);
  res.status(201).json(sceneOut(row, t));
});

/** A scene and the table it belongs to (players: only the active scene). */
async function sceneTable(res: Parameters<typeof tableOr>[0], sceneId: unknown, opts: { write?: boolean; gm?: boolean } = {}) {
  const id = idParam.safeParse(sceneId);
  const scene = id.success ? await sceneRow(id.data) : null;
  if (!scene) {
    notFound(res);
    return null;
  }
  const t = await tableOr(res, scene.campaignId, opts);
  if (!t) return null;
  if (!t.gm && scene.id !== t.campaign.activeSceneId) {
    notFound(res);
    return null;
  }
  return { t, scene };
}

coreRouter.get("/scenes/:id", async (req, res) => {
  const found = await sceneTable(res, req.params.id);
  if (!found) return;
  const { t, scene } = found;
  const chars = await charactersInfo(t.campaign.id);
  const settings = settingsOf(t.campaign.settings);
  const tokens = (await tokensOf(scene.id)).filter((tk) => tokenVisible(tk, scene, t, chars)).map((tk) => tokenOut(tk, t, chars, settings));
  res.json({ scene: sceneOut(scene, t), tokens });
});

coreRouter.patch("/scenes/:id", changeLimiter, (req, res, next) => (req.body?.built !== undefined || req.body?.fog !== undefined ? mapLimiter(req, res, next) : next()), async (req, res) => {
  const found = await sceneTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, scene } = found;
  const parsed = sceneInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!(await fileOfKind(t.campaign.id, d.backgroundFileId, "map"))) return bad(res, "Upload that map to this campaign first.");
  if (!(await trackIn(t.campaign.id, d.musicTrackId))) return bad(res, "That track isn't in this campaign.");
  const [row] = await db
    .update(campfireScenes)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.widthPx !== undefined ? { widthPx: d.widthPx } : {}),
      ...(d.heightPx !== undefined ? { heightPx: d.heightPx } : {}),
      ...(d.grid !== undefined ? { grid: normalizeGrid(d.grid) } : {}),
      ...(d.theme !== undefined ? { theme: d.theme } : {}),
      ...(d.built !== undefined ? { built: normalizeBuilt(d.built) } : {}),
      ...(d.fog !== undefined ? { fog: normalizeFog(d.fog) } : {}),
      ...(d.backgroundFileId !== undefined ? { backgroundFileId: d.backgroundFileId } : {}),
      ...(d.musicTrackId !== undefined ? { musicTrackId: d.musicTrackId } : {}),
      ...(d.position !== undefined ? { position: d.position } : {}),
      updatedAt: new Date(),
    })
    .where(eq(campfireScenes.id, scene.id))
    .returning();
  await emitScene(t.campaign, "upsert", row.id);
  // What players can see may have changed: they get the fog, map pieces and tokens again.
  if (d.fog !== undefined || d.built !== undefined || d.grid !== undefined) await emitFog(t.campaign, row);
  res.json(sceneOut(row, t));
});

coreRouter.delete("/scenes/:id", changeLimiter, async (req, res) => {
  const found = await sceneTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, scene } = found;
  await db.transaction(async (tx) => {
    await tx.delete(campfireScenes).where(eq(campfireScenes.id, scene.id));
    if (t.campaign.activeSceneId === scene.id) {
      const [next] = await tx.select({ id: campfireScenes.id }).from(campfireScenes).where(eq(campfireScenes.campaignId, t.campaign.id)).orderBy(asc(campfireScenes.position)).limit(1);
      await tx.update(campfireCampaigns).set({ activeSceneId: next?.id ?? null, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id));
    }
  });
  const fresh = (await campaignRow(t.campaign.id)) ?? t.campaign;
  if (t.campaign.activeSceneId === scene.id && fresh.activeSceneId) await emitScene(fresh, "activate", fresh.activeSceneId);
  else await emitScene(fresh, "delete", scene.id);
  res.json({ ok: true });
});

coreRouter.post("/campaigns/:id/scenes/:sceneId/activate", changeLimiter, async (req, res) => {
  const t = await tableOr(res, req.params.id, { gm: true });
  if (!t) return;
  const sceneId = idParam.safeParse(req.params.sceneId);
  const scene = sceneId.success ? await sceneRow(sceneId.data) : null;
  if (!scene || scene.campaignId !== t.campaign.id) return notFound(res);
  const [row] = await db.update(campfireCampaigns).set({ activeSceneId: scene.id, updatedAt: new Date() }).where(eq(campfireCampaigns.id, t.campaign.id)).returning();
  await emitScene(row, "activate", scene.id);
  res.json({ ok: true, activeSceneId: scene.id });
});

coreRouter.post("/scenes/:id/fog", changeLimiter, mapLimiter, async (req, res) => {
  const found = await sceneTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, scene } = found;
  const op = z.enum(["reveal", "hide", "reset", "revealAll"]).safeParse(req.body?.op);
  if (!op.success) return bad(res, "Pick reveal, hide, reset or reveal all.");
  const fog = normalizeFog(scene.fog);
  if (op.data === "reset") {
    fog.enabled = true;
    fog.revealed = [];
  } else if (op.data === "revealAll") {
    fog.enabled = false;
    fog.revealed = [];
  } else {
    const shape = cleanFogShape(req.body?.shape, `f${Date.now().toString(36)}`);
    if (!shape) return bad(res, "Draw a rectangle or a shape to reveal or hide.");
    if (fog.revealed.length >= CAMPFIRE_LIMITS.fogShapes || fogPointCount(fog) + shape.points.length > CAMPFIRE_LIMITS.fogPoints) return bad(res, "This scene's fog has too many pieces. Reset the fog and reveal it again.", 409);
    fog.enabled = true;
    const next: FogShape = op.data === "hide" ? { ...shape, mode: "hide" } : { id: shape.id, kind: shape.kind, points: shape.points };
    fog.revealed.push(next);
  }
  const [row] = await db.update(campfireScenes).set({ fog, updatedAt: new Date() }).where(eq(campfireScenes.id, scene.id)).returning();
  await emitFog(t.campaign, row);
  res.json({ fog });
});

// ───────────── Tokens ─────────────

const barInput = z
  .object({
    value: z.number().int().min(-99_999).max(99_999).nullable(),
    max: z.number().int().min(0).max(99_999).nullable(),
    color: z.string().refine(isColor, "Bar colors look like #e0193a."),
    show: z.enum(["all", "owner", "gm"]),
  })
  .nullable();
const barsInput = z.array(barInput).max(3).transform((l) => [0, 1, 2].map((i) => (l[i] ?? null) as TokenBar | null));
const conditionsInput = z
  .array(z.string().regex(/^[a-z0-9-]{1,24}$/i, "Conditions are short words."))
  .max(24)
  .transform((l) => [...new Set(l.map((c) => c.toLowerCase()))]);
const auraInput = z.object({ radiusFt: z.number().min(0).max(1000), color: z.string().refine(isColor, "Aura colors look like #ffb347.") }).nullable();

const tokenInput = z.object({
  layer: z.enum(["map", "tokens", "gm"]).optional(),
  name: z.string().max(CAMPFIRE_LIMITS.tokenName).transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, "").trim()).optional(),
  characterId: z.uuid().nullable().optional(),
  imageFileId: z.uuid().nullable().optional(),
  x: coord.optional(),
  y: coord.optional(),
  w: z.number().int().min(1).max(20).optional(),
  h: z.number().int().min(1).max(20).optional(),
  rotation: z.number().finite().transform((r) => ((Math.round(r) % 360) + 360) % 360).optional(),
  bars: barsInput.optional(),
  conditions: conditionsInput.optional(),
  aura: auraInput.optional(),
  showName: z.boolean().optional(),
  controlledBy: uuidList(20).optional(),
  z: z.number().int().min(-10_000).max(10_000).optional(),
  srdMonster: z.string().refine(isSrdSlug).optional(),
});

const hpBar = (current: number, max: number): TokenBar => ({ value: current, max, color: "#e0193a", show: "all" });

coreRouter.post("/scenes/:id/tokens", changeLimiter, async (req, res) => {
  const found = await sceneTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, scene } = found;
  const parsed = tokenInput.safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.x === undefined || d.y === undefined) return bad(res, "Where should it go? (x and y)");
  if (!(await fileOfKind(t.campaign.id, d.imageFileId, "token")) && !(await fileOfKind(t.campaign.id, d.imageFileId, "portrait"))) return bad(res, "Upload that picture to this campaign first.");
  if (d.controlledBy?.length && (await inHome(t.campaign, d.controlledBy)).length !== d.controlledBy.length) return bad(res, "Only people at this table can control tokens.");
  let characterId = d.characterId ?? null;
  let name = d.name ?? "";
  let bars = d.bars ?? [null, null, null];
  let size = { w: d.w ?? 1, h: d.h ?? 1 };
  if (characterId) {
    const [ch] = await db.select().from(campfireCharacters).where(and(eq(campfireCharacters.id, characterId), eq(campfireCharacters.campaignId, t.campaign.id)));
    if (!ch) return bad(res, "That character isn't in this campaign.");
    const sheet = normalizeSheet(ch.sheet);
    name ||= ch.name;
    if (!d.bars) bars = [hpBar(sheet.hp.current, sheet.hp.max), null, null];
    if (d.w === undefined && d.h === undefined) size = { w: sizeCells(sheet.size), h: sizeCells(sheet.size) };
  } else if (d.srdMonster) {
    // A monster from the compendium: its stat block becomes an NPC, ready to roll.
    const monster = monsterBySlug(d.srdMonster);
    if (!monster) return bad(res, "That monster isn't in the compendium.");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(campfireCharacters).where(eq(campfireCharacters.campaignId, t.campaign.id));
    if (n >= CAMPFIRE_LIMITS.characters) return bad(res, `A campaign can have up to ${CAMPFIRE_LIMITS.characters} characters.`, 409);
    const [ch] = await db
      .insert(campfireCharacters)
      .values({ campaignId: t.campaign.id, ownerId: null, kind: "npc", name: monster.name, sheet: monster.sheet, srdMonster: monster.slug })
      .returning();
    characterId = ch.id;
    name ||= monster.name;
    if (!d.bars) bars = [hpBar(monster.sheet.hp.current, monster.sheet.hp.max), null, null];
    if (d.w === undefined && d.h === undefined) size = { w: sizeCells(monster.size), h: sizeCells(monster.size) };
  }
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: campfireScenes.id }).from(campfireScenes).where(eq(campfireScenes.id, scene.id)).for("update");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(campfireTokens).where(eq(campfireTokens.sceneId, scene.id));
    if (n >= CAMPFIRE_LIMITS.tokensPerScene) return null;
    const [row] = await tx
      .insert(campfireTokens)
      .values({
        sceneId: scene.id,
        layer: d.layer ?? "tokens",
        characterId,
        name: name || "Token",
        imageFileId: d.imageFileId ?? null,
        x: d.x!,
        y: d.y!,
        w: size.w,
        h: size.h,
        rotation: d.rotation ?? 0,
        bars,
        conditions: d.conditions ?? [],
        aura: d.aura ?? null,
        showName: d.showName ?? true,
        controlledBy: d.controlledBy ?? [],
        z: d.z ?? 0,
      })
      .returning();
    return row;
  });
  if (!row) return bad(res, `A scene can have up to ${CAMPFIRE_LIMITS.tokensPerScene} tokens.`, 409);
  await emitToken(t.campaign, scene, null, row);
  res.status(201).json(tokenOut(row, t, await charactersInfo(t.campaign.id), settingsOf(t.campaign.settings)));
});

/** A token, its scene and the table (players: only on the active scene and only if they see it). */
export async function tokenTable(res: Parameters<typeof tableOr>[0], tokenId: unknown, opts: { write?: boolean; gm?: boolean } = {}) {
  const id = idParam.safeParse(tokenId);
  const [token] = id.success ? await db.select().from(campfireTokens).where(eq(campfireTokens.id, id.data)) : [];
  const scene = token ? await sceneRow(token.sceneId) : null;
  if (!token || !scene) {
    notFound(res);
    return null;
  }
  const t = await tableOr(res, scene.campaignId, opts);
  if (!t) return null;
  const chars = await charactersInfo(t.campaign.id);
  if (!t.gm && (scene.id !== t.campaign.activeSceneId || !tokenVisible(token, scene, t, chars))) {
    notFound(res);
    return null;
  }
  return { t, scene, token, chars };
}

const MOVE_TOO_FAST = "Moving too fast. Slow down a little.";
const moveSlot = (userId: string) => slot(`campfire:move:${userId}`, CAMPFIRE_LIMITS.movesPerSecond, 1000);

coreRouter.patch("/tokens/:id", async (req, res) => {
  const found = await tokenTable(res, req.params.id, { write: true });
  if (!found) return;
  const { t, scene, token, chars } = found;
  const parsed = tokenInput.omit({ srdMonster: true }).strict().safeParse(req.body);
  if (!parsed.success) return bad(res, firstIssue(parsed.error));
  const d = parsed.data;
  if (!t.gm) {
    // Players: only tokens they control, and only where it is, its bars and its conditions.
    if (!controls(token, t.userId, chars)) return bad(res, "That token isn't yours to move.", 403);
    const allowed = new Set(["x", "y", "bars", "conditions"]);
    if (Object.keys(d).some((k) => !allowed.has(k))) return bad(res, "Only the game master can change that.", 403);
    if (d.bars) {
      // Who sees each bar stays as the GM set it.
      d.bars = d.bars.map((b, i) => {
        const was = token.bars[i] ?? null;
        if (!b || !was || was.show === "gm") return was;
        return { ...b, color: was.color, show: was.show };
      });
    }
  } else {
    if (d.imageFileId && !(await fileOfKind(t.campaign.id, d.imageFileId, "token")) && !(await fileOfKind(t.campaign.id, d.imageFileId, "portrait"))) return bad(res, "Upload that picture to this campaign first.");
    if (d.characterId && !chars.has(d.characterId)) return bad(res, "That character isn't in this campaign.");
    if (d.controlledBy?.length && (await inHome(t.campaign, d.controlledBy)).length !== d.controlledBy.length) return bad(res, "Only people at this table can control tokens.");
  }
  if ((d.x !== undefined || d.y !== undefined) && !(await moveSlot(t.userId))) return bad(res, MOVE_TOO_FAST, 429, "too_many_requests");
  const [row] = await db
    .update(campfireTokens)
    .set({ ...d, updatedAt: new Date() })
    .where(eq(campfireTokens.id, token.id))
    .returning();
  if (d.bars && row.characterId) await syncSheetFromToken(t, row, !t.gm);
  await emitToken(t.campaign, scene, token, row);
  res.json(tokenOut(row, t, chars, settingsOf(t.campaign.settings)));
});

coreRouter.delete("/tokens/:id", changeLimiter, async (req, res) => {
  const found = await tokenTable(res, req.params.id, { gm: true });
  if (!found) return;
  const { t, scene, token } = found;
  await db.delete(campfireTokens).where(eq(campfireTokens.id, token.id));
  await emitToken(t.campaign, scene, token, null);
  res.json({ ok: true });
});

// Dragging: moves over the live connection (30 a second at most), checked like PATCH.
const tableCache = new Map<string, { at: number; t: Table | null }>();
async function cachedTable(campaignId: string, userId: string): Promise<Table | null> {
  const key = `${campaignId}:${userId}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.t;
  const t = await tableFor(campaignId, userId);
  if (tableCache.size > 10_000) tableCache.clear();
  tableCache.set(key, { at: Date.now(), t });
  return t;
}

const moveInput = z.object({ tokenId: z.uuid(), x: coord, y: coord });
export async function socketMove(userId: string, payload: unknown): Promise<void> {
  const parsed = moveInput.safeParse(payload);
  if (!parsed.success || !(await moveSlot(userId))) return;
  const [token] = await db.select().from(campfireTokens).where(eq(campfireTokens.id, parsed.data.tokenId));
  const scene: SceneRow | null = token ? await sceneRow(token.sceneId) : null;
  if (!token || !scene) return;
  const t = await cachedTable(scene.campaignId, userId);
  if (!t || t.readOnly) return;
  const chars = await charactersInfo(t.campaign.id);
  if (!t.gm && (scene.id !== t.campaign.activeSceneId || !controls(token, userId, chars) || !tokenVisible(token, scene, t, chars))) return;
  const [row]: TokenRow[] = await db
    .update(campfireTokens)
    .set({ x: parsed.data.x, y: parsed.data.y, updatedAt: new Date() })
    .where(eq(campfireTokens.id, token.id))
    .returning();
  if (row) await emitToken(t.campaign, scene, token, row);
}

onSocketEvent(
  "campfire:move",
  (who, payload) => {
    socketMove(who.id, payload).catch((err) => console.error("Campfire move failed:", err));
  },
  "campfire",
);
