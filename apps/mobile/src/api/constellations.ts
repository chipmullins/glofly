import type {
  ApiResult,
  ConstellationBan,
  ConstellationCard,
  ConstellationDetail,
  ConstellationInvite,
  ConstellationLink,
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
  MyGamesVisibility,
  NebulaKind,
  NebulaMention,
  NotifyLevel,
  PinnedNebula,
  RoleColor,
  TimeoutLength,
  CallJoin,
} from '@glofly/shared'
import { request, upload, type Upload } from './http'

// Glofly 2.0 on phones: Constellations and My games, as the screens call them (the same routes
// and bodies as the desktop app's lib/constellations.ts).

type Detail = { constellation: ConstellationDetail }
const base = (id: string) => `/constellations/${id}`

export const cx = {
  dashboard: () => request<{ constellations: ConstellationCard[]; invites: ConstellationInvite[] }>('GET', '/constellations'),
  order: (ids: string[]) => request<null>('PUT', '/constellations/order', { ids }),
  create: (values: {
    name: string
    template: ConstellationTemplate
    visibility: ConstellationVisibility
    type: ConstellationType | null
    tags: string[]
    description?: string | null
  }) => request<Detail>('POST', '/constellations', values),
  pins: () => request<{ pins: PinnedNebula[] }>('GET', '/constellations/pins'),
  pin: (id: string, nebulaId: string) => request<{ pins: PinnedNebula[] }>('PUT', `${base(id)}/nebulas/${nebulaId}/pin`),
  unpin: (id: string, nebulaId: string) => request<{ pins: PinnedNebula[] }>('DELETE', `${base(id)}/nebulas/${nebulaId}/pin`),
  mentions: (before?: string) =>
    request<{ mentions: NebulaMention[]; unread: number; more: boolean }>('GET', `/constellations/mentions${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  readMentions: () => request<null>('POST', '/constellations/mentions/read'),
  discover: () => request<{ tags: string[]; suggestions: DirectoryEntry[] }>('GET', '/constellations/discover'),
  directory: (q: string, type: ConstellationType | null, tag: string | null, offset = 0) => {
    const params: string[] = []
    if (q.trim()) params.push(`q=${encodeURIComponent(q.trim())}`)
    if (type) params.push(`type=${type}`)
    if (tag) params.push(`tag=${encodeURIComponent(tag)}`)
    if (offset) params.push(`offset=${offset}`)
    return request<{ results: DirectoryEntry[]; hasMore: boolean }>('GET', `/constellations/directory${params.length ? `?${params.join('&')}` : ''}`)
  },
  /** Which nebula a nebula chat belongs to (a notification opens glofly://chat/<conversationId>). */
  chatOf: (conversationId: string) => request<{ constellationId: string; nebulaId: string; kind: NebulaKind }>('GET', `/constellations/chats/${conversationId}`),
  linkPreview: (code: string) => request<{ constellation: DirectoryEntry }>('GET', `/constellations/links/${code}`),
  joinLink: (code: string) => request<Detail>('POST', `/constellations/links/${code}/join`),
  dismissInvite: (inviteId: string) => request<null>('POST', `/constellations/invites/${inviteId}/dismiss`),
  get: (id: string) => request<Detail>('GET', base(id)),
  update: (
    id: string,
    changes: Partial<{ name: string; description: string | null; color: string; visibility: ConstellationVisibility; type: ConstellationType | null; tags: string[] }>,
  ) => request<Detail>('PATCH', base(id), changes),
  setIcon: (id: string, file: Upload) => upload<{ iconVersion: string }>('PUT', `${base(id)}/icon`, file),
  removeIcon: (id: string) => request<{ iconVersion: null }>('DELETE', `${base(id)}/icon`),
  remove: (id: string, name: string) => request<null>('DELETE', base(id), { name }),
  transfer: (id: string, userId: string) => request<Detail>('POST', `${base(id)}/transfer`, { userId }),
  join: (id: string, note?: string) =>
    request<Detail | { requested: true; constellation: DirectoryEntry }>('POST', `${base(id)}/join`, note ? { note } : {}),
  cancelRequest: (id: string) => request<null>('DELETE', `${base(id)}/request`),
  leave: (id: string) => request<null>('POST', `${base(id)}/leave`),
  readAll: (id: string) => request<null>('POST', `${base(id)}/read`),
  notify: (id: string, level: NotifyLevel) => request<null>('PUT', `${base(id)}/notify`, { level }),
  nebulaNotify: (id: string, nebulaId: string, level: NotifyLevel | null) => request<null>('PUT', `${base(id)}/nebulas/${nebulaId}/notify`, { level }),
  addCategory: (id: string, name: string) => request<Detail>('POST', `${base(id)}/categories`, { name }),
  renameCategory: (id: string, categoryId: string, name: string) => request<Detail>('PATCH', `${base(id)}/categories/${categoryId}`, { name }),
  removeCategory: (id: string, categoryId: string) => request<Detail>('DELETE', `${base(id)}/categories/${categoryId}`),
  layout: (id: string, categories: string[], nebulas: { id: string; categoryId: string | null }[]) =>
    request<Detail>('PUT', `${base(id)}/layout`, { categories, nebulas }),
  addNebula: (id: string, values: { name: string; kind: NebulaKind; categoryId: string | null; topic?: string | null; readOnly?: boolean }) =>
    request<Detail & { nebulaId: string }>('POST', `${base(id)}/nebulas`, values),
  updateNebula: (id: string, nebulaId: string, changes: Partial<{ name: string; topic: string | null; readOnly: boolean; categoryId: string | null }>) =>
    request<Detail>('PATCH', `${base(id)}/nebulas/${nebulaId}`, changes),
  removeNebula: (id: string, nebulaId: string) => request<Detail>('DELETE', `${base(id)}/nebulas/${nebulaId}`),
  joinVoice: (id: string, nebulaId: string) => request<CallJoin>('POST', `${base(id)}/nebulas/${nebulaId}/voice`),
  voiceMute: (id: string, nebulaId: string, userId: string, muted: boolean) =>
    request<null>('POST', `${base(id)}/nebulas/${nebulaId}/voice/mute`, { userId, muted }),
  voiceDisconnect: (id: string, nebulaId: string, userId: string) =>
    request<null>('POST', `${base(id)}/nebulas/${nebulaId}/voice/disconnect`, { userId }),
  addRole: (id: string, values: { name: string; color: RoleColor; permissions: ConstellationPermission[] }) => request<Detail>('POST', `${base(id)}/roles`, values),
  updateRole: (id: string, roleId: string, changes: Partial<{ name: string; color: RoleColor; permissions: ConstellationPermission[] }>) =>
    request<Detail>('PATCH', `${base(id)}/roles/${roleId}`, changes),
  removeRole: (id: string, roleId: string) => request<Detail>('DELETE', `${base(id)}/roles/${roleId}`),
  orderRoles: (id: string, ids: string[]) => request<Detail>('PUT', `${base(id)}/roles/order`, { ids }),
  setMemberRoles: (id: string, userId: string, roleIds: string[]) => request<Detail>('PUT', `${base(id)}/members/${userId}/roles`, { roleIds }),
  timeout: (id: string, userId: string, length: TimeoutLength, reason?: string) =>
    request<Detail>('POST', `${base(id)}/members/${userId}/timeout`, { length, reason }),
  endTimeout: (id: string, userId: string) => request<Detail>('DELETE', `${base(id)}/members/${userId}/timeout`),
  kick: (id: string, userId: string, reason?: string) => request<Detail>('POST', `${base(id)}/members/${userId}/kick`, { reason }),
  ban: (id: string, userId: string, reason?: string) => request<Detail>('POST', `${base(id)}/members/${userId}/ban`, { reason }),
  bans: (id: string) => request<{ bans: ConstellationBan[] }>('GET', `${base(id)}/bans`),
  unban: (id: string, userId: string) => request<null>('DELETE', `${base(id)}/bans/${userId}`),
  requests: (id: string) => request<{ requests: JoinRequest[] }>('GET', `${base(id)}/requests`),
  decide: (id: string, userId: string, approve: boolean) => request<Detail>('POST', `${base(id)}/requests/${userId}/${approve ? 'approve' : 'deny'}`),
  invite: (id: string, userIds: string[]) => request<{ invited: number }>('POST', `${base(id)}/invites`, { userIds }),
  links: (id: string) => request<{ links: ConstellationLink[] }>('GET', `${base(id)}/links`),
  addLink: (id: string, lifetime: LinkLifetime, maxUses: number | null = null) =>
    request<{ link: ConstellationLink }>('POST', `${base(id)}/links`, { lifetime, maxUses }),
  revokeLink: (id: string, linkId: string) => request<null>('DELETE', `${base(id)}/links/${linkId}`),
  moderation: (id: string, before?: string) =>
    request<{ entries: ModerationEntry[]; hasMore: boolean }>('GET', `${base(id)}/moderation${before ? `?before=${encodeURIComponent(before)}` : ''}`),

  // ---- My games ----
  myGames: () => request<{ visibility: MyGamesVisibility; games: MyGame[] }>('GET', '/games/me'),
  setGamesVisibility: (visibility: MyGamesVisibility) => request<{ visibility: MyGamesVisibility }>('PUT', '/games/me/settings', { visibility }),
  setGame: (key: string, changes: { favorite?: boolean; hidden?: boolean }) => request<{ games: MyGame[] }>('PUT', `/games/me/${encodeKey(key)}`, changes),
  removeGame: (key: string) => request<{ games: MyGame[] }>('DELETE', `/games/me/${encodeKey(key)}`),
  gamesOf: (userId: string) => request<{ visibility: MyGamesVisibility; shared: boolean; games: MyGame[] }>('GET', `/games/user/${userId}`),
}

/** A game's key in a path, as hex (the same as the desktop app: the key is its lower-case name). */
export function encodeKey(key: string): string {
  let out = ''
  for (const b of new TextEncoder().encode(key)) out += b.toString(16).padStart(2, '0')
  return out
}

export type { ApiResult, ConstellationRole }
