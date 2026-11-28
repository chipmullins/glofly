import { createHash, randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  DISCORD_FILE_MAX,
  DISCORD_PAIRS_MAX,
  DISCORD_VOICE_PAIRS_MAX,
  newNebulaName,
  DEFAULT_DISCORD_SETTINGS,
  MESSAGE_MAX,
  NEBULAS_MAX,
  cleanDiscordSettings,
  matchKey,
  hiddenFromEveryone,
  type BridgedFrom,
  type DiscordBridgeInfo,
  type DiscordBridgeSettings,
  type DiscordNewChannel,
} from "@glofly/shared";
import { db } from "../db";
import { redis } from "../redis";
import { storage, sendStream } from "../storage";
import {
  attachments,
  constellationApiKeys,
  constellationCategories,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  discordBridgeChannels,
  discordBridgeVoice,
  discordBridgeMessages,
  discordBridges,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUsers, onlineNow } from "../realtime";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { registerToolHooks } from "../toolHooks";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { constellationChanged } from "../constellations/activity";
import { addMember, ConstellationFull } from "../constellations/members";
import { syncNebulaAccess } from "../constellations/access";
import { announceVoice } from "../constellations/voice";
import { createBotUser, logIntegration } from "../integrations/keys";
import { postScheduledText, removeMessageForGood, sendUpdated } from "../messages/routes";
import { processUpload, storeUpload, cleanFileName } from "../messages/attachments";
import { publicBase } from "../connections/live";
import { createNebula } from "../constellations/routes";
import { keyFor } from "../messages/attachments";
import {
  DiscordError,
  TEXT_CHANNEL_TYPES,
  VOICE_CHANNEL_TYPE,
  discord,
  discordConfigured,
  discordFiles,
  guildChannels,
  guildFromCode,
  inviteUrl,
  webhookName,
  type DiscordMessage,
} from "./discordApi";
import { CDN, discordAvatarKey, discordAvatarRef, gloflyAvatarSigOk, gloflyAvatarUrl } from "./avatars";
import { forgetVoicePair, loadVoicePairs, onVoiceEvent, startVoiceBridge, startVoicePair, voiceSettingsChanged } from "./voice";
import { DiscordGateway } from "./gateway";

// Communities round 2 (Nov 2026), boards 5a–5b: the Discord ↔ Glofly bridge.
//
//   GET    /constellations/:id/discord                  Settings → Discord bridge (DiscordBridgeInfo)
//   POST   /constellations/:id/discord/connect          → { url } "Add the Glofly Bridge bot" (opens Discord)
//   GET    /bridge/discord/callback?code&state&guild_id   where Discord sends people back (a small page)
//   PUT    /constellations/:id/discord/settings         { edits?, files?, names?, everyone? }
//   POST   /constellations/:id/discord/pairs            { discordChannelId, nebulaId } or { discordChannelId, newNebula: true }
//                                                        (Nov 28: a voice channel pairs with a voice nebula: who's in voice)
//   DELETE /constellations/:id/discord/voice/:vid        unpair a voice channel
//   PATCH  /constellations/:id/discord/pairs/:pid       { paused }
//   DELETE /constellations/:id/discord/pairs/:pid
//   POST   /constellations/:id/discord/note             { where: "discord" | "glofly" }  "Tell members"
//   DELETE /constellations/:id/discord                  turn the bridge off (copies stay)
//   GET    /bridge/avatars/:discordUserId/:hash         a Discord person's picture (Glofly's copy)
//   GET    /bridge/glofly-avatars/:user/:version/:sig.png  Nov 28: a Glofly person's picture for Discord (signed)
//
// Who: the owner or "Edit constellation settings" (like Integrations). The bridge acts in Glofly as
// a bot with an API key (messages:read + messages:write on the paired nebulas only), so every
// member of a paired nebula sees "Messages here are also shared with Discord · <server>".

export const discordRouter = Router();
const PATHS = ["/constellations/:id/discord", "/constellations/:id/discord/*rest"];
discordRouter.use(PATHS, requireAuth);
discordRouter.use(PATHS, async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

type Me = { id: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const snowflake = z.string().regex(/^\d{5,25}$/);
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "conflict" : "invalid", message });
const changeLimiter = rateLimit("discord:change", {
  windowMs: 10 * 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of changes. Wait a few minutes." },
});

const redirectUri = (req: Request) => `${publicBase(`${req.protocol}://${req.get("host")}`)}/bridge/discord/callback`;

async function manager(req: Request, res: Response): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't available.", 404);
    return null;
  }
  if (!can(s, "manageConstellation")) {
    bad(res, "Only people who can edit this constellation's settings can set up the Discord bridge.", 403);
    return null;
  }
  // A frozen constellation can be looked at, not changed.
  if (req.method !== "GET" && (await frozen(s.constellationId))) {
    bad(res, FROZEN_MESSAGE, 403);
    return null;
  }
  return s;
}

// ───────────── Caches (small: one row per paired channel) ─────────────

type Pair = typeof discordBridgeChannels.$inferSelect & {
  bridge: typeof discordBridges.$inferSelect;
  conversationId: string;
  nebulaName: string;
};
let byChannel = new Map<string, Pair>();
let byNebulaChat = new Map<string, Pair>();
let loadedAt = 0;

async function loadPairs(): Promise<void> {
  const rows = await db
    .select({ c: discordBridgeChannels, b: discordBridges, conversationId: nebulas.conversationId, nebulaName: nebulas.name })
    .from(discordBridgeChannels)
    .innerJoin(discordBridges, eq(discordBridges.id, discordBridgeChannels.bridgeId))
    .innerJoin(nebulas, eq(nebulas.id, discordBridgeChannels.nebulaId));
  const a = new Map<string, Pair>();
  const b = new Map<string, Pair>();
  for (const r of rows) {
    const p: Pair = { ...r.c, bridge: r.b, conversationId: r.conversationId, nebulaName: r.nebulaName };
    a.set(p.discordChannelId, p);
    b.set(p.conversationId, p);
  }
  byChannel = a;
  byNebulaChat = b;
  loadedAt = Date.now();
}
async function pairs(): Promise<void> {
  if (Date.now() - loadedAt > 60_000) await loadPairs();
}

