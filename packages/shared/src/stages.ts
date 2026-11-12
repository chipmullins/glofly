// Communities round 2 (Nov 2026), item 3: stage nebulas and announcement nebulas.
// Approved canvas "Glofly communities round 2", boards 3a–3c.
//
// A stage is a nebula kind for town halls, Q&As and events. Speakers talk (and can share a screen);
// listeners only receive: their LiveKit pass can't send anything (like the voice preview pass), so a
// stage holds far more people than a voice nebula. "Manage stages" starts, runs and ends them.
//
// An announcement nebula is a nebula kind for news: only staff post, and other constellations can
// follow it. Each new post is copied into the follower's nebula (edits and deletes follow along;
// @mentions never ping in a copy). Anyone may follow a public constellation's announcements; a
// private constellation's only its members.
//
// Older apps are sent a stage as a read-only text nebula saying to update, and an announcement
// nebula as a read-only text nebula (which is what announcements used to be).

/** Speakers on one stage at most (the stage's own limit is 1 to this; 25 by default). */
export const STAGE_SPEAKERS_MAX = 50
export const STAGE_SPEAKERS_DEFAULT = 25
export const STAGE_SPEAKER_CHOICES = [5, 10, 25, 50] as const
/** Listeners on one stage at most (LiveKit room size, minus speakers). */
export const STAGE_LISTENERS_MAX = 1000
/** Apps say "still here" this often while on a stage; the server forgets someone after STAGE_GONE_MS. */
export const STAGE_PING_MS = 30_000
export const STAGE_GONE_MS = 75_000
/** A stage with no speakers for this long ends by itself. */
export const STAGE_EMPTY_END_MS = 5 * 60_000
export const STAGE_TOPIC_MAX = 80
/** Raised hands shown to managers at most (oldest first). */
export const STAGE_HANDS_SHOWN = 100
/** Listener faces sent with a stage (the rest is a count). */
export const STAGE_LISTENERS_SHOWN = 24

export type StageSpeaker = {
  userId: string
  /** The person who started it */
  host: boolean
  /** Asked up by a manager (not a manager themselves) */
  invited: boolean
}

/** A live stage (nothing is sent while a stage nebula is quiet). */
export type StageState = {
  nebulaId: string
  /** The stage's own id (its LiveKit room is `stage-<id>`) */
  id: string
  topic: string
  startedBy: string
  startedAt: string
  handsOn: boolean
  /** Listeners can chat in the stage nebula while it's live */
  listenerChat: boolean
  speakerLimit: number
  /** On stage now (in the order they came up) */
  speakers: StageSpeaker[]
  listenerCount: number
  /** Some listeners' ids, for the faces row */
  listeners: string[]
  /** Raised hands, oldest first: only sent to people who can manage stages (otherwise just a count) */
  hands?: { userId: string; at: string }[]
  handCount: number
}

/** What a stage looks like for me. */
export type MyStage = {
  /** "speaker" (on stage), "invited" (asked up, not up yet), "listener", or null (not on it) */
  role: 'speaker' | 'invited' | 'listener' | null
  handUp: boolean
  /** I can start, run and end it */
  manage: boolean
}

/** POST …/stage/join answers this: a pass for the stage's room. */
export type StagePass = {
  url: string
  token: string
  room: string
  role: 'speaker' | 'listener'
  stage: StageState
  me: MyStage
}

/** Live event `stage:updated` (modern-only): a stage in a constellation changed, started (stage set) or ended (stage null). */
export type StageEvent = { constellationId: string; nebulaId: string; stage: StageState | null }
/** Live event `stage:invited`: a manager asked me up (or took the invitation back: invited false). */
export type StageInviteEvent = { constellationId: string; nebulaId: string; byName: string; invited: boolean }
/** Live event `stage:moved`: I was moved to the audience (my app switches to a listener pass). */
export type StageMovedEvent = { constellationId: string; nebulaId: string }

export const cleanStageTopic = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, STAGE_TOPIC_MAX)
  return t || null
}

/** "4 speaking · 312 listening" */
export function stageLine(s: Pick<StageState, 'speakers' | 'listenerCount'>): string {
  const n = s.listenerCount
  return `${s.speakers.length} speaking · ${n.toLocaleString('en-US')} listening`
}

// ───────────── Announcement nebulas ─────────────

/** Follows one announcement nebula may have at most, and follows one constellation may make. */
export const FOLLOWERS_MAX = 500
export const FOLLOWS_PER_CONSTELLATION_MAX = 30

/** A copy of an announcement in a follower's nebula (messages.crosspost). */
export type Crosspost = {
  /** The source constellation and nebula */
  constellationId: string
  constellationName: string
  iconVersion: string | null
  color: string | null
  nebulaName: string
  /** Who posted it there (their name when it was copied) */
  authorName: string
  /** The original message (to keep edits and deletes in step) */
  sourceMessageId: string
  /** The source constellation's public invite page code, if it has one ("Open Night Raiders") */
  inviteCode: string | null
}

/** One follow, as the source's managers see it (which constellation follows, not who clicked). */
export type AnnouncementFollower = {
  followId: string
  constellationId: string
  name: string
  iconVersion: string | null
  color: string | null
  nebulaName: string
  since: string
}

/** One follow, as the follower's managers see it (Settings → Nebulas → the target nebula). */
export type AnnouncementFollow = {
  followId: string
  sourceConstellationId: string
  sourceName: string
  sourceNebulaId: string
  sourceNebulaName: string
  targetNebulaId: string
  since: string
}

/** Where I could send a followed nebula's posts: my constellations' text nebulas I can manage. */
export type FollowTarget = {
  constellationId: string
  name: string
  iconVersion: string | null
  color: string | null
  nebulas: { id: string; name: string; following: boolean }[]
}
