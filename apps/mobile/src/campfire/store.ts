import { create } from 'zustand'
import { router } from 'expo-router'
import type { CampfireEvents, CharacterView, HitEvent, Roll, TableState, Token } from '@glofly/shared'
import { onLive } from '@/api/realtime'
import { campfireApi } from './api'
import { isCampfireEvent, type CampfireEventName } from './events'

// Campfire on the phone: the tables this phone has open, kept up to date by the live events.
//
// The server numbers each person's events per campaign (`seq`). An event that isn't the next
// number means something was missed (or the server restarted and counts from 1 again): the
// table is loaded again with GET /campfire/campaigns/:id, which reports the seq it's at.

export type Hit = HitEvent & { id: number; at: number }
export type Ping = { id: number; userId: string; sceneId: string; x: number; y: number; at: number }
export type Lit = { campaignId: string; callId: string; name: string; by: string }

type State = {
  tables: Record<string, TableState>
  /** The last event number applied per campaign */
  seqs: Record<string, number>
  /** server clock − this phone's clock, per campaign (music sync) */
  offsets: Record<string, number>
  loading: Record<string, boolean>
  errors: Record<string, string | null>
  hits: Record<string, Hit[]>
  pings: Record<string, Ping[]>
  /** The newest roll everyone sees, for the toast over the map */
  toast: Record<string, Roll | null>
  /** "Campfire is lit · Join", per campaign */
  lit: Record<string, Lit>
  litDismissed: Record<string, boolean>
}

export const useCampfire = create<State>(() => ({
  tables: {},
  seqs: {},
  offsets: {},
  loading: {},
  errors: {},
  hits: {},
  pings: {},
  toast: {},
  lit: {},
  litDismissed: {},
}))

let nextId = 1
const reloads = new Map<string, Promise<void>>()

/** Loads (or reloads) a table. Calls at the same time share one request. */
export function loadTable(id: string): Promise<void> {
  const busy = reloads.get(id)
  if (busy) return busy
  const p = (async () => {
    useCampfire.setState((s) => ({ loading: { ...s.loading, [id]: true } }))
    const r = await campfireApi.table(id)
    useCampfire.setState((s) =>
      r.ok
        ? {
            tables: { ...s.tables, [id]: r.data },
            seqs: { ...s.seqs, [id]: r.data.seq },
            offsets: { ...s.offsets, [id]: r.data.serverNow - Date.now() },
            loading: { ...s.loading, [id]: false },
            errors: { ...s.errors, [id]: null },
          }
        : { loading: { ...s.loading, [id]: false }, errors: { ...s.errors, [id]: r.message } },
    )
  })().finally(() => reloads.delete(id))
  reloads.set(id, p)
  return p
}

/** The phone left the table: stop keeping it up to date. */
export function forgetTable(id: string) {
  useCampfire.setState((s) => {
    const tables = { ...s.tables }
    delete tables[id]
    return { tables }
  })
}

/** Changes the loaded table (no-op when it isn't loaded). */
export function patchTable(id: string, fn: (t: TableState) => Partial<TableState> | null) {
  useCampfire.setState((s) => {
    const t = s.tables[id]
    if (!t) return {}
    const change = fn(t)
    return change ? { tables: { ...s.tables, [id]: { ...t, ...change } } } : {}
  })
}

export function upsertCharacter(id: string, ch: CharacterView) {
  patchTable(id, (t) => ({ characters: t.characters.some((c) => c.id === ch.id) ? t.characters.map((c) => (c.id === ch.id ? ch : c)) : [...t.characters, ch] }))
}

function upsertToken(t: TableState, token: Token): Partial<TableState> | null {
  if (!t.scene || token.sceneId !== t.scene.id) return null
  return { tokens: t.tokens.some((x) => x.id === token.id) ? t.tokens.map((x) => (x.id === token.id ? token : x)) : [...t.tokens, token] }
}

export function dismissLit(campaignId: string) {
  useCampfire.setState((s) => ({ litDismissed: { ...s.litDismissed, [campaignId]: true } }))
}

/** Note that a table is lit (from the campaign list's openInCallId too). */
export function noteLit(lit: Lit) {
  useCampfire.setState((s) => ({ lit: { ...s.lit, [lit.campaignId]: lit } }))
}

