// Communities round 2 (Nov 2026), item 5: the Discord ↔ Glofly bridge (approved boards 5a–5b).
// One official "Glofly Bridge" bot (Glofly's own Discord application; its token stays on the
// server). A constellation connects one Discord server and pairs up to DISCORD_PAIRS_MAX channels
// with nebulas; messages go both ways. Discord people show in Glofly with their Discord name and
// picture and a "via Discord" tag; Glofly people post in Discord through a channel webhook under
// their Glofly name. Members on both sides see that the nebula is shared (Nebula.sharedWith).

export const DISCORD_PAIRS_MAX = 10
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
}
export const DEFAULT_DISCORD_SETTINGS: DiscordBridgeSettings = { edits: true, files: true, names: true, everyone: false }

export function cleanDiscordSettings(raw: unknown, base: DiscordBridgeSettings = DEFAULT_DISCORD_SETTINGS): DiscordBridgeSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const b = (k: keyof DiscordBridgeSettings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : base[k])
  return { edits: b('edits'), files: b('files'), names: b('names'), everyone: b('everyone') }
}

export type DiscordPair = {
  id: string
  discordChannelId: string
  discordChannelName: string
  nebulaId: string
  paused: boolean
  createdAt: string
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
  } | null
  /** Text channels of the connected Discord server the bot can see (for "Bridge another channel") */
  channels: { id: string; name: string; parent: string | null }[]
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
