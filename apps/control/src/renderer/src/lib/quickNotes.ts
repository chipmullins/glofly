import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'

// 0.9.0: the saved quick notes (Server → Quick notes), loaded once per session and shared by every
// note box. Older servers answer 404: no chips, the note box works as before.

let notes: string[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

const emit = (): void => listeners.forEach((l) => l())

export function loadQuickNotes(force = false): Promise<void> {
  if (loading) return loading
  if (loaded && !force) return Promise.resolve()
  loading = api
    .quickNotes()
    .then((result) => {
      if (result.ok) {
        notes = result.data.notes
        loaded = true
        emit()
      }
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** After Server → Quick notes saved a new list. */
export function setQuickNotes(next: string[]): void {
  notes = next
  loaded = true
  emit()
}

/** On sign-out: the next session loads them again. */
export function forgetQuickNotes(): void {
  notes = []
  loaded = false
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useQuickNotes(): string[] {
  const value = useSyncExternalStore(subscribe, () => notes)
  useEffect(() => {
    void loadQuickNotes()
  }, [])
  return value
}
