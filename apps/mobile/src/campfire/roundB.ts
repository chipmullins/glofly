import { useMemo } from 'react'
import { createAudioPlayer, type AudioPlayer } from 'expo-audio'
import { create } from 'zustand'
import { isFullCharacter, moveBudget, pathCost, speedFor, tokenCenter, type BuiltinSound, type Point, type TableState, type Token } from '@glofly/shared'
import { useCall } from '@/calls/controller'
import { authHeaders } from '@/api/http'
import { fileUrl } from './api'
import { useMusicPrefs } from './music'

// Round B on phones (the approved PhoneMove and PhonePaused boards): movement on your turn (a
// planned path you confirm with "Move here", Dash, Undo), the table's live moments (paused,
// spotlight, the game master moving everyone's view, whispers, short notices) and the sound board.

// ───────────── Live moments ─────────────

export type TableFx = {
  /** The game master moved everyone's view here */
  focus: { sceneId: string; x: number; y: number; by: string; at: number } | null
  notice: { text: string; at: number } | null
  /** The game master is whispering to this person (from), or null */
  whisper: { from: string; at: number } | null
}
const NO_FX: TableFx = { focus: null, notice: null, whisper: null }

export const useTableFx = create<{ fx: Record<string, TableFx> }>(() => ({ fx: {} }))

export function setFx(campaignId: string, change: Partial<TableFx>) {
  useTableFx.setState((s) => ({ fx: { ...s.fx, [campaignId]: { ...(s.fx[campaignId] ?? NO_FX), ...change } } }))
}
export const useFx = (campaignId: string): TableFx => useTableFx((s) => s.fx[campaignId] ?? NO_FX)
export function forgetFx(campaignId: string) {
  useTableFx.setState((s) => {
    const fx = { ...s.fx }
    delete fx[campaignId]
    return { fx }
  })
}

// ───────────── Sounds ─────────────

const SOUND_FILES: Record<BuiltinSound, number> = {
  bell: require('../../assets/sounds/campfire-bell.ogg'),
  chime: require('../../assets/sounds/campfire-chime.ogg'),
  thunder: require('../../assets/sounds/campfire-thunder.ogg'),
  heartbeat: require('../../assets/sounds/campfire-heartbeat.ogg'),
  coins: require('../../assets/sounds/campfire-coins.ogg'),
  drum: require('../../assets/sounds/campfire-drum.ogg'),
  gong: require('../../assets/sounds/campfire-gong.ogg'),
  whoosh: require('../../assets/sounds/campfire-whoosh.ogg'),
  door: require('../../assets/sounds/campfire-door.ogg'),
}

const playing = new Set<AudioPlayer>()

/** A sound board sound, at the game master's volume × this phone's table volume (music's slider). */
export function playCampfireSound(builtin: string | null, fileId: string | null, volume: number) {
  const { volume: mine, muted } = useMusicPrefs.getState()
  if (muted) return
  const src = builtin && builtin in SOUND_FILES ? SOUND_FILES[builtin as BuiltinSound] : fileId ? { uri: fileUrl(fileId), headers: authHeaders() } : null
  if (!src) return
  try {
    const p = createAudioPlayer(src)
    p.volume = Math.max(0, Math.min(1, volume * mine))
    playing.add(p)
    p.play()
    // Sounds are 15 s at most; let the player go after that.
    setTimeout(() => {
      playing.delete(p)
      try {
        p.remove()
      } catch {
        /* already gone */
      }
    }, 16_000)
  } catch {
    /* no audio on this phone right now */
  }
}

// ───────────── Movement ─────────────

export type Movement = { tokenId: string; speed: number; moved: number; left: number; dashed: boolean; lastMove: boolean; enforced: boolean }

/** The turn's movement when it's mine to move (my token's turn, or any turn for the game master). */
export function useMovement(t: TableState | undefined, meId: string): Movement | null {
  return useMemo(() => {
    const c = t?.combat
    const e = c?.entries[c.turn]
    if (!t || !c || !e || c.current !== e.tokenId) return null
    const tk = t.tokens.find((x) => x.id === e.tokenId)
    if (!tk) return null
    const gm = t.myRole === 'gm'
    const ch = tk.characterId ? t.characters.find((x) => x.id === tk.characterId) : undefined
    const mine = tk.controlledBy.includes(meId) || (!!ch && ch.ownerId === meId)
    if (!gm && !mine) return null
    const speed = speedFor(ch && isFullCharacter(ch) ? ch.sheet : null, tk.conditions)
    const moved = e.moved ?? 0
    const dashed = !!e.dashed
    return { tokenId: tk.id, speed, moved, left: moveBudget(speed, dashed) - moved, dashed, lastMove: !!e.lastMove, enforced: !gm && !!t.campaign.settings.moveOnTurn }
  }, [t, meId])
}

/** A move drawn on the map, waiting for "Move here". */
export type MovePlan = { campaignId: string; tokenId: string; x: number; y: number; path: Point[]; cost: number; extra: number }
export const useMovePlan = create<{ plan: MovePlan | null }>(() => ({ plan: null }))
export const setPlan = (plan: MovePlan | null) => useMovePlan.setState({ plan })

/** What a path costs: feet, and how much of it the difficult ground added. Points are token centers. */
export function costOf(t: TableState, points: Point[]): { cost: number; extra: number } {
  const scene = t.scene
  if (!scene || points.length < 2) return { cost: 0, extra: 0 }
  const diagonal = t.campaign.settings.diagonal ?? '5'
  const cost = pathCost(points, scene.grid, scene.built?.terrain ?? [], diagonal)
  const flat = pathCost(points, scene.grid, [], diagonal)
  return { cost, extra: Math.max(0, cost - flat) }
}

export const centerAt = (tk: Pick<Token, 'w' | 'h'>, x: number, y: number, size: number): Point => tokenCenter({ x, y, w: tk.w, h: tk.h }, { size })

/** Can I drag this token right now? (Paused tables and locked tokens stay put for players.) */
export function mayDrag(t: TableState, tk: Token, mine: boolean): boolean {
  if (t.myRole === 'gm') return true
  if (!mine) return false
  if (t.campaign.live?.paused) return false
  return !tk.locked && !t.campaign.settings.tokensLocked
}

// ───────────── Talking in the call ─────────────

/** Token ids whose player is talking in the call right now (their PC and tokens they control). */
export function useSpeakingTokens(t: TableState | undefined): Set<string> {
  const tiles = useCall((s) => s.tiles)
  return useMemo(() => {
    const out = new Set<string>()
    if (!t) return out
    const talking = new Set(tiles.filter((x) => x.speaking && !x.micMuted).map((x) => x.userId))
    if (!talking.size) return out
    for (const tk of t.tokens) {
      const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : undefined
      if ((ch?.ownerId && talking.has(ch.ownerId)) || tk.controlledBy.some((u) => talking.has(u))) out.add(tk.id)
    }
    return out
  }, [t, tiles])
}
