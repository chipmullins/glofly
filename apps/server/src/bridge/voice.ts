import { eq, inArray } from "drizzle-orm";
import { cleanDiscordSettings, type DiscordVoicePerson, type DiscordVoicePresence } from "@glofly/shared";
import { db } from "../db";
import { discordBridgeVoice, discordBridges, nebulas, users } from "../db/schema";
import { announceVoice, onVoiceAnnounced, setDiscordVoice, voiceStatesOf } from "../constellations/voice";
import { WEB_ORIGIN } from "../web/session";
import { discordAvatarRef } from "./avatars";
import { DiscordError, discord, type DiscordMember } from "./discordApi";

// Nov 28, 2026: "who's in voice" across the Discord bridge. A Discord voice channel can be paired
// with a voice nebula. No sound crosses over; each side sees who's in the other room:
//
//   Discord → Glofly: the Gateway's voice states (GUILD_CREATE has everyone already in voice,
//     VOICE_STATE_UPDATE every join/leave/move) → VoiceNebulaState.discord on the voice nebula
//     (sidebars on desktop, web and phones), sent with the usual constellation:voice event.
//   Glofly → Discord: one message from the bot in the voice channel's own chat, edited in place
//     ("On Glofly in #hangout: Chip and Riley"), with an "Open Glofly" link. Never a ping.
//
// Everything here is in memory (who's in Discord voice right now) except the pairs and the id of
// the bot's message. After a restart Discord sends GUILD_CREATE again, which fills it back in.

type VoicePair = typeof discordBridgeVoice.$inferSelect & {
  bridge: typeof discordBridges.$inferSelect;
  conversationId: string;
  nebulaName: string;
};

let byChannel = new Map<string, VoicePair>();
let byNebula = new Map<string, VoicePair>();
let loadedAt = 0;

/** guildId → (Discord user id → voice channel id) */
const inVoice = new Map<string, Map<string, string>>();
/** `${guildId}:${userId}` → how they show (null: a bot, never shown) */
const people = new Map<string, { name: string; avatarHash: string | null; uid: string } | null>();

export async function loadVoicePairs(): Promise<void> {
  const rows = await db
    .select({ v: discordBridgeVoice, b: discordBridges, conversationId: nebulas.conversationId, nebulaName: nebulas.name })
    .from(discordBridgeVoice)
    .innerJoin(discordBridges, eq(discordBridges.id, discordBridgeVoice.bridgeId))
    .innerJoin(nebulas, eq(nebulas.id, discordBridgeVoice.nebulaId));
  const a = new Map<string, VoicePair>();
  const b = new Map<string, VoicePair>();
  for (const r of rows) {
    const p: VoicePair = { ...r.v, bridge: r.b, conversationId: r.conversationId, nebulaName: r.nebulaName };
    a.set(p.discordChannelId, p);
    b.set(p.nebulaId, p);
  }
  // Pairs that went away: their nebula stops showing Discord people.
  for (const old of byNebula.keys()) if (!b.has(old)) setDiscordVoice(old, null);
  byChannel = a;
  byNebula = b;
  loadedAt = Date.now();
}
async function fresh(): Promise<void> {
  if (Date.now() - loadedAt > 60_000) await loadVoicePairs();
}

// ───────────── Discord → Glofly ─────────────

async function personFor(guildId: string, userId: string, member?: DiscordMember | null): Promise<{ name: string; avatarHash: string | null; uid: string } | null> {
  const key = `${guildId}:${userId}`;
  // Only a memory of names: start over past 5,000.
  if (people.size >= 5000) people.clear();
  if (member?.user) {
    const p = member.user.bot ? null : { name: member.nick || member.user.global_name || member.user.username || "Someone on Discord", avatarHash: member.user.avatar ?? null, uid: userId };
    people.set(key, p);
    return p;
  }
  if (people.has(key)) return people.get(key)!;
  // GUILD_CREATE's voice states may come without the member: ask Discord once.
  try {
    const m = await discord<DiscordMember>("GET", `/guilds/${guildId}/members/${userId}`);
    return personFor(guildId, userId, m);
  } catch {
    const p = { name: "Someone on Discord", avatarHash: null, uid: userId };
    people.set(key, p);
    return p;
  }
}

const pendingGlofly = new Map<string, ReturnType<typeof setTimeout>>();

