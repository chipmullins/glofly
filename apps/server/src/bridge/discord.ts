import { createHash, randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, eq, isNull, or } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import {
  DISCORD_FILE_MAX,
  DISCORD_PAIRS_MAX,
  DEFAULT_DISCORD_SETTINGS,
  MESSAGE_MAX,
  cleanDiscordSettings,
  type BridgedFrom,
  type DiscordBridgeInfo,
  type DiscordBridgeSettings,
} from "@glofly/shared";
import { db } from "../db";
import { redis } from "../redis";
import { storage, sendStream } from "../storage";
import {
  attachments,
  constellationApiKeys,
  constellations,
  discordBridgeChannels,
  discordBridgeMessages,
  discordBridges,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { registerToolHooks } from "../toolHooks";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { constellationChanged } from "../constellations/activity";
import { addMember, ConstellationFull } from "../constellations/members";
import { syncNebulaAccess } from "../constellations/access";
import { createBotUser, logIntegration } from "../integrations/keys";
import { postScheduledText, removeMessageForGood, sendUpdated } from "../messages/routes";
import { processUpload, storeUpload, cleanFileName } from "../messages/attachments";
import { publicBase } from "../connections/live";
import {
  DiscordError,
  discord,
  discordConfigured,
  guildChannels,
  guildFromCode,
  inviteUrl,
  webhookName,
  type DiscordMessage,
} from "./discordApi";
import { DiscordGateway } from "./gateway";

// Communities round 2 (Nov 2026), boards 5a–5b: the Discord ↔ Glofly bridge.
//
//   GET    /constellations/:id/discord                  Settings → Discord bridge (DiscordBridgeInfo)
//   POST   /constellations/:id/discord/connect          → { url } "Add the Glofly Bridge bot" (opens Discord)
//   GET    /bridge/discord/callback?code&state&guild_id   where Discord sends people back (a small page)
//   PUT    /constellations/:id/discord/settings         { edits?, files?, names?, everyone? }
//   POST   /constellations/:id/discord/pairs            { discordChannelId, nebulaId }
//   PATCH  /constellations/:id/discord/pairs/:pid       { paused }
//   DELETE /constellations/:id/discord/pairs/:pid
//   POST   /constellations/:id/discord/note             { where: "discord" | "glofly" }  "Tell members"
//   DELETE /constellations/:id/discord                  turn the bridge off (copies stay)
//   GET    /bridge/avatars/:discordUserId/:hash         a Discord person's picture (Glofly's copy)
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
const CDN = (process.env.DISCORD_CDN_URL?.trim() || "https://cdn.discordapp.com").replace(/\/+$/, "");

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
  let channels: DiscordBridgeInfo["channels"] = [];
  let lost = !!b.lostAt;
  if (discordConfigured && !lost) {
    try {
      const all = await guildChannels(b.guildId);
      const cats = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
      channels = all
        .filter((c) => c.type === 0 || c.type === 5)
        .sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
        .map((c) => ({ id: c.id, name: c.name, parent: c.parent_id ? (cats.get(c.parent_id) ?? null) : null }));
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
    },
    channels,
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
  res.json(await infoFor(s.constellationId));
});

discordRouter.post("/constellations/:id/discord/pairs", changeLimiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const b = await bridgeOf(s, res);
  if (!b) return;
  const body = z.object({ discordChannelId: snowflake, nebulaId: idParam }).safeParse(req.body);
  if (!body.success) {
    bad(res, "Pick a Discord channel and a nebula.");
    return;
  }
  const count = await db.$count(discordBridgeChannels, eq(discordBridgeChannels.bridgeId, b.id));
  if (count >= DISCORD_PAIRS_MAX) {
    bad(res, `Up to ${DISCORD_PAIRS_MAX} channels can be bridged.`, 409);
    return;
  }
  const [n] = await db.select().from(nebulas).where(and(eq(nebulas.id, body.data.nebulaId), eq(nebulas.constellationId, s.constellationId)));
  if (!n || (n.kind !== "text" && n.kind !== "announcement")) {
    bad(res, "Pick a text nebula from this constellation.");
    return;
  }
  if (n.visibility !== "everyone" || n.optional || n.userIds.length) {
    bad(res, "Pick a nebula everyone in the constellation can see (Discord can read it).");
    return;
  }
  // The channel must be in the connected Discord server (checked with Discord, not trusted).
  let channel: { id: string; name: string; type: number; guild_id?: string };
  try {
    channel = await discord("GET", `/channels/${body.data.discordChannelId}`);
  } catch {
    bad(res, "Glofly Bridge can't see that channel. Check its permissions in Discord.");
    return;
  }
  if (channel.guild_id !== b.guildId || (channel.type !== 0 && channel.type !== 5)) {
    bad(res, "Pick a text channel from your connected Discord server.");
    return;
  }
  const [taken] = await db
    .select({ id: discordBridgeChannels.id })
    .from(discordBridgeChannels)
    .where(or(eq(discordBridgeChannels.discordChannelId, channel.id), eq(discordBridgeChannels.nebulaId, n.id)));
  if (taken) {
    bad(res, "That channel or nebula is already bridged.", 409);
    return;
  }
  let hook: { id: string; token: string };
  try {
    hook = await discord("POST", `/channels/${channel.id}/webhooks`, { name: "Glofly Bridge" });
  } catch {
    bad(res, "Glofly Bridge couldn't make a webhook there. Give it “Manage Webhooks” in that channel.");
    return;
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
  await logIntegration({ constellationId: s.constellationId, keyId: b.apiKeyId, keyName: "Discord bridge", actorId: s.userId, action: "discord.paired", details: { channel: channel.name, nebula: n.name } });
  res.status(201).json(await infoFor(s.constellationId));
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
  await discord("DELETE", `/users/@me/guilds/${b.guildId}`).catch(() => undefined);
  // Copies stay (the bot's member stays too: its messages are its own). The API key goes, so the
  // "shared with Discord" notice goes away.
  if (b.apiKeyId) await db.delete(constellationApiKeys).where(eq(constellationApiKeys.id, b.apiKeyId));
  await db.delete(discordBridges).where(eq(discordBridges.id, b.id));
  await logIntegration({ constellationId: s.constellationId, keyId: null, keyName: "Discord bridge", actorId: s.userId, action: "discord.disconnected", details: { server: b.guildName } });
  await loadPairs();
  await constellationChanged(s.constellationId);
  res.json(await infoFor(s.constellationId));
});