const later = (ms: number, fn: () => void) => setTimeout(fn, ms)

const hubListeners = new Set<(campaignId: string) => void>()
/** The campaign hub changed (sessions, RSVPs, recaps, quests, loot, journal): the hub screen reloads. */
export function onHubChange(fn: (campaignId: string) => void): () => void {
  hubListeners.add(fn)
  return () => void hubListeners.delete(fn)
}

function apply<K extends CampfireEventName>(name: K, p: CampfireEvents[K]) {
  const id = p.campaignId
  if (name === 'campfire:hub') {
    for (const fn of hubListeners) fn(id)
    return
  }
  switch (name) {
    case 'campfire:opened': {
      const e = p as CampfireEvents['campfire:opened']
      useCampfire.setState((s) => ({ lit: { ...s.lit, [id]: { campaignId: id, callId: e.callId, name: e.name, by: e.by } }, litDismissed: { ...s.litDismissed, [id]: false } }))
      patchTable(id, (t) => ({ campaign: { ...t.campaign, openInCallId: e.callId } }))
      return
    }
    case 'campfire:closed': {
      useCampfire.setState((s) => {
        const lit = { ...s.lit }
        delete lit[id]
        return { lit }
      })
      patchTable(id, (t) => ({ campaign: { ...t.campaign, openInCallId: null } }))
      return
    }
    case 'campfire:state':
      void loadTable(id)
      return
    case 'campfire:token': {
      const e = p as CampfireEvents['campfire:token']
      patchTable(id, (t) => (e.op === 'upsert' ? upsertToken(t, e.token) : { tokens: t.tokens.filter((x) => x.id !== e.tokenId) }))
      return
    }
    case 'campfire:scene': {
      const e = p as CampfireEvents['campfire:scene']
      patchTable(id, (t) => {
        if (e.op === 'activate') {
          // Players are moved to the new scene; GMs stay where they are unless it was the one shown.
          const follow = t.myRole === 'player' || !t.scene || t.scene.id === t.campaign.activeSceneId
          return {
            scenes: e.scenes,
            campaign: { ...t.campaign, activeSceneId: e.sceneId },
            ...(follow ? { scene: e.scene, tokens: e.tokens ?? [] } : {}),
          }
        }
        if (e.op === 'delete') return { scenes: e.scenes, ...(t.scene?.id === e.sceneId ? { scene: null, tokens: [] } : {}) }
        return { scenes: e.scenes, ...(e.scene && t.scene?.id === e.scene.id ? { scene: e.scene, ...(e.tokens ? { tokens: e.tokens } : {}) } : {}) }
      })
      return
    }
    case 'campfire:fog': {
      const e = p as CampfireEvents['campfire:fog']
      patchTable(id, (t) => (t.scene?.id === e.sceneId ? { scene: { ...t.scene, fog: e.fog, built: e.built }, tokens: e.tokens } : null))
      return
    }
    case 'campfire:roll': {
      const e = p as CampfireEvents['campfire:roll']
      patchTable(id, (t) => ({ rolls: [e.roll, ...t.rolls.filter((r) => r.id !== e.roll.id)].slice(0, 100) }))
      useCampfire.setState((s) => ({ toast: { ...s.toast, [id]: e.roll } }))
      return
    }
    case 'campfire:pending': {
      const e = p as CampfireEvents['campfire:pending']
      patchTable(id, () => ({ pending: e.pending }))
      return
    }
    case 'campfire:hit': {
      const hit: Hit = { ...(p as CampfireEvents['campfire:hit']), id: nextId++, at: Date.now() }
      useCampfire.setState((s) => ({ hits: { ...s.hits, [id]: [...(s.hits[id] ?? []), hit].slice(-8) } }))
      later(3200, () => useCampfire.setState((s) => ({ hits: { ...s.hits, [id]: (s.hits[id] ?? []).filter((h) => h.id !== hit.id) } })))
      return
    }
    case 'campfire:combat': {
      const e = p as CampfireEvents['campfire:combat']
      patchTable(id, () => ({ combat: e.combat }))
      return
    }
    case 'campfire:character': {
      const e = p as CampfireEvents['campfire:character']
      if (e.op === 'upsert') upsertCharacter(id, e.character)
      else patchTable(id, (t) => ({ characters: t.characters.filter((c) => c.id !== e.characterId) }))
      return
    }
    case 'campfire:handout': {
      const e = p as CampfireEvents['campfire:handout']
      patchTable(id, (t) => ({
        handouts:
          e.op === 'upsert'
            ? t.handouts.some((h) => h.id === e.handout.id)
              ? t.handouts.map((h) => (h.id === e.handout.id ? e.handout : h))
              : [e.handout, ...t.handouts]
            : t.handouts.filter((h) => h.id !== e.handoutId),
      }))
      return
    }
    case 'campfire:music': {
      const e = p as CampfireEvents['campfire:music']
      patchTable(id, () => ({ music: e.music, ...(e.tracks ? { tracks: e.tracks } : {}) }))
      useCampfire.setState((s) => ({ offsets: { ...s.offsets, [id]: e.serverNow - Date.now() } }))
      return
    }
    case 'campfire:ping': {
      const e = p as CampfireEvents['campfire:ping']
      const ping: Ping = { id: nextId++, userId: e.userId, sceneId: e.sceneId, x: e.x, y: e.y, at: Date.now() }
      useCampfire.setState((s) => ({ pings: { ...s.pings, [id]: [...(s.pings[id] ?? []), ping].slice(-6) } }))
      later(2600, () => useCampfire.setState((s) => ({ pings: { ...s.pings, [id]: (s.pings[id] ?? []).filter((x) => x.id !== ping.id) } })))
      return
    }
    case 'campfire:presence': {
      const e = p as CampfireEvents['campfire:presence']
      patchTable(id, () => ({ present: e.present }))
      return
    }
    case 'campfire:members': {
      const e = p as CampfireEvents['campfire:members']
      patchTable(id, () => ({ members: e.members }))
      return
    }
  }
}