/** The API key's nebulas follow the pairs (the members' "shared with Discord" notice). */
async function syncKey(bridge: typeof discordBridges.$inferSelect): Promise<void> {
  if (!bridge.apiKeyId) return;
  const ids = (
    await db
      .select({ id: discordBridgeChannels.nebulaId, visibility: nebulas.visibility, optional: nebulas.optional, userIds: nebulas.userIds })
      .from(discordBridgeChannels)
      .innerJoin(nebulas, eq(nebulas.id, discordBridgeChannels.nebulaId))
      .where(eq(discordBridgeChannels.bridgeId, bridge.id))
  )
    .filter((r) => r.visibility === "everyone" && !r.optional && !r.userIds.length)
    .map((r) => r.id);
  await db.update(constellationApiKeys).set({ readNebulaIds: ids, postNebulaIds: ids }).where(eq(constellationApiKeys.id, bridge.apiKeyId));
  await loadPairs();
  await constellationChanged(bridge.constellationId);
}

// ───────────── Settings page ─────────────

async function infoFor(constellationId: string): Promise<DiscordBridgeInfo> {
  const [b] = await db.select().from(discordBridges).where(eq(discordBridges.constellationId, constellationId));
  if (!b) return { available: discordConfigured, bridge: null, channels: [] };
  const list = await db.select().from(discordBridgeChannels).where(eq(discordBridgeChannels.bridgeId, b.id)).orderBy(discordBridgeChannels.createdAt);
  const [by] = b.connectedBy ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, b.connectedBy)) : [];
  const voice = await db.select().from(discordBridgeVoice).where(eq(discordBridgeVoice.bridgeId, b.id)).orderBy(discordBridgeVoice.createdAt);
  let channels: DiscordBridgeInfo["channels"] = [];
  let voiceChannels: NonNullable<DiscordBridgeInfo["voiceChannels"]> = [];
  let lost = !!b.lostAt;
  if (discordConfigured && !lost) {
    try {
      const all = await guildChannels(b.guildId);
      const cats = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, { name: c.name, position: c.position ?? 0 }]));
      // In Discord's own order: categories first by position, then channels inside them.
      const order = (c: { parent_id?: string | null; position?: number }) => [c.parent_id ? (cats.get(c.parent_id)?.position ?? 0) + 1 : 0, c.position ?? 0];
      const sorted = [...all].sort((x, y) => {
        const [a1, a2] = order(x);
        const [b1, b2] = order(y);
        return a1 - b1 || a2 - b2;
      });
      const shape = (c: (typeof all)[number]) => ({ id: c.id, name: c.name, parent: c.parent_id ? (cats.get(c.parent_id)?.name ?? null) : null });
      channels = sorted.filter((c) => TEXT_CHANNEL_TYPES.includes(c.type)).map(shape);
      voiceChannels = sorted.filter((c) => c.type === VOICE_CHANNEL_TYPE).map(shape);
    } catch (err) {
      if (err instanceof DiscordError && (err.status === 403 || err.status === 404)) lost = true;
    }
  }
  return {
    available: discordConfigured,
    bridge: {
      id: b.id,
      guildId: b.guildId,
      guildName: b.guildName,
      guildIconUrl: b.guildIcon ? `${CDN}/icons/${b.guildId}/${b.guildIcon}.png?size=64` : null,
      connectedAt: b.createdAt.toISOString(),
      connectedBy: by ?? null,
      settings: cleanDiscordSettings(b.settings),
      pairs: list.map((p) => ({
        id: p.id,
        discordChannelId: p.discordChannelId,
        discordChannelName: p.discordChannelName,
        nebulaId: p.nebulaId,
        paused: p.paused,
        createdAt: p.createdAt.toISOString(),
      })),
      lost,
      voicePairs: voice.map((v) => ({
        id: v.id,
        discordChannelId: v.discordChannelId,
        discordChannelName: v.discordChannelName,
        nebulaId: v.nebulaId,
        createdAt: v.createdAt.toISOString(),
      })),
      newChannels: b.newChannels ?? [],
    },
    channels,
    voiceChannels,
  };
}

const readLimiter = rateLimit("discord:read", {
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => String(req.params.id),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Try again in a minute." },
});

discordRouter.get("/constellations/:id/discord", readLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  res.json(await infoFor(s.constellationId));
});

discordRouter.post("/constellations/:id/discord/connect", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  if (!discordConfigured) {
    bad(res, "The Discord bridge isn't set up on this server yet.", 503);
    return;
  }
  const state = randomBytes(24).toString("base64url");
  await redis.set(`discord:state:${state}`, JSON.stringify({ constellationId: s.constellationId, userId: s.userId }), { EX: 15 * 60 });
  res.json({ url: inviteUrl(state, redirectUri(req)) });
});

/** The little page people land on after adding the bot (in their browser). */
function page(res: Response, status: number, title: string, text: string): void {
  const esc = (x: string) => x.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  res
    .status(status)
    .setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
    .type("html")
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
        `<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#120c0a;color:#f5ede6;font:16px system-ui,sans-serif}main{max-width:420px;padding:28px;border-radius:20px;background:#1c1210;text-align:center}h1{font-size:22px;margin:0 0 10px}p{color:#d9c2b1;line-height:1.5;margin:0}</style>` +
        `</head><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`,
    );
}