// ───────────── Pictures of Discord people ─────────────

const avatarKey = (uid: string, hash: string) => `bridge/avatars/${uid}/${hash}.webp`;
const savedAvatars = new Set<string>();

async function saveAvatar(uid: string, hash: string): Promise<boolean> {
  const key = avatarKey(uid, hash);
  if (savedAvatars.has(key)) return true;
  try {
    const res = await fetch(`${CDN}/avatars/${uid}/${hash}.png?size=128`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!res.ok) return false;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 2 * 1024 * 1024) return false;
    const webp = await sharp(data, { limitInputPixels: 4_000_000 }).resize(128, 128, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    await storage.put(key, webp, "image/webp");
    savedAvatars.add(key);
    return true;
  } catch {
    return false;
  }
}

discordRouter.get("/bridge/avatars/:uid/:hash", async (req, res) => {
  const uid = snowflake.safeParse(req.params.uid);
  const hash = z.string().regex(/^(a_)?[0-9a-f]{32}$/).safeParse(req.params.hash);
  const file = uid.success && hash.success ? await storage.get(avatarKey(uid.data, hash.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  sendStream(file.stream, res);
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
  let avatar: string | null = null;
  if (settings.names && m.author.avatar && /^(a_)?[0-9a-f]{32}$/.test(m.author.avatar) && (await saveAvatar(m.author.id, m.author.avatar))) avatar = `${m.author.id}/${m.author.avatar}`;
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
  const files = settings.files ? await db.select({ name: attachments.name, kind: attachments.kind }).from(attachments).where(eq(attachments.messageId, m.id)) : [];
  const fileLines = files.map((f) => `📎 ${f.kind === "image" ? "a picture" : f.name} (open Glofly to see it)`);
  const content = [m.gif ? `${m.body}` : m.body, ...fileLines].filter(Boolean).join("\n").slice(0, 2000);
  if (!content) return;
  if (change === "edited") {
    if (!settings.edits) return;
    const [row] = await db.select().from(discordBridgeMessages).where(and(eq(discordBridgeMessages.messageId, m.id), eq(discordBridgeMessages.direction, "out")));
    if (row) await discord("PATCH", `/webhooks/${p.webhookId}/${p.webhookToken}/messages/${row.discordMessageId}`, { content, allowed_mentions: { parse: [] } }, "none").catch(() => undefined);
    return;
  }
  const base = publicBase("https://api.glofly.app");
  const sent = await discord<{ id: string }>(
    "POST",
    `/webhooks/${p.webhookId}/${p.webhookToken}?wait=true`,
    {
      content,
      username: webhookName(sender?.name ?? "Glofly member"),
      ...(sender?.avatarVersion ? { avatar_url: `${base}/avatars/${m.senderId}/${sender.avatarVersion}` } : {}),
      // Nobody in Discord is pinged from Glofly.
      allowed_mentions: { parse: [] },
    },
    "none",
  ).catch((err) => {
    if (err instanceof DiscordError && err.status === 404) void markWebhookGone(p);
    return null;
  });
  if (sent?.id) await db.insert(discordBridgeMessages).values({ messageId: m.id, discordMessageId: sent.id, channelId: p.id, direction: "out" }).onConflictDoNothing();
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
  gateway = new DiscordGateway((type, data) => {
    const run = (p: Promise<void>) => void p.catch((err) => console.error(`Discord bridge (${type}) failed:`, err));
    if (type === "MESSAGE_CREATE") run(inbound(data as DiscordMessage));
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
