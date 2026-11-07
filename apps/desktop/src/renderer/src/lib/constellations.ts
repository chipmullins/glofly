import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForumSettings, ForumTag } from '@glofly/shared/threads'
import type {
  ApiResult,
  ConstellationBan,
  ConstellationCard,
  ConstellationDetail,
  ConstellationInvite,
  ConstellationLink,
  ConstellationMethod,
  ConstellationPermission,
  ConstellationRole,
  ConstellationTemplate,
  ConstellationType,
  ConstellationVisibility,
  DirectoryEntry,
  JoinRequest,
  LinkLifetime,
  ModerationEntry,
  MyGame,
  MuteDuration,
  MyGamesVisibility,
  NebulaKind,
  NotifyLevel,
  OnboardingQuestion,
  RoleColor,
  TimeoutLength,
  VoicePreviewPass
} from '../../../preload/api-types'
import type {
  ConstellationAccent,
  InvitePreview,
  MemberCardInfo,
  NebulaMention,
  NebulaVisibility,
  PinnedNebula,
  WelcomeSettings
} from '@glofly/shared/constellations'

// Glofly 2.0: Constellations and My games, as the screens call them. Every request goes through
// window.glofly.constellations.request (the main process / web bridge only lets /constellations/…
// and /games/… through).