discordRouter.get("/bridge/discord/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const raw = state && state.length < 100 ? await redis.getDel(`discord:state:${state}`) : null;
  if (!raw) {
    page(res, 400, "That link has expired", "Go back to Glofly and press “Add the Glofly Bridge bot” again.");
    return;
  }
  if (!code) {
    page(res, 400, "Nothing was added", "Discord didn't add the bot. You can try again from Glofly whenever you like.");
    return;
  }
  const { constellationId, userId } = JSON.parse(raw) as { constellationId: string; userId: string };
  const s = await standingOf(constellationId, userId);
  if (!s || !can(s, "manageConstellation")) {
    page(res, 403, "Not allowed", "You can't set up this constellation's Discord bridge any more.");
    return;
  }
  const guild = await guildFromCode(code, redirectUri(req)).catch(() => null);
  if (!guild) {
    page(res, 400, "Discord didn't confirm it", "Glofly couldn't confirm which server the bot was added to. Try again from Glofly.");
    return;
  }
  const [taken] = await db.select({ constellationId: discordBridges.constellationId }).from(discordBridges).where(eq(discordBridges.guildId, guild.id));
  if (taken && taken.constellationId !== constellationId) {
    page(res, 409, "Already bridged", `${guild.name} is already bridged to another constellation. Turn that bridge off first.`);
    return;
  }
  const [c] = await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, constellationId));
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(discordBridges).where(eq(discordBridges.constellationId, constellationId)).for("update");
      if (existing) {
        // Added again (or to a different server): keep the bot, point it at this server.
        await tx.update(discordBridges).set({ guildId: guild.id, guildName: guild.name, guildIcon: guild.icon, lostAt: null }).where(eq(discordBridges.id, existing.id));
        if (existing.guildId !== guild.id) {
          // Moved to another server: the old server's webhooks go, and the bot leaves it.
          const old = await tx.delete(discordBridgeChannels).where(eq(discordBridgeChannels.bridgeId, existing.id)).returning({ webhookId: discordBridgeChannels.webhookId });
          for (const o of old) void discord("DELETE", `/webhooks/${o.webhookId}`).catch(() => undefined);
          await tx.delete(discordBridgeVoice).where(eq(discordBridgeVoice.bridgeId, existing.id));
          void discord("DELETE", `/users/@me/guilds/${existing.guildId}`).catch(() => undefined);
        }
        return;
      }
      const name = `Discord · ${guild.name}`.slice(0, 40);
      const botId = await createBotUser(tx, name);
      await addMember(tx, constellationId, botId, { welcomed: true });
      const unusable = createHash("sha256").update(randomBytes(32)).digest("hex");
      const [key] = await tx
        .insert(constellationApiKeys)
        .values({
          constellationId,
          botUserId: botId,
          name,
          keyPrefix: "gfk_discord",
          keyHash: unusable,
          scopes: ["messages:read", "messages:write"],
          createdBy: userId,
        })
        .returning({ id: constellationApiKeys.id });
      await tx.insert(discordBridges).values({
        constellationId,
        guildId: guild.id,
        guildName: guild.name,
        guildIcon: guild.icon,
        apiKeyId: key.id,
        botUserId: botId,
        settings: DEFAULT_DISCORD_SETTINGS,
        connectedBy: userId,
      });
    });
  } catch (err) {
    if (err instanceof ConstellationFull) {
      page(res, 409, "No room", "This constellation is full, so there's no room for the bridge's bot.");
      return;
    }
    throw err;
  }
  await syncNebulaAccess(constellationId);
  await logIntegration({ constellationId, keyId: null, keyName: "Discord bridge", actorId: userId, action: "discord.connected", details: { server: guild.name } });
  await loadPairs();
  await loadVoicePairs();
  await constellationChanged(constellationId);
  page(res, 200, "Connected", `${guild.name} is connected to ${c?.name ?? "your constellation"}. Go back to Glofly to pick the channels to bridge.`);
});

async function bridgeOf(s: Standing, res: Response) {
  const [b] = await db.select().from(discordBridges).where(eq(discordBridges.constellationId, s.constellationId));
  if (!b) bad(res, "Add the Glofly Bridge bot to your Discord server first.", 409);
  return b ?? null;
}

discordRouter.put("/constellations/:id/discord/settings", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const b = await bridgeOf(s, res);
  if (!b) return;
  const settings = cleanDiscordSettings(req.body, cleanDiscordSettings(b.settings));
  await db.update(discordBridges).set({ settings }).where(eq(discordBridges.id, b.id));
  await loadPairs();
  await voiceSettingsChanged(b.id);
  res.json(await infoFor(s.constellationId));
});

discordRouter.post("/constellations/:id/discord/pairs", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const b = await bridgeOf(s, res);
  if (!b) return;
  const body = z
    .union([z.object({ discordChannelId: snowflake, nebulaId: idParam }), z.object({ discordChannelId: snowflake, newNebula: z.literal(true) })])
    .safeParse(req.body);
  if (!body.success) {
    bad(res, "Pick a Discord channel and a nebula.");
    return;
  }
  const done = await pairChannel(b, s.constellationId, body.data.discordChannelId, "newNebula" in body.data ? "new" : body.data.nebulaId, {
    actorId: s.userId,
    canMakeNebulas: can(s, "manageNebulas"),
  });
  if ("error" in done) {
    bad(res, done.error, done.status);
    return;
  }
  res.status(201).json(await infoFor(s.constellationId));
});

type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  guild_id?: string;
  parent_id?: string | null;
  permission_overwrites?: { id: string; type: number | string; deny: string }[];
};

/**
 * Pairs a Discord channel with a nebula ("new" = make one named like it). The one way a pair is
 * made: the pairing screen and 0.12.0's auto-bridge of new Discord channels both come here.
 */
