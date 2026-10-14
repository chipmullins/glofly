import type { GloflyEvent } from '../../../desktop/src/preload/api-types'

// Live updates for the window (what the Electron main process sends over 'glofly:event').

type Listener = (event: GloflyEvent) => void
const listeners = new Set<Listener>()

export function emit(event: GloflyEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (err) {
      console.error('[glofly] event listener failed', err)
    }
  }
}

export function onEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
