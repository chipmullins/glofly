import type { ApiResult, BanAppeal, BanAppeals, BanDeleteWindow, ConstellationDetail, MyBan, NightWatch, TimeoutLength } from '@glofly/shared'
import { request } from './http'

// Communities round 2: Night watch on phones (the same routes as desktop lib/nightwatch.ts).
// Setting up Safety stays on a computer or chat.glofly.app (approved board 1e).

const base = (id: string) => `/constellations/${id}`

export const nightWatch = {
  dashboard: (id: string): Promise<ApiResult<NightWatch>> => request<NightWatch>('GET', `${base(id)}/watch`),
  resolve: (id: string, reportId: string, action: 'dismiss' | 'delete' | 'delete_timeout', length?: TimeoutLength) =>
    request<NightWatch>('POST', `${base(id)}/reports/${reportId}/resolve`, { action, length }),
  keepHidden: (id: string, heldId: string) => request<NightWatch>('POST', `${base(id)}/held/${heldId}/keep`),
  letThrough: (id: string, heldId: string) => request<unknown>('POST', `${base(id)}/automod/held/${heldId}/release`),
  reopenJoins: (id: string) => request<{ pausedUntil: null }>('DELETE', `${base(id)}/joins/pause`),
  raidClear: (id: string) => request<{ cleared: number }>('POST', `${base(id)}/raid/clear`, {}),
  appeals: (id: string) => request<{ appeals: BanAppeal[] }>('GET', `${base(id)}/appeals?status=open`),
  decide: (id: string, appealId: string, decision: 'accept' | 'deny', reply: string) =>
    request<{ appeal: BanAppeal | null }>('POST', `${base(id)}/appeals/${appealId}`, { decision, reply: reply.trim() || null }),
  ban: (id: string, userId: string, opts: { reason?: string; appeals: BanAppeals; deleteWindow: BanDeleteWindow }) =>
    request<{ constellation: ConstellationDetail }>('POST', `${base(id)}/members/${userId}/ban`, opts),
  report: (id: string, messageId: string, reason: string) => request<{ ok: true }>('POST', `${base(id)}/reports`, { messageId, reason }),
  myBans: () => request<{ bans: MyBan[] }>('GET', '/constellations/bans/mine'),
  appeal: (id: string, body: string) => request<{ ok: true }>('POST', `${base(id)}/appeal`, { body }),
}