async function pairChannel(
  b: typeof discordBridges.$inferSelect,
  constellationId: string,
  discordChannelId: string,
  target: string | "new",
  who: { actorId: string; canMakeNebulas: boolean; auto?: boolean; known?: DiscordChannel },
): Promise<{ ok: true } | { error: string; status: number }> {
  const fail = (error: string, status = 400) => ({ error, status });
  // The channel must be in the connected Discord server (checked with Discord, not trusted).
  let channel: DiscordChannel;
  try {
    channel = who.known ?? (await discord("GET", `/channels/${discordChannelId}`));
  } catch {
    return fail("Glofly Bridge can't see that channel. Check its permissions in Discord.");
  }
  const voice = channel.type === VOICE_CHANNEL_TYPE;
  if (channel.guild_id !== b.guildId || (!voice && !TEXT_CHANNEL_TYPES.includes(channel.type))) {
    return fail("Pick a text or voice channel from your connected Discord server.");
  }
  const count = voice
    ? await db.$count(discordBridgeVoice, eq(discordBridgeVoice.bridgeId, b.id))
    : await db.$count(discordBridgeChannels, eq(discordBridgeChannels.bridgeId, b.id));
  const max = voice ? DISCORD_VOICE_PAIRS_MAX : DISCORD_PAIRS_MAX;
  if (count >= max) {
    return fail(`Up to ${max} ${voice ? "voice" : ""} channels can be bridged.`.replace("  ", " "), 409);
  }
  const [taken] = voice
    ? await db.select({ id: discordBridgeVoice.id }).from(discordBridgeVoice).where(eq(discordBridgeVoice.discordChannelId, channel.id))
    : await db.select({ id: discordBridgeChannels.id }).from(discordBridgeChannels).where(eq(discordBridgeChannels.discordChannelId, channel.id));
  if (taken) {
    return fail("That Discord channel is already bridged.", 409);
  }

  // Nov 28: "+ New nebula" right from the pairing screen. An ordinary nebula (moved, renamed and
  // unpaired like any other), in the category named like the Discord one, else the first category.
  let n: typeof nebulas.$inferSelect | undefined;
  if (target === "new") {
    if (!who.canMakeNebulas) {
      return fail("Making nebulas needs “Manage nebulas”. Pick an existing nebula instead.", 403);
    }
    n = await newNebulaFor(constellationId, b.guildId, channel, voice ? "voice" : "text");
    if (!n) {
      return fail("That constellation has as many nebulas as it can hold. Pick an existing one.", 409);
    }
  } else {
    [n] = await db.select().from(nebulas).where(and(eq(nebulas.id, target), eq(nebulas.constellationId, constellationId)));
  }
  if (!n) {
    return fail("That nebula isn't in this constellation.");
  }

  if (voice) {
    if (n.kind !== "voice") {
      return fail("A Discord voice channel pairs with a voice nebula.");
    }
    // Who's in it shows in Discord: only voice nebulas everyone in the constellation can see.
    if (n.visibility !== "everyone" || n.optional || n.userIds.length) {
      return fail("Pick a voice nebula everyone in the constellation can see (Discord sees who's in it).");
    }
    const [nebTaken] = await db.select({ id: discordBridgeVoice.id }).from(discordBridgeVoice).where(eq(discordBridgeVoice.nebulaId, n.id));
    if (nebTaken) {
      return fail("That voice nebula is already paired.", 409);
    }
    await db.insert(discordBridgeVoice).values({ bridgeId: b.id, discordChannelId: channel.id, discordChannelName: channel.name.slice(0, 100), nebulaId: n.id });
    await startVoicePair(n.id).catch((err) => console.error("Couldn't start a Discord voice pair:", err));
    await logIntegration({ constellationId, keyId: b.apiKeyId, keyName: "Discord bridge", actorId: who.actorId, action: who.auto ? "discord.voiceAutoPaired" : "discord.voicePaired", details: { channel: channel.name, nebula: n.name } });
    await forgetNewChannel(b.id, channel.id);
    return { ok: true };
  }

  if (n.kind !== "text" && n.kind !== "announcement") {
    return fail("Pick a text nebula from this constellation.");
  }
  if (n.visibility !== "everyone" || n.optional || n.userIds.length) {
    return fail("Pick a nebula everyone in the constellation can see (Discord can read it).");
  }
  const [nebTaken] = await db.select({ id: discordBridgeChannels.id }).from(discordBridgeChannels).where(eq(discordBridgeChannels.nebulaId, n.id));
  if (nebTaken) {
    return fail("That nebula is already bridged.", 409);
  }
  let hook: { id: string; token: string };
  try {
    hook = await discord("POST", `/channels/${channel.id}/webhooks`, { name: "Glofly Bridge" });
  } catch {
    return fail("Glofly Bridge couldn't make a webhook there. Give it “Manage Webhooks” in that channel.");
  }
  await db.insert(discordBridgeChannels).values({
    bridgeId: b.id,
    discordChannelId: channel.id,
    discordChannelName: channel.name.slice(0, 100),
    nebulaId: n.id,
    webhookId: hook.id,
    webhookToken: hook.token,
  });
  await syncKey(b);
  await logIntegration({ constellationId, keyId: b.apiKeyId, keyName: "Discord bridge", actorId: who.actorId, action: who.auto ? "discord.autoPaired" : "discord.paired", details: { channel: channel.name, nebula: n.name } });
  await forgetNewChannel(b.id, channel.id);
  return { ok: true };
}

/**
 * 0.12.0: a channel made in a bridged Discord server is bridged by itself while "Bridge new
 * channels" is on (the default). A nebula of the same name that isn't bridged yet is used, else a
 * new one (same category rule as "+ New nebula"). Never for channels hidden from @everyone, a
 * frozen constellation or a lost bot; nothing happens if the bridge is full.
 */
async function autoBridge(c: DiscordChannel): Promise<void> {
  if (!c.guild_id) return;
  const voice = c.type === VOICE_CHANNEL_TYPE;
  if (!voice && !TEXT_CHANNEL_TYPES.includes(c.type)) return;
  const [b] = await db.select().from(discordBridges).where(and(eq(discordBridges.guildId, c.guild_id), isNull(discordBridges.lostAt)));
  if (!b || !cleanDiscordSettings(b.settings).autoBridge) return;
  if (hiddenFromEveryone(c, b.guildId) || (await frozen(b.constellationId))) return;
  const taken = new Set(
    (voice
      ? await db.select({ id: discordBridgeVoice.nebulaId }).from(discordBridgeVoice)
      : await db.select({ id: discordBridgeChannels.nebulaId }).from(discordBridgeChannels)
    ).map((r) => r.id),
  );
  const same = (await db.select().from(nebulas).where(eq(nebulas.constellationId, b.constellationId))).find(
    (n) =>
      !taken.has(n.id) &&
      (voice ? n.kind === "voice" : n.kind === "text" || n.kind === "announcement") &&
      n.visibility === "everyone" &&
      !n.optional &&
      !n.userIds.length &&
      matchKey(n.name) === matchKey(c.name),
  );
  if (same) {
    const done = await pairChannel(b, b.constellationId, c.id, same.id, { actorId: b.botUserId, canMakeNebulas: true, auto: true, known: c });
    if (!("error" in done)) {
      await loadPairs();
      return;
    }
    console.warn(`Discord bridge: didn't bridge the new channel #${c.name}: ${done.error}`);
  }
  // No match (or it couldn't pair): ask the people who manage the bridge (Chip, Nov 28).
  let parent: string | null = null;
  if (c.parent_id) {
    try {
      parent = (await guildChannels(b.guildId)).find((x) => x.id === c.parent_id)?.name ?? null;
    } catch {
      parent = null;
    }
  }
  const entry: DiscordNewChannel = { id: c.id, name: c.name.slice(0, 100), voice, parent, at: new Date().toISOString() };
  const list = [...(b.newChannels ?? []).filter((x) => x.id !== c.id), entry].slice(-NEW_CHANNELS_MAX);
  await db.update(discordBridges).set({ newChannels: list }).where(eq(discordBridges.id, b.id));
  emitToUsers(await managersOnline(b.constellationId), "discord:newChannel", { constellationId: b.constellationId, channel: entry }, true);
}

