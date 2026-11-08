// Profiles 2.0 (0.9.1, canvas "Glofly profiles"): a header image, pronouns, a board of up to 6
// tiles, mutual friends and constellations, and an activity list. Shared by the server and apps.

import type { PublicUser } from './types'

export const PRONOUNS_MAX = 40
export const PRONOUN_PICKS = ['she/her', 'he/him', 'they/them', 'Ask me'] as const
export const BOARD_TILES_MAX = 6
export const BOARD_NOTE_MAX = 190
export const BOARD_GAMES_MAX = 3
export const BOARD_TAGS_MAX = 8
export const BOARD_TAG_MAX = 24

/** Who can see a part of your profile (same words as My games). */
export type ProfileAudience = 'everyone' | 'friends' | 'only_me'
export type ProfilePrivacy = {
  board: ProfileAudience
  activity: ProfileAudience
  /** Mutual friends and constellations: 'everyone' = anyone who shares them with you */
  mutuals: ProfileAudience
}
export const DEFAULT_PROFILE_PRIVACY: ProfilePrivacy = { board: 'everyone', activity: 'friends', mutuals: 'everyone' }

export type BoardGame = {
  key: string
  name: string
  seconds?: number
  /** Box art's image id (IGDB), shown from GET /games/cover/:id; missing = letter tile */
  cover?: string
}

/** A game from "Find a game" (IGDB). */
export type GameSearchResult = { key: string; name: string; year: number | null; cover: string | null; igdbId?: number }

/** IGDB's credit, shown where game info or box art appears. */
export const IGDB_CREDIT = 'Game info by IGDB'
export const IGDB_URL = 'https://www.igdb.com'
export type BoardTile =
  | { kind: 'games'; games: BoardGame[] }
  | { kind: 'constellation'; constellationId: string }
  | { kind: 'note'; text: string }
  | { kind: 'into'; tags: string[] }
  | { kind: 'playing' }

/** A tile as viewers get it (constellation tiles carry what the card shows). */
export type BoardTileView =
  | { kind: 'games'; games: BoardGame[] }
  | { kind: 'constellation'; constellation: ProfileConstellation }
  | { kind: 'note'; text: string }
  | { kind: 'into'; tags: string[] }
  | { kind: 'playing'; game: string | null; cover?: string }

/** A constellation as a profile shows it (only public ones, or 'approval' = ask to join). */
export type ProfileConstellation = {
  id: string
  name: string
  color: string
  iconVersion: string | null
  accent: string | null
  memberCount: number
  /** You're already in it */
  joined: boolean
  visibility: 'public' | 'approval'
}

export type ProfileHeader = { version: string; focus: number } | null

/** What 0.9.1 adds to a profile (all optional, so older servers still parse). */
export type ProfileExtras = {
  pronouns?: string | null
  header?: ProfileHeader
  /** Null: hidden from you (or empty) */
  board?: BoardTileView[] | null
  counts?: { mutualFriends: number; mutualConstellations: number }
  /** Whether the Activity tab has anything you may see */
  activityShown?: boolean
  /** Whether their My games is shared with you (0.9.2) */
  gamesShown?: boolean
  /** Your own profile only */
  privacy?: ProfilePrivacy
  boardSource?: BoardTile[]
}

export type MutualConstellation = { id: string; name: string; color: string; iconVersion: string | null; accent: string | null; roles: string[] }
export type Mutuals = { friends: PublicUser[]; constellations: MutualConstellation[] }

export type ActivityItem =
  | { kind: 'played'; at: string; game: string; seconds: number; cover?: string }
  | { kind: 'started'; at: string; game: string; cover?: string }
  | { kind: 'joined'; at: string; constellation: { id: string; name: string; color: string; iconVersion: string | null } }

/** Trims and checks pronouns; null = none. */
export function cleanPronouns(raw: string): string | null {
  const s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, PRONOUNS_MAX) : null
}

/** A short line for a tag ("I'm into"). */
export function cleanInterestTag(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, BOARD_TAG_MAX)
}