/** Tell Glofly who's in a paired Discord voice channel (a moment later, so bursts are one update). */
function refreshGlofly(channelId: string): void {
  if (pendingGlofly.has(channelId)) return;
  pendingGlofly.set(
    channelId,
    setTimeout(() => {
      pendingGlofly.delete(channelId);
      void pushToGlofly(channelId).catch((err) => console.error("Discord voice → Glofly failed:", err));
    }, 1000),
  );
}

export function presenceFor(p: VoicePair, list: DiscordVoicePerson[]): DiscordVoicePresence {
  return { channelName: p.discordChannelName, url: `https://discord.com/channels/${p.bridge.guildId}/${p.discordChannelId}`, people: list };
}

async function pushToGlofly(channelId: string): Promise<void> {
  const p = byChannel.get(channelId);
  if (!p) return;
  const showNames = cleanDiscordSettings(p.bridge.settings).names;
  const list: DiscordVoicePerson[] = [];
  for (const [uid, ch] of inVoice.get(p.bridge.guildId) ?? []) {
    if (ch !== channelId) continue;
    const who = await personFor(p.bridge.guildId, uid);
    if (!who) continue;
    list.push(
      showNames
        ? { name: who.name.replace(/[\r\n]/g, " ").slice(0, 64), avatar: await discordAvatarRef(who.uid, who.avatarHash) }
        : { name: "Someone on Discord", avatar: null },
    );
    if (list.length >= 50) break;
  }
  setDiscordVoice(p.nebulaId, presenceFor(p, list));
  await announceVoice(p.conversationId);
}

type VoiceState = { guild_id?: string; channel_id: string | null; user_id: string; member?: DiscordMember };

/** The Gateway's events that matter here. */
export function onVoiceEvent(type: string, data: unknown): void {
  if (type === "GUILD_CREATE") {
    const d = data as { id: string; voice_states?: VoiceState[] };
    const before = inVoice.get(d.id) ?? new Map<string, string>();
    const now = new Map<string, string>();
    for (const v of d.voice_states ?? []) if (v.channel_id) now.set(v.user_id, v.channel_id);
    inVoice.set(d.id, now);
    for (const ch of new Set([...before.values(), ...now.values()])) if (byChannel.has(ch)) refreshGlofly(ch);
    void fresh()
      .then(() => {
        for (const p of byChannel.values()) if (p.bridge.guildId === d.id) refreshGlofly(p.discordChannelId);
      })
      .catch(() => undefined);
  } else if (type === "GUILD_DELETE") {
    const d = data as { id: string };
    const before = inVoice.get(d.id);
    inVoice.delete(d.id);
    for (const ch of new Set(before?.values() ?? [])) if (byChannel.has(ch)) refreshGlofly(ch);
  } else if (type === "VOICE_STATE_UPDATE") {
    const v = data as VoiceState;
    if (!v.guild_id || !/^\d{5,25}$/.test(v.user_id)) return;
    const guild = inVoice.get(v.guild_id) ?? new Map<string, string>();
    inVoice.set(v.guild_id, guild);
    const was = guild.get(v.user_id);
    if (v.channel_id) guild.set(v.user_id, v.channel_id);
    else guild.delete(v.user_id);
    if (v.member) void personFor(v.guild_id, v.user_id, v.member);
    void fresh()
      .then(() => {
        for (const ch of [was, v.channel_id]) if (ch && byChannel.has(ch)) refreshGlofly(ch);
      })
      .catch(() => undefined);
  }
}

// ───────────── Glofly → Discord ─────────────

const lastText = new Map<string, string>();
const pendingDiscord = new Map<string, ReturnType<typeof setTimeout>>();

