import { cleanNebulaName } from './constellations'

// Communities round 2 (Nov 2026), item 5: the Discord ↔ Glofly bridge (approved boards 5a–5b).
// One official "Glofly Bridge" bot (Glofly's own Discord application; its token stays on the
// server). A constellation connects one Discord server and pairs up to DISCORD_PAIRS_MAX channels
// with nebulas; messages go both ways. Discord people show in Glofly with their Discord name and
// picture and a "via Discord" tag; Glofly people post in Discord through a channel webhook under
// their Glofly name. Members on both sides see that the nebula is shared (Nebula.sharedWith).

export const DISCORD_PAIRS_MAX = 10
/** Nov 28: voice channel ↔ voice nebula pairs (who's in voice, both sides; no sound crosses) */
export const DISCORD_VOICE_PAIRS_MAX = 10
/** Files from Discord copied into Glofly at most this big (bigger ones become a line of text). */
export const DISCORD_FILE_MAX = 25 * 1024 * 1024

export type DiscordBridgeSettings = {
  /** Edits and deletes follow along both ways */
  edits: boolean
  /** Pictures and files (Discord → Glofly copies them; Glofly → Discord says there's a file) */
  files: boolean
  /** Discord nicknames + avatars in Glofly (off: "Someone on Discord") */
  names: boolean
  /** @everyone / @here from Discord ping in Glofly (off by default) */
  everyone: boolean
  /**
   * 0.12.0: a Discord channel made later gets a nebula of its own and is bridged by itself (on by
   * default). Channels hidden from @everyone in Discord are never bridged this way.
   */
  autoBridge: boolean
}
export const DEFAULT_DISCORD_SETTINGS: DiscordBridgeSettings = { edits: true, files: true, names: true, everyone: false, autoBridge: true }

export function cleanDiscordSettings(raw: unknown, base: DiscordBridgeSettings = DEFAULT_DISCORD_SETTINGS): DiscordBridgeSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const b = (k: keyof DiscordBridgeSettings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : base[k])
  return { edits: b('edits'), files: b('files'), names: b('names'), everyone: b('everyone'), autoBridge: b('autoBridge') }
}

export type DiscordPair = {
  id: string
  discordChannelId: string
  discordChannelName: string
  nebulaId: string
  paused: boolean
  createdAt: string
}

/** Nov 28: a Discord voice channel paired with a Glofly voice nebula (presence only). */
export type DiscordVoicePair = {
  id: string
  discordChannelId: string
  discordChannelName: string
  nebulaId: string
  createdAt: string
}

/** Someone in a paired Discord voice channel, as Glofly shows them. */
export type DiscordVoicePerson = {
  /** Their name in that server, or "Someone on Discord" when the bridge hides names */
  name: string
  /** `<discordUserId>/<hash>` for GET /bridge/avatars/…, or null */
  avatar: string | null
}

/** On a voice nebula (VoiceNebulaState.discord): who's in its paired Discord voice channel. */
export type DiscordVoicePresence = {
  channelName: string
  /** Opens the channel in Discord (https://discord.com/channels/<server>/<channel>) */
  url: string
  people: DiscordVoicePerson[]
}

/** Settings → Discord bridge (GET /constellations/:id/discord). */
export type DiscordBridgeInfo = {
  /** The server has the bot set up (DISCORD_* settings). False: the page explains it isn't available yet. */
  available: boolean
  bridge: {
    id: string
    guildId: string
    guildName: string
    guildIconUrl: string | null
    connectedAt: string
    connectedBy: { id: string; displayName: string } | null
    settings: DiscordBridgeSettings
    pairs: DiscordPair[]
    /** The bot can't reach the server any more (removed in Discord) */
    lost: boolean
    /** Nov 28 (servers from then on): voice pairs */
    voicePairs?: DiscordVoicePair[]
    /** 0.12.0: channels made in Discord later that auto-bridge couldn't match to a nebula */
    newChannels?: DiscordNewChannel[]
  } | null
  /** Text channels of the connected Discord server the bot can see (for "Bridge another channel") */
  channels: { id: string; name: string; parent: string | null }[]
  /** Nov 28: the server's voice channels (for voice pairs) */
  voiceChannels?: { id: string; name: string; parent: string | null }[]
}