/** At most this many unmatched new channels wait (the oldest drop off). */
const NEW_CHANNELS_MAX = 20;

async function forgetNewChannel(bridgeId: string, channelId: string): Promise<void> {
  await db
    .update(discordBridges)
    .set({ newChannels: sql`coalesce((select jsonb_agg(x) from jsonb_array_elements(${discordBridges.newChannels}) x where x->>'id' <> ${channelId}), '[]'::jsonb)` })
    .where(eq(discordBridges.id, bridgeId));
}

/** Online people who can manage the bridge ("Edit constellation settings" or the owner). */
async function managersOnline(constellationId: string): Promise<string[]> {
  const [c] = await db.select({ ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, constellationId));
  if (!c) return [];
  const roles = (await db.select().from(constellationRoles).where(eq(constellationRoles.constellationId, constellationId))).filter(
    (r) => !r.selfAssign && r.permissions.includes("manageConstellation"),
  );
  const ids = new Set<string>([c.ownerId]);
  if (roles.some((r) => r.kind === "member")) {
    for (const m of await db.select({ id: constellationMembers.userId }).from(constellationMembers).where(eq(constellationMembers.constellationId, constellationId))) ids.add(m.id);
  } else if (roles.length) {
    const held = await db
      .select({ id: constellationMemberRoles.userId })
      .from(constellationMemberRoles)
      .where(and(eq(constellationMemberRoles.constellationId, constellationId), inArray(constellationMemberRoles.roleId, roles.map((r) => r.id))));
    for (const h of held) ids.add(h.id);
  }
  return onlineNow(ids);
}

discordRouter.get("/constellations/:id/discord/new-channels", async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const [b] = await db.select({ newChannels: discordBridges.newChannels, settings: discordBridges.settings }).from(discordBridges).where(eq(discordBridges.constellationId, s.constellationId));
  res.json({ newChannels: b && cleanDiscordSettings(b.settings).autoBridge ? b.newChannels : [] });
});

discordRouter.post("/constellations/:id/discord/new-channels/:channelId/dismiss", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const ch = snowflake.safeParse(req.params.channelId);
  const [b] = await db.select({ id: discordBridges.id }).from(discordBridges).where(eq(discordBridges.constellationId, s.constellationId));
  if (ch.success && b) await forgetNewChannel(b.id, ch.data);
  res.status(204).end();
});

/** A nebula for a Discord channel: its name, in the category named like the Discord one (or the first). */
async function newNebulaFor(
  constellationId: string,
  guildId: string,
  channel: { name: string; parent_id?: string | null },
  kind: "text" | "voice",
): Promise<typeof nebulas.$inferSelect | undefined> {
  const name = newNebulaName(channel.name, kind);
  if ((await db.$count(nebulas, eq(nebulas.constellationId, constellationId))) >= NEBULAS_MAX) return undefined;
  const cats = await db
    .select({ id: constellationCategories.id, name: constellationCategories.name, visibility: constellationCategories.visibility })
    .from(constellationCategories)
    .where(eq(constellationCategories.constellationId, constellationId))
    .orderBy(constellationCategories.position);
  let parentName: string | null = null;
  if (channel.parent_id) {
    try {
      parentName = (await guildChannels(guildId)).find((c) => c.id === channel.parent_id)?.name ?? null;
    } catch {
      parentName = null;
    }
  }
  const key = (x: string) => matchKey(x);
  // Only categories everyone can see: a bridged text nebula must be readable by everyone.
  const open = cats.filter((c) => c.visibility !== "roles");
  const category = (parentName ? open.find((c) => key(c.name) === key(parentName)) : undefined) ?? open[0] ?? null;
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${nebulas.position}), -1)::int` })
    .from(nebulas)
    .where(eq(nebulas.constellationId, constellationId));
  const row = await db.transaction((tx) => createNebula(tx, constellationId, { name, kind, categoryId: category?.id ?? null, topic: null, position: max + 1 }));
  await constellationChanged(constellationId);
  return row;
}

discordRouter.delete("/constellations/:id/discord/voice/*rest", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const vid = idParam.safeParse(String(req.params.rest ?? "").split(",")[0]);
  const [row] = vid.success
    ? await db
        .select({ v: discordBridgeVoice })
        .from(discordBridgeVoice)
        .innerJoin(discordBridges, eq(discordBridges.id, discordBridgeVoice.bridgeId))
        .where(and(eq(discordBridgeVoice.id, vid.data), eq(discordBridges.constellationId, s.constellationId)))
    : [];
  if (!row) {
    bad(res, "That voice pair isn't there any more.", 404);
    return;
  }
  await db.delete(discordBridgeVoice).where(eq(discordBridgeVoice.id, row.v.id));
  await forgetVoicePair(row.v);
  await loadVoicePairs();
  const [n] = await db.select({ conversationId: nebulas.conversationId }).from(nebulas).where(eq(nebulas.id, row.v.nebulaId));
  if (n) await announceVoice(n.conversationId);
  res.json(await infoFor(s.constellationId));
});

async function pairFor(req: Request, res: Response, s: Standing) {
  const pid = idParam.safeParse(String(req.params.rest ?? "").split(",")[0]);
  const [row] = pid.success
    ? await db
        .select({ p: discordBridgeChannels, b: discordBridges })
        .from(discordBridgeChannels)
        .innerJoin(discordBridges, eq(discordBridges.id, discordBridgeChannels.bridgeId))
        .where(and(eq(discordBridgeChannels.id, pid.data), eq(discordBridges.constellationId, s.constellationId)))
    : [];
  if (!row) bad(res, "That bridged channel isn't there any more.", 404);
  return row ?? null;
}

discordRouter.patch("/constellations/:id/discord/pairs/*rest", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const row = await pairFor(req, res, s);
  if (!row) return;
  await db.update(discordBridgeChannels).set({ paused: req.body?.paused === true }).where(eq(discordBridgeChannels.id, row.p.id));
  await loadPairs();
  res.json(await infoFor(s.constellationId));
});

discordRouter.delete("/constellations/:id/discord/pairs/*rest", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const row = await pairFor(req, res, s);
  if (!row) return;
  await discord("DELETE", `/webhooks/${row.p.webhookId}`).catch(() => undefined);
  await db.delete(discordBridgeChannels).where(eq(discordBridgeChannels.id, row.p.id));
  await syncKey(row.b);
  res.json(await infoFor(s.constellationId));
});

discordRouter.post("/constellations/:id/discord/note", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const b = await bridgeOf(s, res);
  if (!b) return;
  await pairs();
  const where = req.body?.where === "discord" ? "discord" : "glofly";
  const [c] = await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, s.constellationId));
  const list = [...byNebulaChat.values()].filter((p) => p.bridgeId === b.id && !p.paused);
  for (const p of list) {
    if (where === "discord") {
      await discord("POST", `/webhooks/${p.webhookId}/${p.webhookToken}`, {
        content: `Messages here are also shared with Glofly (${c?.name ?? "a constellation"} › #${p.nebulaName}).`,
        username: "Glofly Bridge",
        allowed_mentions: { parse: [] },
      }, "none").catch(() => undefined);
    } else {
      await postScheduledText(p.conversationId, b.botUserId, `Messages here are also shared with Discord (${b.guildName} › #${p.discordChannelName}).`, null);
    }
  }
  res.json({ posted: list.length });
});

