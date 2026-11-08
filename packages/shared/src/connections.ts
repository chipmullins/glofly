// 0.9.3 Settings → Connections (approved canvas "Glofly: forwarding, formatting, live alerts,
// Steam", boards 6–10): Steam for My games, Twitch and Kick to tell friends when you go live.

export type ConnectionProvider = 'steam' | 'twitch' | 'kick'
export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = ['steam', 'twitch', 'kick']
export type StreamSite = 'twitch' | 'kick'

export const CONNECTION_NAMES: Record<ConnectionProvider, string> = {
  steam: 'Steam',
  twitch: 'Twitch',
  kick: 'Kick'
}

export type ConnectionSettings = {
  /** Steam: add my Steam games and playtime to My games */
  myGames: boolean
  /** Steam: show "Playing …" from Steam (other computers, a Steam Deck) */
  playing: boolean
  /** Steam: a link to my Steam profile on my profile (follows My games' privacy) */
  showLink: boolean
  /** Twitch / Kick: tell friends when I go live */
  tellFriends: 'all' | 'chosen' | 'off'
  /** Twitch / Kick: the friends told when tellFriends is "chosen" */
  chosen: string[]
  /** Twitch / Kick: LIVE on my profile and in friends lists while I'm live */
  showLive: boolean
  /** Twitch / Kick: also post in my constellations (only where the owner allows members' streams) */
  postInConstellations: boolean
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  myGames: true,
  playing: true,
  showLink: false,
  tellFriends: 'all',
  chosen: [],
  showLive: true,
  postInConstellations: false
}

export const CHOSEN_FRIENDS_MAX = 200

/** Settings as stored (anything odd falls back to the default). */
export function connectionSettingsOf(raw: unknown): ConnectionSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ConnectionSettings, unknown>>
  const bool = (k: 'myGames' | 'playing' | 'showLink' | 'showLive' | 'postInConstellations') =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_CONNECTION_SETTINGS[k]
  return {
    myGames: bool('myGames'),
    playing: bool('playing'),
    showLink: bool('showLink'),
    tellFriends: r.tellFriends === 'chosen' || r.tellFriends === 'off' ? r.tellFriends : 'all',
    chosen: Array.isArray(r.chosen)
      ? (r.chosen as unknown[]).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, CHOSEN_FRIENDS_MAX)
      : [],
    showLive: bool('showLive'),
    postInConstellations: bool('postInConstellations')
  }
}

/** Someone live on Twitch or Kick right now. */
export type StreamLive = {
  title: string
  game: string | null
  startedAt: string
  /** Their channel on the site (always twitch.tv or kick.com) */
  url: string
  viewers?: number | null
}

export type LinkedAccount = {
  provider: ConnectionProvider
  /** Their name there (login) */
  login: string
  displayName: string
  /** Their page there (steamcommunity.com, twitch.tv, kick.com) */
  profileUrl: string | null
  linkedAt: string
  settings: ConnectionSettings
  live: StreamLive | null
  /** Steam: when games were last synced and how many there are */
  syncedAt?: string | null
  gameCount?: number | null
}

export type ConnectionsView = {
  /** Which sites this server has set up (the others show "not set up on this server yet") */
  available: Record<ConnectionProvider, boolean>
  accounts: LinkedAccount[]
}

/** A friend live on Twitch or Kick (the LIVE badge, the alert's Watch together and Open buttons). */
export type FriendStream = {
  userId: string
  source: StreamSite
  title: string
  game: string | null
  url: string
  startedAt: string
}

/** A channel's page: only ever twitch.tv / kick.com with a plain channel name. */
export function streamUrl(site: StreamSite, login: string): string | null {
  if (!(site === 'twitch' ? /^[A-Za-z0-9_]{2,25}$/ : /^[A-Za-z0-9_-]{2,40}$/).test(login)) return null
  return site === 'twitch' ? `https://www.twitch.tv/${login.toLowerCase()}` : `https://kick.com/${login.toLowerCase()}`
}

/** "Twitch" / "Kick" in sentences. */
export const siteName = (site: StreamSite): string => (site === 'twitch' ? 'Twitch' : 'Kick')

// ───────────── Constellation Live alerts (0.9.3, approved boards 4–5) ─────────────

export type AlertSite = 'twitch' | 'kick' | 'youtube'
export const ALERT_SITES: readonly AlertSite[] = ['twitch', 'kick', 'youtube']
export const alertSiteName = (site: AlertSite): string => (site === 'youtube' ? 'YouTube' : siteName(site))
/** At most this many channels per constellation. */
export const LIVE_ALERTS_MAX = 10
export const LIVE_ALERT_MESSAGE_MAX = 300
export const DEFAULT_LIVE_MESSAGE = '{streamer} is live: {title}'
export const DEFAULT_VIDEO_MESSAGE = '{streamer} posted: {title}'

/** One channel a constellation follows. */
export type LiveAlert = {
  id: string
  site: AlertSite
  /** The channel's name as shown ("kroof_", "Night Raiders TV") */
  channelName: string
  /** Its page */
  channelUrl: string
  nebulaId: string
  /** A role to @mention, "everyone" / "here", or null (no ping) */
  ping: string | null
  message: string
  /** Twitch/Kick: the voice nebula offered for "Watch together" (null = not offered) */
  watchNebulaId: string | null
  lastAlertAt: string | null
  createdAt: string
}

/** What a live alert message carries (older apps show its body + link preview). */
export type LiveCard = {
  site: AlertSite
  /** 'live' = went live (Twitch, Kick); 'video' = a new video or premiere (YouTube) */
  kind: 'live' | 'video'
  channelName: string
  title: string
  game: string | null
  viewers: number | null
  url: string
  /** Offer "Watch together in <voice nebula>" */
  watchNebulaId: string | null
}

/**
 * The channel someone pasted ("twitch.tv/mayaplays", "kick.com/maya", "@NightRaidersTV",
 * "youtube.com/channel/UC…"), or null. YouTube: `handle` needs the server to look it up.
 */
export function parseChannel(site: AlertSite, raw: string): { login: string } | { youtubeId: string } | { handle: string } | null {
  const s = raw.trim().replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)/i, '')
  if (site === 'twitch') {
    const m = /^(?:twitch\.tv\/)?([A-Za-z0-9_]{2,25})(?:[/?#].*)?$/i.exec(s)
    return m ? { login: m[1].toLowerCase() } : null
  }
  if (site === 'kick') {
    const m = /^(?:kick\.com\/)?([A-Za-z0-9_-]{2,40})(?:[/?#].*)?$/i.exec(s)
    return m ? { login: m[1].toLowerCase() } : null
  }
  const id = /(?:^|youtube\.com\/channel\/)(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(s)
  if (id) return { youtubeId: id[1] }
  const handle = /^(?:youtube\.com\/)?@([A-Za-z0-9._-]{3,30})(?:[/?#]|$)/.exec(s)
  return handle ? { handle: handle[1] } : null
}

/** The alert's text ({streamer}, {title}, {game}), with its link last so every app can open it. */
export function liveAlertText(template: string, card: Pick<LiveCard, 'channelName' | 'title' | 'game' | 'url'>, ping: string | null): string {
  const text = (template.trim() || DEFAULT_LIVE_MESSAGE)
    .replace(/\{streamer\}/g, card.channelName)
    .replace(/\{title\}/g, card.title || 'untitled')
    .replace(/\{game\}/g, card.game ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${ping ? `${ping} ` : ''}${text}\n${card.url}`.slice(0, 1000)
}
