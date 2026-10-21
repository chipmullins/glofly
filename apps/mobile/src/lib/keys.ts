import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { create } from 'zustand'
import type { KeyCommandId } from '@glofly/shared'
import * as Native from 'glofly-native'
import { isTablet } from '@/lib/layout'

// 0.8.0 hardware keyboard shortcuts (iPad, Android tablets and Chromebooks; an iPhone or phone with
// a keyboard too): ⌘K / Ctrl+K quick switcher, ⌘/ the shortcut sheet, ⌘N new message, ⌘F search,
// ↑ edit your last message, Esc close, ⌥↑ / ⌥↓ (Alt) previous / next nebula.
//
// The native side (glofly-native KeyCommands) sends a "keyCommand" event. Screens say what they
// can do right now with useKeyCommand(id, handler, active); the newest active handler wins (a sheet
// over a chat gets Esc first). Only commands someone handles are switched on natively, so ↑ and
// Esc keep doing their normal job in a text box everywhere else.

type Handler = { id: KeyCommandId; run: () => void; order: number; priority: number }

const handlers = new Map<number, Handler>()
let nextKey = 1
let nextOrder = 1

/** The keyboard's modifier as written on this device ("⌘" on Apple, "Ctrl" elsewhere). */
export const MOD = Platform.OS === 'ios' ? '⌘' : 'Ctrl'
export const ALT = Platform.OS === 'ios' ? '⌥' : 'Alt'

/**
 * This build understands a hardware keyboard (0.8.0 native code). iPads (where keyboards are
 * common) and every Android device (tablets, Chromebooks, a phone with a keyboard: the keys only
 * reach Glofly when nothing else used them, so it costs nothing). Not iPhones.
 */
export const keyboardShortcutsAvailable = (): boolean => Native.hasKeyCommands() && (Platform.OS === 'android' || isTablet)

let synced = ''
let syncQueued = false
function sync() {
  if (syncQueued) return
  syncQueued = true
  // Several screens change theirs in one render: tell the native side once.
  setTimeout(() => {
    syncQueued = false
    const ids = [...new Set([...handlers.values()].map((h) => h.id))].sort()
    const key = ids.join(',')
    if (key === synced) return
    synced = key
    Native.setKeyCommands(ids)
  }, 0)
}

function add(id: KeyCommandId, run: () => void, priority: number): number {
  const key = nextKey++
  handlers.set(key, { id, run, order: nextOrder++, priority })
  sync()
  return key
}

function remove(key: number) {
  if (handlers.delete(key)) sync()
}

/** Runs the handler for a command: the highest priority, then the newest. */
export function runKeyCommand(id: KeyCommandId): boolean {
  let best: Handler | null = null
  for (const h of handlers.values()) {
    if (h.id !== id) continue
    if (!best || h.priority > best.priority || (h.priority === best.priority && h.order > best.order)) best = h
  }
  if (!best) return false
  best.run()
  return true
}

/**
 * While `active`, this key command does `run` (the latest call's function is used, so it can read
 * the screen's state). Coming back to a screen (active again) puts it on top again. `priority`:
 * app-wide fallbacks use -1, Glofly's dialogs and sheets 10 (Esc closes them before anything else).
 */
export function useKeyCommand(id: KeyCommandId, run: () => void, active = true, priority = 0) {
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    if (!active || !keyboardShortcutsAvailable()) return
    const key = add(id, () => latest.current(), priority)
    return () => remove(key)
  }, [id, active, priority])
}

let started = false
/** Listens for the keyboard (once, after signing in). */
export function startKeyCommands() {
  if (started || !keyboardShortcutsAvailable()) return
  started = true
  Native.onNativeEvent('keyCommand', (body) => {
    const id = body.id as KeyCommandId | undefined
    if (id) runKeyCommand(id)
  })
}

/** Tablets list the shortcuts in Settings (phones rarely have a keyboard). */
export const showShortcutsInSettings = (): boolean => keyboardShortcutsAvailable() && isTablet

/**
 * ⌘K / ⌘F away from a chat: the Chats search ("Find a friend or chat", which also finds
 * constellations, nebulas and settings, like the desktop's quick switcher) gets the focus.
 */
export const useSearchFocus = create<{ at: number }>(() => ({ at: 0 }))
export const requestSearchFocus = () => useSearchFocus.setState({ at: Date.now() })