discordRouter.delete("/constellations/:id/discord", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const b = await bridgeOf(s, res);
  if (!b) return;
  const list = await db.select().from(discordBridgeChannels).where(eq(discordBridgeChannels.bridgeId, b.id));
  for (const p of list) await discord("DELETE", `/webhooks/${p.webhookId}`).catch(() => undefined);
  const voice = await db.select().from(discordBridgeVoice).where(eq(discordBridgeVoice.bridgeId, b.id));
  for (const v of voice) await forgetVoicePair(v);
  await discord("DELETE", `/users/@me/guilds/${b.guildId}`).catch(() => undefined);
  // Copies stay (the bot's member stays too: its messages are its own). The API key goes, so the
  // "shared with Discord" notice goes away.
  if (b.apiKeyId) await db.delete(constellationApiKeys).where(eq(constellationApiKeys.id, b.apiKeyId));
  await db.delete(discordBridges).where(eq(discordBridges.id, b.id));
  await logIntegration({ constellationId: s.constellationId, keyId: null, keyName: "Discord bridge", actorId: s.userId, action: "discord.disconnected", details: { server: b.guildName } });
  await loadPairs();
  await loadVoicePairs();
  for (const v of voice) {
    const [n] = await db.select({ conversationId: nebulas.conversationId }).from(nebulas).where(eq(nebulas.id, v.nebulaId));
    if (n) await announceVoice(n.conversationId);
  }
  await constellationChanged(s.constellationId);
  res.json(await infoFor(s.constellationId));
});

// ───────────── Pictures of Discord people ─────────────