const call = <T>(
  method: ConstellationMethod,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

type Detail = { constellation: ConstellationDetail }
const base = (id: string): string => `/constellations/${id}`

export const api = {
  dashboard: () =>
    call<{ constellations: ConstellationCard[]; invites: ConstellationInvite[] }>(
      'GET',
      '/constellations'
    ),
  order: (ids: string[]) => call<null>('PUT', '/constellations/order', { ids }),
  create: (values: {
    name: string
    template: ConstellationTemplate
    visibility: ConstellationVisibility
    type: ConstellationType | null
    tags: string[]
    description?: string | null
  }) => call<Detail>('POST', '/constellations', values),
  /** The dashboard's "Adventure to new constellations": top tags and up to 3 to try */
  // The nebula dock on Glofly home (2.0)
  pins: () => call<{ pins: PinnedNebula[] }>('GET', '/constellations/pins'),
  pin: (id: string, nebulaId: string) =>
    call<{ pins: PinnedNebula[] }>('PUT', `${base(id)}/nebulas/${nebulaId}/pin`),
  unpin: (id: string, nebulaId: string) =>
    call<{ pins: PinnedNebula[] }>('DELETE', `${base(id)}/nebulas/${nebulaId}/pin`),
  mentions: (before?: string) =>
    call<{ mentions: NebulaMention[]; unread: number; more: boolean }>(
      'GET',
      `/constellations/mentions${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  readMentions: () => call<null>('POST', '/constellations/mentions/read'),
  discover: () =>
    call<{ tags: string[]; suggestions: DirectoryEntry[] }>('GET', '/constellations/discover'),
  directory: (q: string, type: ConstellationType | null, tag: string | null, offset = 0) => {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (type) params.set('type', type)
    if (tag) params.set('tag', tag)
    if (offset) params.set('offset', String(offset))
    const qs = params.toString()
    return call<{ results: DirectoryEntry[]; hasMore: boolean }>(
      'GET',
      `/constellations/directory${qs ? `?${qs}` : ''}`
    )
  },
  linkPreview: (code: string) => call<InvitePreview>('GET', `/constellations/links/${code}`),
  joinLink: (code: string) => call<Detail>('POST', `/constellations/links/${code}/join`),
  dismissInvite: (inviteId: string) =>
    call<null>('POST', `/constellations/invites/${inviteId}/dismiss`),
  get: (id: string) => call<Detail>('GET', base(id)),
  update: (
    id: string,
    changes: Partial<{
      name: string
      description: string | null
      color: string
      visibility: ConstellationVisibility
      type: ConstellationType | null
      tags: string[]
      // 0.7.5
      accent: ConstellationAccent | null
      rules: string[]
      welcome: Partial<WelcomeSettings>
    }>
  ) => call<Detail>('PATCH', base(id), changes),
  // 0.7.5 community and identity
  setBanner: (
    id: string,
    data: ArrayBuffer,
    type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  ) => window.glofly.constellations.setIcon(id, data, type, 'banner'),
  removeBanner: (id: string) => call<{ bannerVersion: null }>('DELETE', `${base(id)}/banner`),
  welcomeDone: (id: string, agreed: boolean, roleIds: string[]) =>
    call<Detail>('POST', `${base(id)}/welcome`, { agreed, roleIds }),
  myRoles: (id: string, roleIds: string[]) =>
    call<Detail>('PUT', `${base(id)}/me/roles`, { roleIds }),
  /** 4.3 onboarding (boards 25–27) */
  saveOnboarding: (id: string, body: { enabled: boolean; questions: OnboardingQuestion[]; optionalNebulaIds: string[] }) =>
    call<Detail>('PUT', `${base(id)}/onboarding`, body),
  answerOnboarding: (id: string, answers: Record<string, string[]>, done: boolean) =>
    call<Detail>('POST', `${base(id)}/onboarding/answers`, { answers, done }),
  showNebula: (id: string, nebulaId: string, shown: boolean) =>
    call<Detail>('PUT', `${base(id)}/me/nebulas/${nebulaId}`, { shown }),
  memberCard: (id: string, userId: string) =>
    call<MemberCardInfo>('GET', `${base(id)}/members/${userId}/card`),
  setIcon: (
    id: string,
    data: ArrayBuffer,
    type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  ) => window.glofly.constellations.setIcon(id, data, type),
  removeIcon: (id: string) => call<{ iconVersion: null }>('DELETE', `${base(id)}/icon`),
  remove: (id: string, name: string) => call<null>('DELETE', base(id), { name }),
  transfer: (id: string, userId: string) =>
    call<Detail>('POST', `${base(id)}/transfer`, { userId }),
  join: (id: string, note?: string) =>
    call<Detail | { requested: true; constellation: DirectoryEntry }>(
      'POST',
      `${base(id)}/join`,
      note ? { note } : {}
    ),
  cancelRequest: (id: string) => call<null>('DELETE', `${base(id)}/request`),
  leave: (id: string) => call<null>('POST', `${base(id)}/leave`),
  readAll: (id: string) => call<null>('POST', `${base(id)}/read`),
  notify: (id: string, level: NotifyLevel) => call<null>('PUT', `${base(id)}/notify`, { level }),
  /** 4.2 (board 23): the rest of the notification window (mute: null unmutes) */
  notifySettings: (
    id: string,
    body: {
      level?: NotifyLevel
      mute?: MuteDuration | null
      ignoreEveryone?: boolean
      ignoreRoles?: boolean
      followAlerts?: boolean
    }
  ) => call<null>('PUT', `${base(id)}/notify`, body),
  nebulaNotify: (id: string, nebulaId: string, level: NotifyLevel | null) =>
    call<null>('PUT', `${base(id)}/nebulas/${nebulaId}/notify`, { level }),
  addCategory: (id: string, name: string) =>
    call<Detail>('POST', `${base(id)}/categories`, { name }),
  renameCategory: (id: string, categoryId: string, name: string) =>
    call<Detail>('PATCH', `${base(id)}/categories/${categoryId}`, { name }),
  /** 0.8.0: who can see a category (and everything inside it) */
  categoryVisibility: (
    id: string,
    categoryId: string,
    visibility: NebulaVisibility,
    roleIds: string[]
  ) => call<Detail>('PATCH', `${base(id)}/categories/${categoryId}`, { visibility, roleIds }),
  removeCategory: (id: string, categoryId: string) =>
    call<Detail>('DELETE', `${base(id)}/categories/${categoryId}`),
  layout: (
    id: string,
    categories: string[],
    nebulas: { id: string; categoryId: string | null }[]
  ) => call<Detail>('PUT', `${base(id)}/layout`, { categories, nebulas }),
  addNebula: (
    id: string,
    values: {
      name: string
      kind: NebulaKind
      categoryId: string | null
      topic?: string | null
      readOnly?: boolean
      visibility?: NebulaVisibility
      roleIds?: string[]
      forum?: Partial<Omit<ForumSettings, 'tags'>> & { tags?: (Omit<ForumTag, 'id'> & { id?: string })[] }
    }
  ) => call<Detail & { nebulaId: string }>('POST', `${base(id)}/nebulas`, values),
  updateNebula: (
    id: string,
    nebulaId: string,
    changes: Partial<{
      name: string
      topic: string | null
      readOnly: boolean
      categoryId: string | null
      visibility: NebulaVisibility
      roleIds: string[]
      // Communities round: threads + forums
      threadsStaffOnly: boolean
      threadCloseDays: number
      forum: Partial<Omit<ForumSettings, 'tags'>> & { tags?: (Omit<ForumTag, 'id'> & { id?: string })[] }
    }>
  ) => call<Detail>('PATCH', `${base(id)}/nebulas/${nebulaId}`, changes),
  removeNebula: (id: string, nebulaId: string) =>
    call<Detail>('DELETE', `${base(id)}/nebulas/${nebulaId}`),
  voiceMute: (id: string, nebulaId: string, userId: string, muted: boolean) =>
    call<null>('POST', `${base(id)}/nebulas/${nebulaId}/voice/mute`, { userId, muted }),
  voiceDisconnect: (id: string, nebulaId: string, userId: string) =>
    call<null>('POST', `${base(id)}/nebulas/${nebulaId}/voice/disconnect`, { userId }),
  /** 0.7.5: a watch-only pass to peek at a screen share before joining */
  voicePreview: (id: string, nebulaId: string) =>
    call<VoicePreviewPass>('POST', `${base(id)}/nebulas/${nebulaId}/voice/preview`),
  addRole: (
    id: string,
    values: {
      name: string
      color: RoleColor
      permissions: ConstellationPermission[]
      selfAssign?: boolean
    }
  ) => call<Detail>('POST', `${base(id)}/roles`, values),
  updateRole: (
    id: string,
    roleId: string,
    changes: Partial<{
      name: string
      color: RoleColor
      permissions: ConstellationPermission[]
      selfAssign: boolean
      /** 4.2: anyone can @mention this role */
      mentionable: boolean
    }>
  ) => call<Detail>('PATCH', `${base(id)}/roles/${roleId}`, changes),
  removeRole: (id: string, roleId: string) => call<Detail>('DELETE', `${base(id)}/roles/${roleId}`),
  orderRoles: (id: string, ids: string[]) =>
    call<Detail>('PUT', `${base(id)}/roles/order`, { ids }),
  setMemberRoles: (id: string, userId: string, roleIds: string[]) =>
    call<Detail>('PUT', `${base(id)}/members/${userId}/roles`, { roleIds }),
  timeout: (id: string, userId: string, length: TimeoutLength, reason?: string) =>
    call<Detail>('POST', `${base(id)}/members/${userId}/timeout`, { length, reason }),
  endTimeout: (id: string, userId: string) =>
    call<Detail>('DELETE', `${base(id)}/members/${userId}/timeout`),
  kick: (id: string, userId: string, reason?: string) =>
    call<Detail>('POST', `${base(id)}/members/${userId}/kick`, { reason }),
  ban: (id: string, userId: string, reason?: string) =>
    call<Detail>('POST', `${base(id)}/members/${userId}/ban`, { reason }),
  bans: (id: string) => call<{ bans: ConstellationBan[] }>('GET', `${base(id)}/bans`),
  unban: (id: string, userId: string) => call<null>('DELETE', `${base(id)}/bans/${userId}`),
  requests: (id: string) => call<{ requests: JoinRequest[] }>('GET', `${base(id)}/requests`),
  decide: (id: string, userId: string, approve: boolean) =>
    call<Detail>('POST', `${base(id)}/requests/${userId}/${approve ? 'approve' : 'deny'}`),
  invite: (id: string, userIds: string[]) =>
    call<{ invited: number }>('POST', `${base(id)}/invites`, { userIds }),
  links: (id: string) => call<{ links: ConstellationLink[] }>('GET', `${base(id)}/links`),
  addLink: (id: string, lifetime: LinkLifetime, maxUses: number | null) =>
    call<{ link: ConstellationLink }>('POST', `${base(id)}/links`, { lifetime, maxUses }),
  revokeLink: (id: string, linkId: string) => call<null>('DELETE', `${base(id)}/links/${linkId}`),
  moderation: (id: string, before?: string) =>
    call<{ entries: ModerationEntry[]; hasMore: boolean }>(
      'GET',
      `${base(id)}/moderation${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  // My games
  myGames: () => call<{ visibility: MyGamesVisibility; games: MyGame[] }>('GET', '/games/me'),
  setGamesVisibility: (visibility: MyGamesVisibility) =>
    call<{ visibility: MyGamesVisibility }>('PUT', '/games/me/settings', { visibility }),
  setGame: (key: string, changes: { favorite?: boolean; hidden?: boolean }) =>
    call<{ games: MyGame[] }>('PUT', `/games/me/${encodeKey(key)}`, changes),
  removeGame: (key: string) => call<{ games: MyGame[] }>('DELETE', `/games/me/${encodeKey(key)}`),
  gamesOf: (userId: string) =>
    call<{ visibility: MyGamesVisibility; shared: boolean; games: MyGame[] }>(
      'GET',
      `/games/user/${userId}`
    )
}

/**
 * A game's key in a path: the gateway only lets plain characters through, so the key (the game's
 * lower-case name) goes as hex.
 */
function encodeKey(key: string): string {
  return [...new TextEncoder().encode(key)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The highest role someone has in a constellation (Owner first, Member last). Roles people pick
 * themselves (0.7.5) are labels: they never count here.
 */
export function topRole(c: ConstellationDetail, userId: string): ConstellationRole {
  if (c.ownerId === userId) return c.roles[0]
  const held = c.members.find((m) => m.user.id === userId)?.roleIds ?? []
  const roles = c.roles.filter((r) => r.kind === 'member' || (held.includes(r.id) && !r.selfAssign))
  return roles.sort((a, b) => b.position - a.position)[0] ?? c.roles[c.roles.length - 1]
}

/** Their rank (position of their highest role). */
export function rankOf(c: ConstellationDetail, userId: string): number {
  return topRole(c, userId).position
}

export const can = (c: ConstellationDetail, p: ConstellationPermission): boolean =>
  c.me.owner || c.me.permissions.includes(p)

/** Can I act on this person (kick, time out, change roles)? Only people ranked below me. */
export function outranks(c: ConstellationDetail, meId: string, userId: string): boolean {
  if (userId === meId || userId === c.ownerId) return false
  return c.me.owner || c.me.rank > rankOf(c, userId)
}

/** Dashboard cards and invites, kept fresh by live events. */
export function useConstellationCards(enabled: boolean): {
  cards: ConstellationCard[]
  invites: ConstellationInvite[]
  loaded: boolean
  reload: () => void
} {
  const [cards, setCards] = useState<ConstellationCard[]>([])
  const [invites, setInvites] = useState<ConstellationInvite[]>([])
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    void api.dashboard().then((result) => {
      if (!result.ok) return
      setCards(result.data.constellations)
      setInvites(result.data.invites)
      setLoaded(true)
    })
  }, [])
  // Bursts of activity (a busy nebula) reload once, a moment later.
  const reload = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      load()
    }, 400)
  }, [load])
  useEffect(() => {
    if (!enabled) return
    load()
    const stop = window.glofly.onEvent((event) => {
      if (
        event.type === 'constellations:changed' ||
        event.type === 'constellation:activity' ||
        event.type === 'constellation:voice' ||
        event.type === 'constellation:removed'
      ) {
        reload()
      }
      if (event.type === 'connection' && event.connected) reload()
    })
    return () => {
      stop()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [enabled, load, reload])
  return { cards, invites, loaded, reload }
}

/** Your pinned nebulas (the home dock), kept fresh by live events. */
export function usePinnedNebulas(enabled: boolean): {
  pins: PinnedNebula[]
  reload: () => void
  setPins: (pins: PinnedNebula[]) => void
} {
  const [pins, setPins] = useState<PinnedNebula[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    void api.pins().then((r) => {
      if (r.ok) setPins(r.data.pins)
    })
  }, [])
  const reload = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      load()
    }, 400)
  }, [load])
  useEffect(() => {
    if (!enabled) return
    load()
    const stop = window.glofly.onEvent((event) => {
      if (
        event.type === 'constellations:changed' ||
        event.type === 'constellation:updated' ||
        event.type === 'constellation:activity' ||
        event.type === 'constellation:removed' ||
        (event.type === 'connection' && event.connected)
      )
        reload()
    })
    return () => {
      stop()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [enabled, load, reload])
  return { pins, reload, setPins }
}
