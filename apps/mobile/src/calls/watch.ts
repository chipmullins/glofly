import { create } from 'zustand'
import { ServerClock, type WatchControl, type WatchReaction, type WatchReactionEvent, type WatchState, type WatchUpdate } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive } from '@/api/realtime'
import { useStore } from '@/state/store'
import { inform } from '@/ui/dialogs'
import { useCall } from './controller'
import { setWatchDucking, setWatchMixing } from './media'

// Watch Together (0.5.0) on phones: what the call you're in is watching, kept up to date from
// the server, and the buttons that change it (same rules as the desktop app: every button goes
// through the server, which tells everyone).

type WatchStore = {
  callId: string | null
  watch: WatchState | null
  /** Firefly reactions floating over the video right now */
  flying: (WatchReactionEvent & { x: number })[]
}

export const useWatchStore = create<WatchStore>(() => ({ callId: null, watch: null, flying: [] }))
export const watchClock = new ServerClock()
let seq = 0

function take(u: WatchUpdate, sentAt?: number) {
  if (u.callId !== useWatchStore.getState().callId) return
  watchClock.note(u.serverNow, sentAt)
  if (u.watch && u.watch.seq < seq) return
  seq = u.watch?.seq ?? 0
  useWatchStore.setState({ watch: u.watch })
}

async function refresh() {
  const id = useWatchStore.getState().callId
  if (!id) return
  const sentAt = Date.now()
  const r = await api.watchGet(id)
  if (r.ok) {
    seq = 0
    take(r.data, sentAt)
  }
}

/** The call you're in changed (or ended: null). */
export function followWatch(callId: string | null) {
  if (useWatchStore.getState().callId === callId) return
  seq = 0
  useWatchStore.setState({ callId, watch: null, flying: [] })
  if (callId) void refresh()
}

let started = false
export function startWatch() {
  if (started) return
  started = true
  onLive((event, payload) => {
    if (event === 'watch:updated') take(payload as WatchUpdate)
    if (event === 'watch:reaction') {
      const r = payload as WatchReactionEvent
      if (r.callId !== useWatchStore.getState().callId) return
      const f = { ...r, x: 0.55 + Math.random() * 0.35 }
      useWatchStore.setState((s) => ({ flying: [...s.flying.slice(-15), f] }))
      setTimeout(() => useWatchStore.setState((s) => ({ flying: s.flying.filter((x) => x.id !== r.id) })), 3200)
    }
  })
  // Follows the call you're in.
  followWatch(useCall.getState().call?.id ?? null)
  useCall.subscribe((s) => followWatch(s.call?.id ?? null))
  // iPhone: the call's echo canceller turns the video's sound down; less so while a video is on.
  useWatchStore.subscribe((s) => setWatchDucking(!!s.watch))
  // iPhone (Oct 31): the video's own audio session silenced the call both ways; while a video is
  // on, the call's session mixes with it (media.tsx setWatchMixing).
  useWatchStore.subscribe((s, prev) => {
    if (!!s.watch !== !!prev.watch) void setWatchMixing(!!s.watch)
  })
  // Back online: catch up (the server may have restarted and forgotten the video).
  useStore.subscribe((s, prev) => {
    if (s.connected && !prev.connected) void refresh()
  })
}

async function run(ask: (id: string) => ReturnType<typeof api.watchStart>) {
  const id = useWatchStore.getState().callId
  if (!id) return null
  const sentAt = Date.now()
  const r = await ask(id)
  if (r.ok) take(r.data, sentAt)
  else if (r.error !== 'unauthorized') void inform("That didn't work", r.message)
  return r
}

export async function startWatching(link: string, control: WatchControl) {
  const id = useWatchStore.getState().callId
  if (!id) return { ok: false as const, error: 'invalid' as const, message: 'Join the call first.' }
  const sentAt = Date.now()
  const r = await api.watchStart(id, link, control)
  if (r.ok) {
    take(r.data, sentAt)
    if (r.data.someoneNeedsUpdate) inform('Someone in the call needs to update Glofly to see this video.')
  }
  return r
}
export const controlWatch = (action: 'play' | 'pause' | 'seek' | 'back' | 'forward', to?: number) => void run((id) => api.watchControl(id, action, to))
export const setWatchControl = (control: WatchControl) => void run((id) => api.watchSettings(id, control))
export const stopWatching = () => void run((id) => api.watchStop(id))
export function reactWatch(reaction: WatchReaction) {
  const id = useWatchStore.getState().callId
  if (id) void api.watchReact(id, reaction)
}
export function reportWatch(videoId: string, durationSec: number, title?: string) {
  const id = useWatchStore.getState().callId
  if (id) void api.watchReport(id, videoId, durationSec, title)
}
