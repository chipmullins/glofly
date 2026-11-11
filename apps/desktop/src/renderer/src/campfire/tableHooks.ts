import { useEffect, useMemo, useState } from 'react'
import type { Room } from 'livekit-client'
import { isFullCharacter, type TableState, type Token } from '@glofly/shared/campfire/types'
import { moveBudget, reachOf, speedFor } from '@glofly/shared/campfire/roundB'
import { cf, fileUrl } from './api'
import type { LiveFx } from './useTable'
import bellFile from '../assets/sounds/campfire-bell.ogg'
import chimeFile from '../assets/sounds/campfire-chime.ogg'
import thunderFile from '../assets/sounds/campfire-thunder.ogg'
import heartbeatFile from '../assets/sounds/campfire-heartbeat.ogg'
import coinsFile from '../assets/sounds/campfire-coins.ogg'
import drumFile from '../assets/sounds/campfire-drum.ogg'
import gongFile from '../assets/sounds/campfire-gong.ogg'
import whooshFile from '../assets/sounds/campfire-whoosh.ogg'
import doorFile from '../assets/sounds/campfire-door.ogg'

// Round B's hooks for the table (TableB.tsx has the components): the turn's movement, sound board
// playback, who is talking, reach, and the game master's hold-V whisper.

const SOUND_FILES: Record<string, string> = {
  bell: bellFile,
  chime: chimeFile,
  thunder: thunderFile,
  heartbeat: heartbeatFile,
  coins: coinsFile,
  drum: drumFile,
  gong: gongFile,
  whoosh: whooshFile,
  door: doorFile
}

/** How far the token taking its turn may still go (for the ring and the bar). */
export function useMovement(
  t: TableState,
  meId: string,
  isGm: boolean
): {
  tokenId: string
  speed: number
  moved: number
  left: number
  dashed: boolean
  dashExtra: number
  canAct: boolean
} | null {
  return useMemo(() => {
    const c = t.combat
    const e = c?.entries[c.turn]
    if (!c || !e || c.current !== e.tokenId) return null
    const tk = t.tokens.find((x) => x.id === e.tokenId)
    if (!tk) return null
    const ch = tk.characterId ? t.characters.find((x) => x.id === tk.characterId) : undefined
    const mine = tk.controlledBy.includes(meId) || (!!ch && ch.ownerId === meId)
    if (!isGm && !mine) return null
    const speed = speedFor(ch && isFullCharacter(ch) ? ch.sheet : null, tk.conditions)
    const moved = e.moved ?? 0
    const dashed = !!e.dashed
    const left = moveBudget(speed, dashed) - moved
    return {
      tokenId: tk.id,
      speed,
      moved,
      left,
      dashed,
      dashExtra: dashed ? 0 : speed,
      canAct: true
    }
  }, [t.combat, t.tokens, t.characters, isGm, meId])
}

export function useSoundPlayer(fx: LiveFx['sound']): void {
  useEffect(() => {
    if (!fx) return
    const src = fx.builtin ? SOUND_FILES[fx.builtin] : fx.fileId ? fileUrl(fx.fileId) : null
    if (!src) return
    let vol = 0.7
    try {
      vol = Number(localStorage.getItem('campfire.soundVolume') ?? '0.7')
    } catch {
      /* default */
    }
    const a = new Audio(src)
    a.volume = Math.max(0, Math.min(1, fx.volume * (Number.isFinite(vol) ? vol / 0.7 : 1)))
    void a.play().catch(() => undefined)
    const stop = window.setTimeout(() => a.pause(), 16_000)
    return () => window.clearTimeout(stop)
  }, [fx])
}

export const GLOW_KEY = 'campfire.speakingGlow'
export const speakingGlowOn = (): boolean => {
  try {
    return localStorage.getItem(GLOW_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Token ids whose player is talking in the call (their own PCs' tokens and tokens they control). */
export function useSpeakingTokens(
  t: TableState,
  room: Room | null,
  tick: number,
  on: boolean
): Set<string> {
  return useMemo(() => {
    const out = new Set<string>()
    if (!room || !on) return out
    const talking = new Set<string>()
    for (const p of room.remoteParticipants.values()) if (p.isSpeaking) talking.add(p.identity)
    if (room.localParticipant.isSpeaking) talking.add(room.localParticipant.identity)
    if (!talking.size) return out
    for (const tk of t.tokens) {
      const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : undefined
      if (
        (ch?.kind === 'pc' && ch.ownerId && talking.has(ch.ownerId)) ||
        tk.controlledBy.some((u) => talking.has(u))
      )
        out.add(tk.id)
    }
    return out
    // `tick` changes when who's talking changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, tick, on, t.tokens, t.characters])
}

/** Reach (for the hover square): from the sheet when we have it, 5 ft otherwise. */
export function reachFor(t: TableState): (tk: Token) => number | null {
  return (tk) => {
    if (tk.layer === 'map') return null
    const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : undefined
    return reachOf(ch && isFullCharacter(ch) ? ch.sheet : null)
  }
}

/** Holding V whispers: only the chosen player can hear the game master's microphone meanwhile. */
export function useWhisperKey(
  campaignId: string,
  room: Room | null,
  to: string | null,
  say: (m: string) => void
): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!room || !to) return
    let on = false
    const set = async (next: boolean): Promise<void> => {
      if (next === on) return
      on = next
      setHeld(next)
      try {
        await room.localParticipant.setTrackSubscriptionPermissions(
          !next,
          next ? [{ participantIdentity: to, allowAll: true }] : []
        )
      } catch {
        say('The call didn’t allow a whisper.')
      }
      void cf.post(`/campfire/campaigns/${campaignId}/whisper`, { to, on: next })
    }
    const down = (e: KeyboardEvent): void => {
      if (
        e.key.toLowerCase() !== 'v' ||
        e.repeat ||
        (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')
      )
        return
      void set(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'v') void set(false)
    }
    const blur = (): void => void set(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      void set(false)
    }
  }, [room, to, campaignId, say])
  return held
}