/**
 * 0.12.0: a channel made in the Discord server after the bridge was set up, that auto-bridge couldn't
 * match to a nebula. People who can manage the bridge are asked what to do (desktop/web pop-up):
 * GET /constellations/:id/discord/new-channels, POST …/new-channels/:channelId/dismiss. Live event
 * "discord:newChannel" { constellationId, channel } to them (newer apps).
 */
export type DiscordNewChannel = {
  id: string
  name: string
  voice: boolean
  /** Its Discord category's name, if any */
  parent: string | null
  at: string
}

/** Nov 28: POST /constellations/:id/discord/pairs also takes { discordChannelId, newNebula: true }:
 * makes a nebula named after the Discord channel (text for text channels, voice for voice ones) in
 * the category with the same name as the Discord one, or the first category. */

/** The name a new nebula gets from a Discord channel (the server cleans it the same way). */
export function newNebulaName(channelName: string, kind: 'text' | 'voice'): string {
  return cleanNebulaName(channelName, kind) ?? (kind === 'voice' ? 'Voice' : 'discord')
}

/** A name reduced for matching ("🎮│General Chat" → "generalchat"). */
export function matchKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * The nebula a Discord channel most likely goes with: the same name (ignoring case, emoji, dashes
 * and spaces), else one whose name starts with the channel's or the other way round ("lfg" doesn't
 * match "looking-for-group", but "events" matches "event"). Null when nothing is close. The setup
 * screen pre-picks these as "Matched"; people can change every one.
 */
export function suggestNebula<T extends { id: string; name: string }>(channelName: string, nebulas: T[], taken: ReadonlySet<string> = new Set()): T | null {
  const k = matchKey(channelName)
  if (!k) return null
  const free = nebulas.filter((n) => !taken.has(n.id))
  const exact = free.find((n) => matchKey(n.name) === k)
  if (exact) return exact
  if (k.length < 4) return null
  return free.find((n) => {
    const nk = matchKey(n.name)
    return nk.length >= 4 && (nk.startsWith(k) || k.startsWith(nk)) && Math.abs(nk.length - k.length) <= 2
  }) ?? null
}

/** On a message copied from Discord (messages.bridged). Older apps see "name: text" (the body). */
export type BridgedFrom = {
  source: 'discord'
  /** Their Discord name (nickname in that server), or "Someone on Discord" */
  name: string
  /** `<discordUserId>/<hash>`: GET /bridge/avatars/<avatar> (a copy Glofly keeps), or null */
  avatar: string | null
  /** The body starts with "name: " for older apps; new apps skip this many characters */
  skip: number
}

/** The text new apps show for a bridged message (without the "name: " older apps see). */
export const bridgedText = (body: string, b: BridgedFrom | null | undefined): string =>
  b && b.skip > 0 && b.skip <= body.length ? body.slice(b.skip) : body

/** Discord's "View Channel" permission bit. */
const VIEW_CHANNEL = 1n << 10n

/**
 * 0.12.0: is this Discord channel hidden from @everyone (a private channel)? The @everyone role's
 * id is the server's id. Auto-bridge skips these: a bridged nebula is readable by the whole
 * constellation.
 */
export function hiddenFromEveryone(
  channel: { permission_overwrites?: { id: string; type: number | string; deny: string }[] },
  guildId: string
): boolean {
  return (channel.permission_overwrites ?? []).some((o) => {
    if (o.id !== guildId || Number(o.type) !== 0) return false
    try {
      return (BigInt(o.deny) & VIEW_CHANNEL) !== 0n
    } catch {
      return false
    }
  })
}
