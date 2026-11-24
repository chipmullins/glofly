import type {
  ApiResult,
  AttackInput,
  AttackResult,
  Campaign,
  CampaignHomeKind,
  CampaignSummary,
  CampfireFile,
  CampfireFileKind,
  Character,
  CharacterView,
  CombatView,
  Handout,
  RollVisibility,
  Roll,
  Sheet5e,
  SrdSpell,
  SrdSpellSummary,
  TableLive,
  TableState,
  Token,
} from '@glofly/shared'
import { authHeaders, request, upload, url, type Upload } from '@/api/http'

// Campfire's server routes (apps/server/src/campfire). Every request carries X-Glofly-Features
// with `campfire` (lib/config.ts VERSION_HEADERS), like the spec asks.

const enc = encodeURIComponent

export const campfireApi = {
  campaigns: (kind: CampaignHomeKind, id: string) => request<{ campaigns: CampaignSummary[]; canCreate: boolean; why?: string | null }>('GET', `/campfire/homes/${kind}/${enc(id)}/campaigns`),
  create: (kind: CampaignHomeKind, id: string, name: string) => request<Campaign>('POST', '/campfire/campaigns', { home: { kind, id }, name }),
  table: (id: string) => request<TableState>('GET', `/campfire/campaigns/${enc(id)}`),
  open: (id: string, callId: string) => request<{ ok: true; openInCallId: string }>('POST', `/campfire/campaigns/${enc(id)}/open`, { callId }),
  close: (id: string) => request<{ ok: true }>('POST', `/campfire/campaigns/${enc(id)}/close`, {}),
  /** 0.11.2: whoever made it (or a constellation admin) */
  deleteCampaign: (id: string) => request<{ ok: true }>('DELETE', `/campfire/campaigns/${enc(id)}`),
  presence: (id: string, away = false) => request<{ present: string[] }>('POST', `/campfire/campaigns/${enc(id)}/presence`, away ? { away: true } : {}),
  ping: (id: string, sceneId: string, x: number, y: number) => request<{ ok: true }>('POST', `/campfire/campaigns/${enc(id)}/ping`, { sceneId, x: Math.round(x), y: Math.round(y) }),
  moveToken: (tokenId: string, x: number, y: number, path?: [number, number][]) =>
    request<Token>('PATCH', `/campfire/tokens/${enc(tokenId)}`, { x: Math.round(x), y: Math.round(y), ...(path?.length ? { path: path.map(([a, b]) => [Math.round(a), Math.round(b)]) } : {}) }),
  roll: (id: string, body: { expression: string; label?: string | null; characterId?: string | null; visibility?: RollVisibility }) =>
    request<Roll>('POST', `/campfire/campaigns/${enc(id)}/rolls`, { visibility: 'all', ...body }),
  rolls: (id: string, before?: string) => request<{ rolls: Roll[] }>('GET', `/campfire/campaigns/${enc(id)}/rolls${before ? `?before=${enc(before)}` : ''}`),
  attack: (id: string, body: AttackInput) => request<AttackResult>('POST', `/campfire/campaigns/${enc(id)}/attack`, body),
  applyPending: (pendingId: string, amount?: number) => request<unknown>('POST', `/campfire/pending/${enc(pendingId)}/apply`, amount === undefined ? {} : { amount }),
  skipPending: (pendingId: string) => request<unknown>('POST', `/campfire/pending/${enc(pendingId)}/skip`, {}),
  combat: (id: string, body: { op: 'roll'; tokenId: string } | { op: 'next' } | { op: 'dash' } | { op: 'undoMove' }) =>
    request<{ combat: CombatView | null }>('POST', `/campfire/campaigns/${enc(id)}/combat`, body),
  pause: (id: string, on: boolean) => request<{ live: TableLive }>('POST', `/campfire/campaigns/${enc(id)}/pause`, { on }),
  spotlight: (id: string, userId: string | null) => request<{ live: TableLive }>('POST', `/campfire/campaigns/${enc(id)}/spotlight`, { userId }),
  character: (cid: string) => request<CharacterView>('GET', `/campfire/characters/${enc(cid)}`),
  createCharacter: (id: string, name: string) => request<Character>('POST', `/campfire/campaigns/${enc(id)}/characters`, { kind: 'pc', name }),
  saveCharacter: (cid: string, body: { name?: string; sheet?: Sheet5e; portraitFileId?: string | null; ddbUrl?: string | null }) =>
    request<Character>('PATCH', `/campfire/characters/${enc(cid)}`, body),
  rest: (cid: string, kind: 'short' | 'long') => request<Character>('POST', `/campfire/characters/${enc(cid)}/rest`, { kind }),
  deathSave: (cid: string) => request<{ roll: Roll; outcome: string; deathSaves: Sheet5e['deathSaves'] }>('POST', `/campfire/characters/${enc(cid)}/death-save`, {}),
  /** 0.11.4: game masters hide a token from players (its layer becomes 'gm') or show it again. */
  setTokenLayer: (tokenId: string, layer: 'gm' | 'tokens') => request<Token>('PATCH', `/campfire/tokens/${enc(tokenId)}`, { layer }),
  damageToken: (tokenId: string, amount: number) => request<{ applied: unknown }>('POST', `/campfire/tokens/${enc(tokenId)}/damage`, { amount }),
  healToken: (tokenId: string, amount: number) => request<{ ok: true }>('POST', `/campfire/tokens/${enc(tokenId)}/heal`, { amount }),
  srdSpells: (q: string) => request<{ spells: SrdSpellSummary[] }>('GET', `/campfire/srd/spells?q=${enc(q)}`),
  srdSpell: (slug: string) => request<SrdSpell>('GET', `/campfire/srd/spells/${enc(slug)}`),
  handout: (id: string, handoutId: string) => request<Handout>('GET', `/campfire/campaigns/${enc(id)}/handouts/${enc(handoutId)}`),
  uploadFile: (id: string, kind: CampfireFileKind, file: Upload, onProgress?: (f: number) => void) =>
    upload<CampfireFile>('POST', `/campfire/campaigns/${enc(id)}/files?kind=${kind}`, file, onProgress),
}

/** A Campfire file (map, portrait, token picture, handout picture, music) with the session's headers. */
export const fileUrl = (fileId: string) => url(`/campfire/files/${enc(fileId)}`)
export const fileSource = (fileId: string) => ({ uri: fileUrl(fileId), headers: authHeaders(), cacheKey: `cf-${fileId}` })

export type { ApiResult }