/** Names for Discord: no markdown, no line breaks (and no pings: allowed_mentions is empty). */
const plainName = (n: string) => n.replace(/[\r\n]/g, " ").replace(/([*_`~|>\\[\]()#@-])/g, "\\$1").slice(0, 40);

export function statusText(nebulaName: string, names: string[]): string {
  if (!names.length) return `Nobody's in **#${plainName(nebulaName)}** on Glofly right now.`;
  const shown = names.slice(0, 5).map(plainName);
  const more = names.length - shown.length;
  const list =
    more > 0 ? `${shown.join(", ")} and ${more} ${more === 1 ? "other" : "others"}` : shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return `🔊 **On Glofly in #${plainName(nebulaName)}:** ${list}`;
}

const OPEN_URL = (WEB_ORIGIN && /^https?:\/\//.test(WEB_ORIGIN) ? WEB_ORIGIN : "https://chat.glofly.app").replace(/\/+$/, "");
const statusBody = (content: string) => ({
  content,
  allowed_mentions: { parse: [] },
  components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open Glofly", url: OPEN_URL }] }],
});

/** Update the bot's message in a voice channel's chat a moment later (bursts → one edit). */
export function refreshDiscord(nebulaId: string, userIds?: string[]): void {
  const prev = pendingDiscord.get(nebulaId);
  if (prev) clearTimeout(prev);
  pendingDiscord.set(
    nebulaId,
    setTimeout(() => {
      pendingDiscord.delete(nebulaId);
      void pushToDiscord(nebulaId, userIds).catch((err) => console.error("Glofly voice → Discord failed:", err));
    }, 2500),
  );
}

async function gloflyPeople(nebulaId: string): Promise<string[]> {
  const p = byNebula.get(nebulaId);
  if (!p) return [];
  return (await voiceStatesOf(p.bridge.constellationId)).find((v) => v.nebulaId === nebulaId)?.userIds ?? [];
}

async function pushToDiscord(nebulaId: string, known?: string[]): Promise<void> {
  await fresh();
  const p = byNebula.get(nebulaId);
  if (!p || p.bridge.lostAt) return;
  // A voice nebula that became role-only (or optional) isn't shown in Discord any more.
  const [n] = await db.select({ visibility: nebulas.visibility, optional: nebulas.optional, userIds: nebulas.userIds, name: nebulas.name }).from(nebulas).where(eq(nebulas.id, nebulaId));
  const open = !!n && n.visibility === "everyone" && !n.optional && !n.userIds.length;
  const ids = open ? (known ?? (await gloflyPeople(nebulaId))) : [];
  const rows = ids.length ? await db.select({ id: users.id, name: users.displayName, bot: users.bot }).from(users).where(inArray(users.id, ids)) : [];
  const names = ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r && !r.bot).map((r) => r!.name);
  const text = open ? statusText(n.name, names) : `**#${plainName(n?.name ?? p.nebulaName)}** isn't shared with Discord right now.`;
  if (lastText.get(p.id) === text && p.statusMessageId) return;
  if (p.statusMessageId) {
    try {
      await discord("PATCH", `/channels/${p.discordChannelId}/messages/${p.statusMessageId}`, statusBody(text));
      lastText.set(p.id, text);
      return;
    } catch (err) {
      // Deleted in Discord: post a new one below. Anything else: try again next change.
      if (!(err instanceof DiscordError && err.status === 404)) throw err;
    }
  }
  const sent = await discord<{ id: string }>("POST", `/channels/${p.discordChannelId}/messages`, statusBody(text));
  if (sent?.id) {
    await db.update(discordBridgeVoice).set({ statusMessageId: sent.id }).where(eq(discordBridgeVoice.id, p.id));
    p.statusMessageId = sent.id;
    lastText.set(p.id, text);
  }
}

/** A pair is going away: its message in Discord goes too, and the nebula stops showing Discord people. */
export async function forgetVoicePair(row: { id: string; discordChannelId: string; statusMessageId: string | null; nebulaId: string }): Promise<void> {
  if (row.statusMessageId) await discord("DELETE", `/channels/${row.discordChannelId}/messages/${row.statusMessageId}`).catch(() => undefined);
  lastText.delete(row.id);
  setDiscordVoice(row.nebulaId, null);
}

/** A new pair: show the Discord room's people in Glofly and post the status message in Discord. */
export async function startVoicePair(nebulaId: string): Promise<void> {
  await loadVoicePairs();
  const p = byNebula.get(nebulaId);
  if (!p) return;
  await pushToGlofly(p.discordChannelId);
  await pushToDiscord(nebulaId);
}

/** The bridge's settings changed (names on/off): show Discord people again with the new setting. */
export async function voiceSettingsChanged(bridgeId: string): Promise<void> {
  await loadVoicePairs();
  for (const p of byNebula.values()) if (p.bridgeId === bridgeId) refreshGlofly(p.discordChannelId);
}

export function startVoiceBridge(): void {
  onVoiceAnnounced((nebulaId, _constellationId, userIds) => {
    if (byNebula.has(nebulaId) || Date.now() - loadedAt > 60_000) {
      void fresh()
        .then(() => {
          if (byNebula.has(nebulaId)) refreshDiscord(nebulaId, userIds);
        })
        .catch(() => undefined);
    }
  });
  void loadVoicePairs()
    .then(() => {
      // After a restart: each pair's Discord message catches up (nobody may be in voice any more).
      for (const id of byNebula.keys()) refreshDiscord(id);
    })
    .catch((err) => console.error("Couldn't load Discord voice pairs:", err));
}