/** One live event: checks its number, then applies it (or loads the table again). */
export function receive(name: string, payload: unknown) {
  if (!isCampfireEvent(name)) return
  const p = payload as { campaignId?: unknown; seq?: unknown }
  if (typeof p?.campaignId !== 'string' || typeof p.seq !== 'number') return
  const id = p.campaignId
  const s = useCampfire.getState()
  const open = !!s.tables[id]
  if (open) {
    const last = s.seqs[id] ?? 0
    if (p.seq <= last && p.seq !== 1) return // already in what the last load returned
    if (p.seq !== last + 1) {
      // A gap (or the server started counting again): what we have can't be trusted.
      useCampfire.setState((x) => ({ seqs: { ...x.seqs, [id]: p.seq as number } }))
      void loadTable(id)
      if (name !== 'campfire:hit' && name !== 'campfire:ping' && name !== 'campfire:opened' && name !== 'campfire:closed') return
    } else {
      useCampfire.setState((x) => ({ seqs: { ...x.seqs, [id]: p.seq as number } }))
    }
  } else if (name !== 'campfire:opened' && name !== 'campfire:closed') {
    return
  }
  try {
    apply(name, payload as CampfireEvents[typeof name])
  } catch (err) {
    console.warn('campfire event failed', name, err)
    void loadTable(id)
  }
}

let started = false
/** Listens to Campfire's live events (from (main)/_layout). */
export function startCampfire() {
  if (started) return
  started = true
  onLive((event, payload) => {
    if (event === 'connected') {
      // Back online: whatever happened meanwhile is missing.
      for (const id of Object.keys(useCampfire.getState().tables)) void loadTable(id)
      return
    }
    receive(event, payload)
  })
}

/** From a call or a voice nebula: straight to the table lit in this call, else the campaign list. */
export function openCampfireFor(kind: 'nebula' | 'chat', homeId: string, callId: string | null, title: string | null) {
  const s = useCampfire.getState()
  const lit = callId ? Object.values(s.lit).find((l) => l.callId === callId) : undefined
  if (lit) return router.push({ pathname: '/campfire/[id]', params: { id: lit.campaignId } })
  router.push({ pathname: '/campfire/home', params: { kind, home: homeId, ...(callId ? { callId } : {}), ...(title ? { title } : {}) } })
}
