import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  TableLive,
  CampaignMember,
  CharacterView,
  CombatView,
  HandoutSummary,
  HitEvent,
  MusicState,
  PendingDamage,
  Roll,
  Scene,
  SceneSummary,
  TableState,
  Token,
  TokenBar,
  Track
} from '@glofly/shared/campfire/types'
import type { CampfireWireEvent } from '../../../main/campfireEvents'
import { cf } from './api'

// One table's state for this person: loaded from GET /campfire/campaigns/:id, then kept current
// by live events. Every event carries my own sequence number for this campaign; a gap (or the
// server restarting, which starts again from 1) means something was missed: load it all again.
// Events that arrive while it loads wait, then the ones newer than the load are applied.

export type HitFx = { id: number; hit: HitEvent; at: number }
export type PingFx = { id: number; userId: string; sceneId: string; x: number; y: number }

export type TableCtl = {
  t: TableState | null
  error: string | null
  /** Server clock minus mine (ms): music and timers line up with it */
  serverOffset: number
  hits: HitFx[]
  pings: PingFx[]
  /** Each token's bars before its latest change (the hit animation drops from there) */
  prevBars: React.MutableRefObject<Map<string, (TokenBar | null)[]>>
  reload: () => void
  /** Local changes (answers to my own requests) */
  update: (fn: (t: TableState) => TableState) => void
  upsertToken: (token: Token) => void
  /** Round B: one-off things from the game master (view moved, a sound, a whisper, a notice) */
  live: LiveFx
}

export type LiveFx = {
  focus: { sceneId: string; x: number; y: number; key: number; by: string } | null
  sound: { key: number; builtin: string | null; fileId: string | null; volume: number } | null
  whisper: { from: string; to: string; on: boolean } | null
  notice: { key: number; text: string } | null
}
const NO_FX: LiveFx = { focus: null, sound: null, whisper: null, notice: null }

const ROLLS_KEPT = 200

let fxId = 1