discordRouter.get("/bridge/avatars/:uid/:hash", async (req, res) => {
  const uid = snowflake.safeParse(req.params.uid);
  const hash = z.string().regex(/^(a_)?[0-9a-f]{32}$/).safeParse(req.params.hash);
  const file = uid.success && hash.success ? await storage.get(discordAvatarKey(uid.data, hash.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  sendStream(file.stream, res);
});

// Nov 28: a Glofly person's picture, for Discord (webhook avatar_url). Public but signed: only the
// server makes these addresses (bridge/avatars.ts), and only for the person's current photo.
const gloflyPngs = new Map<string, Buffer>();
discordRouter.get("/bridge/glofly-avatars/:uid/:version/:sig", async (req, res) => {
  const uid = idParam.safeParse(req.params.uid);
  const version = idParam.safeParse(req.params.version);
  const sig = String(req.params.sig ?? "").replace(/\.png$/, "");
  if (!uid.success || !version.success || !/^[A-Za-z0-9_-]{32}$/.test(sig) || !gloflyAvatarSigOk(uid.data, version.data, sig)) {
    res.status(404).end();
    return;
  }
  const [row] = await db.select({ v: users.avatarVersion }).from(users).where(eq(users.id, uid.data));
  if (row?.v !== version.data) {
    res.status(404).end();
    return;
  }
  const cacheKey = `${uid.data}/${version.data}`;
  let png = gloflyPngs.get(cacheKey);
  if (!png) {
    const file = await storage.get(`avatars/${uid.data}/${version.data}.webp`);
    if (!file) {
      res.status(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of file.stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
    // PNG: every Discord client shows it (webhook avatars in WebP aren't shown everywhere).
    png = await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000 }).resize(256, 256, { fit: "cover" }).png().toBuffer();
    if (gloflyPngs.size >= 500) gloflyPngs.clear();
    gloflyPngs.set(cacheKey, png);
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(png.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(png);
});

// ───────────── Discord → Glofly ─────────────

/** Discord's markup for mentions and custom emoji, as plain text. */
function cleanContent(m: DiscordMessage, settings: DiscordBridgeSettings): string {
  const names = new Map((m.mentions ?? []).map((u) => [u.id, u.member?.nick || u.global_name || u.username]));
  let t = (m.content ?? "")
    .replace(/<@!?(\d+)>/g, (_x, id: string) => `@${names.get(id) ?? "someone"}`)
    .replace(/<@&(\d+)>/g, "@role")
    .replace(/<#(\d+)>/g, (_x, id: string) => `#${byChannel.get(id)?.discordChannelName ?? "channel"}`)
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:(\d+)(?::\w)?>/g, (_x, s: string) => new Date(Number(s) * 1000).toUTCString());
  // @everyone / @here from Discord ping in Glofly only when the bridge allows it.
  if (!settings.everyone) t = t.replace(/@(everyone|here)\b/g, "@​$1");
  return t;
}

const fileHost = (url: string): boolean => {
  try {
    const u = new URL(url);
    if (url.startsWith(`${CDN}/`)) return true;
    return u.protocol === "https:" && (u.hostname === "cdn.discordapp.com" || u.hostname === "media.discordapp.net");
  } catch {
    return false;
  }
};

async function inbound(m: DiscordMessage): Promise<void> {
  await pairs();
  const p = byChannel.get(m.channel_id);
  if (!p || p.paused || p.bridge.lostAt) return;
  // Our own posts (the webhook) and the bot itself never come back.
  if (m.webhook_id === p.webhookId || m.author?.id === gateway?.botUserId) return;
  if (m.type !== undefined && m.type !== 0 && m.type !== 19) return; // only messages and replies
  const settings = cleanDiscordSettings(p.bridge.settings);
  // Names can't ping anyone in Glofly (a nickname like "@everyone").
  const name = settings.names
    ? (m.member?.nick || m.author.global_name || m.author.username || "Someone on Discord").replace(/@/g, "@\u200b").replace(/[\r\n]/g, " ").slice(0, 64)
    : "Someone on Discord";
  const avatar = settings.names ? await discordAvatarRef(m.author.id, m.author.avatar) : null;
  const files = settings.files ? (m.attachments ?? []) : [];
  let text = cleanContent(m, settings).trim();
  const tooBig = files.filter((f) => f.size > DISCORD_FILE_MAX);
  if (tooBig.length) text = `${text}\n${tooBig.map((f) => `📎 ${f.filename} (too big to copy, open it in Discord)`).join("\n")}`.trim();
  if (!text && !files.length) return;
  const prefix = `${name}: `;
  const body = (prefix + (text || "📎")).slice(0, MESSAGE_MAX);
  const bridged: BridgedFrom = { source: "discord", name, avatar, skip: prefix.length };
  let replyTo: string | null = null;
  if (m.message_reference?.message_id) {
    const [r] = await db.select({ id: discordBridgeMessages.messageId }).from(discordBridgeMessages).where(eq(discordBridgeMessages.discordMessageId, m.message_reference.message_id));
    replyTo = r?.id ?? null;
  }
  const sent = await postScheduledText(p.conversationId, p.bridge.botUserId, body, replyTo, null, { bridged });
  if (!sent.ok) return;
  await db.insert(discordBridgeMessages).values({ messageId: sent.messageId, discordMessageId: m.id, channelId: p.id, direction: "in" }).onConflictDoNothing();
  // Pictures and files: copied into Glofly (the same cleaning as uploads), then shown on the message.
  let position = 0;
  for (const f of files.filter((x) => x.size <= DISCORD_FILE_MAX).slice(0, 10)) {
    // Only Discord's own file servers (what the Gateway says is trusted, but not that far).
    if (!fileHost(f.url)) continue;
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
      if (!res.ok) continue;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > DISCORD_FILE_MAX) continue;
      const info = await storeUpload(p.conversationId, p.bridge.botUserId, cleanFileName(f.filename), await processUpload(data));
      await db.update(attachments).set({ messageId: sent.messageId, position: position++ }).where(eq(attachments.id, info.id));
    } catch (err) {
      console.error("Couldn't copy a Discord file:", err instanceof Error ? err.message : err);
    }
  }
  if (position) await sendUpdated(sent.messageId, p.conversationId);
}

async function inboundEdit(m: Partial<DiscordMessage> & { id: string; channel_id: string }): Promise<void> {
  await pairs();
  const p = byChannel.get(m.channel_id);
  if (!p || typeof m.content !== "string" || !cleanDiscordSettings(p.bridge.settings).edits) return;
  const [row] = await db
    .select({ id: messages.id, bridged: messages.bridged })
    .from(discordBridgeMessages)
    .innerJoin(messages, eq(messages.id, discordBridgeMessages.messageId))
    .where(and(eq(discordBridgeMessages.discordMessageId, m.id), eq(discordBridgeMessages.direction, "in"), isNull(messages.deletedAt)));
  if (!row?.bridged) return;
  const text = cleanContent(m as DiscordMessage, cleanDiscordSettings(p.bridge.settings)).trim();
  if (!text) return;
  const prefix = `${row.bridged.name}: `;
  await db.update(messages).set({ body: (prefix + text).slice(0, MESSAGE_MAX), editedAt: new Date() }).where(eq(messages.id, row.id));
  await sendUpdated(row.id, p.conversationId);
}

async function inboundDelete(d: { id: string; channel_id: string }): Promise<void> {
  await pairs();
  const p = byChannel.get(d.channel_id);
  if (!p || !cleanDiscordSettings(p.bridge.settings).edits) return;
  const [row] = await db.select({ id: discordBridgeMessages.messageId }).from(discordBridgeMessages).where(and(eq(discordBridgeMessages.discordMessageId, d.id), eq(discordBridgeMessages.direction, "in")));
  if (row) await removeMessageForGood(row.id);
}

// ───────────── Glofly → Discord ─────────────

/** Security review (Nov 11): a paired nebula that became role-only or optional stops going to Discord. */
async function stillOpen(nebulaId: string): Promise<boolean> {
  const [n] = await db.select({ visibility: nebulas.visibility, optional: nebulas.optional, userIds: nebulas.userIds }).from(nebulas).where(eq(nebulas.id, nebulaId));
  return !!n && n.visibility === "everyone" && !n.optional && !n.userIds.length;
}

async function outbound(conversationId: string, messageId: string, change: "created" | "edited" | "deleted"): Promise<void> {
  await pairs();
  const p = byNebulaChat.get(conversationId);
  if (!p || p.paused || p.bridge.lostAt) return;
  if (!(await stillOpen(p.nebulaId))) return;
  const settings = cleanDiscordSettings(p.bridge.settings);
  if (change === "deleted") {
    if (!settings.edits) return;
    const [row] = await db.select().from(discordBridgeMessages).where(and(eq(discordBridgeMessages.messageId, messageId), eq(discordBridgeMessages.direction, "out")));
    if (row) await discord("DELETE", `/webhooks/${p.webhookId}/${p.webhookToken}/messages/${row.discordMessageId}`, undefined, "none").catch(() => undefined);
    return;
  }
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  // Never the bridge's own copies (no echo), events, lanterns, thread replies or the deleted.
  if (!m || m.senderId === p.bridge.botUserId || m.event || m.lantern || m.deletedAt || (m.threadId && !m.alsoInNebula)) return;
  const [sender] = await db.select({ name: users.displayName, avatarVersion: users.avatarVersion, bot: users.bot }).from(users).where(eq(users.id, m.senderId));
  const files = settings.files
    ? await db
        .select({ id: attachments.id, conversationId: attachments.conversationId, name: attachments.name, kind: attachments.kind, size: attachments.size })
        .from(attachments)
        .where(eq(attachments.messageId, m.id))
        .orderBy(attachments.position)
    : [];
  // Nov 28: pictures and files go to Discord as real attachments (up to Discord's upload limit);
  // anything bigger stays a line of text.
  const upload: { name: string; data: Buffer; type: string }[] = [];
  const fileLines: string[] = [];
  if (change === "created") {
    let total = 0;
    for (const f of files) {
      const key = keyFor(f, f.kind === "image" ? "full" : "file");
      const fits = upload.length < 10 && f.size <= DISCORD_UPLOAD_MAX && total + f.size <= DISCORD_UPLOAD_MAX;
      const data = key && fits ? await readStored(key, DISCORD_UPLOAD_MAX) : null;
      if (data && total + data.length <= DISCORD_UPLOAD_MAX) {
        total += data.length;
        const name = f.kind === "image" ? `${f.name.replace(/\.[^.]*$/, "") || "picture"}.webp` : f.name;
        upload.push({ name: name.slice(0, 100), data, type: f.kind === "image" ? "image/webp" : "application/octet-stream" });
      } else fileLines.push(`📎 ${f.kind === "image" ? "a picture" : f.name} (too big for Discord: open Glofly to see it)`);
    }
  } else for (const f of files) fileLines.push(`📎 ${f.kind === "image" ? "a picture" : f.name} (open Glofly to see it)`);
  const content = [m.gif ? `${m.body}` : m.body, ...fileLines].filter(Boolean).join("\n").slice(0, 2000);
  if (!content && !upload.length) return;
  if (change === "edited") {
    if (!content) return;
    if (!settings.edits) return;
    const [row] = await db.select().from(discordBridgeMessages).where(and(eq(discordBridgeMessages.messageId, m.id), eq(discordBridgeMessages.direction, "out")));
    if (row) await discord("PATCH", `/webhooks/${p.webhookId}/${p.webhookToken}/messages/${row.discordMessageId}`, { content, allowed_mentions: { parse: [] } }, "none").catch(() => undefined);
    return;
  }
  const base = publicBase("https://api.glofly.app");
  const payload = {
    content,
    username: webhookName(sender?.name ?? "Glofly member"),
    // Nov 28: a public, signed address (Discord can't sign in to load /avatars/…).
    ...(sender?.avatarVersion ? { avatar_url: gloflyAvatarUrl(base, m.senderId, sender.avatarVersion) } : {}),
    // Nobody in Discord is pinged from Glofly.
    allowed_mentions: { parse: [] },
  };
  const path = `/webhooks/${p.webhookId}/${p.webhookToken}?wait=true`;
  const sent = await (upload.length ? discordFiles<{ id: string }>(path, payload, upload) : discord<{ id: string }>("POST", path, payload, "none")).catch((err) => {
    if (err instanceof DiscordError && err.status === 404) void markWebhookGone(p);
    return null;
  });
  if (sent?.id) await db.insert(discordBridgeMessages).values({ messageId: m.id, discordMessageId: sent.id, channelId: p.id, direction: "out" }).onConflictDoNothing();
}

/** Discord's upload limit for a server without boosts (bigger files stay a line of text). */
const DISCORD_UPLOAD_MAX = 10 * 1024 * 1024;

async function readStored(key: string, max: number): Promise<Buffer | null> {
  const file = await storage.get(key);
  if (!file || file.size > max) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of file.stream as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > max) return null;
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

/** The channel's webhook was deleted in Discord: pause the pair (Settings shows it paused). */
async function markWebhookGone(p: Pair): Promise<void> {
  await db.update(discordBridgeChannels).set({ paused: true }).where(eq(discordBridgeChannels.id, p.id));
  await loadPairs();
}

// ───────────── Start ─────────────

let gateway: DiscordGateway | null = null;

export function startDiscordBridge(): void {
  registerToolHooks({
    onNebulaMessage: async (conversationId, messageId, change) => {
      if (!discordConfigured) return;
      await outbound(conversationId, messageId, change);
    },
  });
  if (!discordConfigured) {
    console.log("Discord bridge is off: set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_BOT_TOKEN to turn it on.");
    return;
  }
  startVoiceBridge();
  gateway = new DiscordGateway((type, data) => {
    const run = (p: Promise<void>) => void p.catch((err) => console.error(`Discord bridge (${type}) failed:`, err));
    if (type === "GUILD_CREATE" || type === "GUILD_DELETE" || type === "VOICE_STATE_UPDATE") onVoiceEvent(type, data);
    if (type === "MESSAGE_CREATE") run(inbound(data as DiscordMessage));
    else if (type === "CHANNEL_CREATE") run(autoBridge(data as DiscordChannel));
    else if (type === "CHANNEL_DELETE") {
      const d = data as { id: string; guild_id?: string };
      if (d.guild_id) run(db.select({ id: discordBridges.id }).from(discordBridges).where(eq(discordBridges.guildId, d.guild_id)).then(async ([b]) => { if (b) await forgetNewChannel(b.id, d.id); }));
    }
    else if (type === "MESSAGE_UPDATE") run(inboundEdit(data as DiscordMessage));
    else if (type === "MESSAGE_DELETE") run(inboundDelete(data as { id: string; channel_id: string }));
    else if (type === "GUILD_DELETE") {
      // The bot was removed from a server (not just Discord having an outage there).
      const d = data as { id: string; unavailable?: boolean };
      if (!d.unavailable) run(db.update(discordBridges).set({ lostAt: new Date() }).where(eq(discordBridges.guildId, d.id)).then(loadPairs));
    } else if (type === "GUILD_CREATE") {
      const d = data as { id: string; name?: string };
      run(db.update(discordBridges).set({ lostAt: null, ...(d.name ? { guildName: d.name.slice(0, 100) } : {}) }).where(eq(discordBridges.guildId, d.id)).then(loadPairs));
    }
  });
  gateway.start();
  console.log("Discord bridge: connecting to Discord.");
}

export function stopDiscordBridge(): void {
  gateway?.stop();
}