export function useTable(campaignId: string): TableCtl {
  const [t, setT] = useState<TableState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverOffset, setServerOffset] = useState(0)
  const [hits, setHits] = useState<HitFx[]>([])
  const [pings, setPings] = useState<PingFx[]>([])
  const [live, setLive] = useState<LiveFx>(NO_FX)
  const prevBars = useRef(new Map<string, (TokenBar | null)[]>())
  const seq = useRef(0)
  const loading = useRef(false)
  const queued = useRef<CampfireWireEvent[]>([])
  const alive = useRef(true)
  const reloadRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    alive.current = true

    const load = async (): Promise<void> => {
      if (loading.current) return
      loading.current = true
      const before = Date.now()
      const r = await cf.get<TableState>(`/campfire/campaigns/${campaignId}`)
      loading.current = false
      if (!alive.current) return
      if (!r.ok) {
        setError(r.error === 'not_found' ? "This campaign isn't available (anymore)." : r.message)
        return
      }
      const state = r.data
      setServerOffset(state.serverNow - Math.round((before + Date.now()) / 2))
      seq.current = state.seq
      setError(null)
      setT(state)
      // Events that came in while it loaded: only the ones after this load count.
      const waiting = queued.current.filter((e) => e.data.seq > state.seq)
      queued.current = []
      for (const e of waiting) handle(e)
    }
    reloadRef.current = () => void load()

    const apply = (name: CampfireWireEvent['name'], d: Record<string, unknown>): void => {
      if (name === 'campfire:hit') {
        const hit = d as unknown as HitEvent
        setHits((list) => [...list.slice(-20), { id: fxId++, hit, at: Date.now() }])
        return
      }
      if (name === 'campfire:ping') {
        const p = d as unknown as PingFx
        const id = fxId++
        setPings((list) => [
          ...list.slice(-10),
          { id, userId: p.userId, sceneId: p.sceneId, x: p.x, y: p.y }
        ])
        setTimeout(() => setPings((list) => list.filter((x) => x.id !== id)), 4000)
        return
      }
      // Round B: one-off events (not table state).
      if (name === 'campfire:view') {
        const v = d as { sceneId: string; x: number; y: number; by: string }
        setLive((l) => ({ ...l, focus: { ...v, key: fxId++ } }))
        return
      }
      if (name === 'campfire:sound') {
        const v = d as { builtin: string | null; fileId: string | null; volume: number }
        setLive((l) => ({ ...l, sound: { ...v, key: fxId++ } }))
        return
      }
      if (name === 'campfire:whisper') {
        const v = d as { from: string; to: string; on: boolean }
        setLive((l) => ({ ...l, whisper: v.on ? v : null }))
        return
      }
      if (name === 'campfire:notice') {
        setLive((l) => ({ ...l, notice: { key: fxId++, text: String(d.text ?? '') } }))
        return
      }
      if (name === 'campfire:removed') {
        setError('The game master removed you from this table.')
        setT(null)
        return
      }
      if (name === 'campfire:state') {
        if (d.reason === 'deleted') setError('The game master deleted this campaign.')
        else void load()
        return
      }
      // Moved to a scene without its tokens, or a scene went: load the table.
      if (
        name === 'campfire:scene' &&
        ((d.op === 'activate' && !(d.scene && Array.isArray(d.tokens))) || d.op === 'delete')
      ) {
        void load()
        return
      }
      setT((cur) => {
        if (!cur) return cur
        switch (name) {
          case 'campfire:token': {
            if (d.op === 'upsert') {
              const token = d.token as Token
              if (!cur.scene || token.sceneId !== cur.scene.id) return cur
              const old = cur.tokens.find((x) => x.id === token.id)
              if (old) prevBars.current.set(token.id, old.bars)
              return {
                ...cur,
                tokens: old
                  ? cur.tokens.map((x) => (x.id === token.id ? token : x))
                  : [...cur.tokens, token]
              }
            }
            return { ...cur, tokens: cur.tokens.filter((x) => x.id !== d.tokenId) }
          }
          case 'campfire:scene': {
            const scenes = (d.scenes as SceneSummary[] | undefined) ?? cur.scenes
            const scene = d.scene as Scene | null
            if (d.op === 'activate') {
              if (scene && Array.isArray(d.tokens)) {
                return {
                  ...cur,
                  scenes,
                  scene,
                  tokens: d.tokens as Token[],
                  campaign: { ...cur.campaign, activeSceneId: scene.id }
                }
              }
              return { ...cur, scenes }
            }
            if (d.op === 'upsert' && scene && cur.scene?.id === scene.id)
              return { ...cur, scenes, scene }
            return { ...cur, scenes }
          }
          case 'campfire:fog': {
            if (!cur.scene || cur.scene.id !== d.sceneId) return cur
            return {
              ...cur,
              scene: { ...cur.scene, fog: d.fog as Scene['fog'], built: d.built as Scene['built'] },
              tokens: d.tokens as Token[]
            }
          }
          case 'campfire:roll': {
            const roll = d.roll as Roll
            if (cur.rolls.some((r) => r.id === roll.id)) return cur
            return { ...cur, rolls: [roll, ...cur.rolls].slice(0, ROLLS_KEPT) }
          }
          case 'campfire:pending':
            return { ...cur, pending: d.pending as PendingDamage[] }
          case 'campfire:combat':
            return { ...cur, combat: d.combat as CombatView | null }
          case 'campfire:character': {
            if (d.op === 'upsert') {
              const c = d.character as CharacterView
              const has = cur.characters.some((x) => x.id === c.id)
              return {
                ...cur,
                characters: has
                  ? cur.characters.map((x) => (x.id === c.id ? c : x))
                  : [...cur.characters, c]
              }
            }
            return { ...cur, characters: cur.characters.filter((x) => x.id !== d.characterId) }
          }
          case 'campfire:handout': {
            if (d.op === 'upsert') {
              const h = d.handout as HandoutSummary
              const has = cur.handouts.some((x) => x.id === h.id)
              return {
                ...cur,
                handouts: has
                  ? cur.handouts.map((x) => (x.id === h.id ? h : x))
                  : [...cur.handouts, h]
              }
            }
            return { ...cur, handouts: cur.handouts.filter((x) => x.id !== d.handoutId) }
          }
          case 'campfire:music': {
            if (typeof d.serverNow === 'number') setServerOffset(d.serverNow - Date.now())
            return {
              ...cur,
              music: (d.music as MusicState | null) ?? null,
              tracks: Array.isArray(d.tracks) ? (d.tracks as Track[]) : cur.tracks
            }
          }
          case 'campfire:presence':
            return { ...cur, present: d.present as string[] }
          case 'campfire:members':
            return { ...cur, members: d.members as CampaignMember[] }
          case 'campfire:opened':
            return { ...cur, campaign: { ...cur.campaign, openInCallId: d.callId as string } }
          case 'campfire:closed':
            return { ...cur, campaign: { ...cur.campaign, openInCallId: null } }
          case 'campfire:live':
            return { ...cur, campaign: { ...cur.campaign, live: d.live as TableLive } }
          default:
            return cur
        }
      })
    }

    const handle = (e: CampfireWireEvent): void => {
      if (loading.current) {
        queued.current.push(e)
        return
      }
      const s = e.data.seq
      if (s === seq.current + 1) {
        seq.current = s
        apply(e.name, e.data)
      } else if (s > seq.current + 1 || s < seq.current) {
        // Missed something (or the server restarted): load the table again.
        // (Animations from the gap are skipped; the state is right after the load.)
        queued.current = []
        void load()
      }
    }

    void load()
    const off = window.glofly.onEvent((event) => {
      if (event.type === 'campfire' && event.data.campaignId === campaignId) handle(event)
      // Reconnected: events may have been missed while offline.
      if (event.type === 'connection' && event.connected) void load()
    })
    // At the table: say so now and every 30 s; leaving says so at once.
    const presence = (): void => void cf.post(`/campfire/campaigns/${campaignId}/presence`)
    presence()
    const timer = window.setInterval(presence, 30_000)
    return () => {
      alive.current = false
      off()
      window.clearInterval(timer)
      void cf.post(`/campfire/campaigns/${campaignId}/presence`, { away: true })
    }
  }, [campaignId])

  // Old hit animations go away.
  useEffect(() => {
    if (!hits.length) return
    const timer = window.setTimeout(
      () => setHits((list) => list.filter((h) => Date.now() - h.at < 6000)),
      6500
    )
    return () => window.clearTimeout(timer)
  }, [hits])

  const update = useCallback(
    (fn: (t: TableState) => TableState) => setT((cur) => (cur ? fn(cur) : cur)),
    []
  )
  const upsertToken = useCallback(
    (token: Token) =>
      setT((cur) => {
        if (!cur || cur.scene?.id !== token.sceneId) return cur
        const has = cur.tokens.some((x) => x.id === token.id)
        return {
          ...cur,
          tokens: has
            ? cur.tokens.map((x) => (x.id === token.id ? token : x))
            : [...cur.tokens, token]
        }
      }),
    []
  )

  return {
    t,
    error,
    serverOffset,
    hits,
    pings,
    prevBars,
    reload: () => reloadRef.current(),
    update,
    upsertToken,
    live
  }
}
