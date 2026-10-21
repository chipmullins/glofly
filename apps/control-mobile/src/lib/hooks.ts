import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { api, type Result } from '@control/api'
import { create } from 'zustand'

/** Loads something from the server; reloads on focus, on pull to refresh, and every `everyMs`. */
export function useLoad<T>(load: () => Promise<Result<T>>, deps: unknown[] = [], opts: { everyMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const loadRef = useRef(load)
  loadRef.current = load
  const seq = useRef(0)

  const run = useCallback(async (mode: 'first' | 'refresh' | 'quiet') => {
    const n = ++seq.current
    if (mode === 'refresh') setRefreshing(true)
    const r = await loadRef.current()
    if (n !== seq.current) return
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else if (r.status !== 401) {
      setError(r.message)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void run('first')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Back on this screen (after an action elsewhere): quietly refresh.
  const firstFocus = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false
      else void run('quiet')
      if (!opts.everyMs) return
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void run('quiet')
      }, opts.everyMs)
      return () => clearInterval(timer)
    }, [run, opts.everyMs]),
  )

  return {
    data,
    setData,
    error,
    loading: loading && !data,
    refreshing,
    refresh: () => void run('refresh'),
    reload: () => void run('quiet'),
  }
}

/** Quick notes (shared with desktop Control), loaded once per sign-in. */
export const useQuickNotes = create<{ notes: string[]; loaded: boolean; load: (force?: boolean) => Promise<void> }>((set, get) => ({
  notes: [],
  loaded: false,
  load: async (force) => {
    if (get().loaded && !force) return
    const r = await api.quickNotes()
    if (r.ok) set({ notes: r.data.notes, loaded: true })
  },
}))

/** Counts the tab bar and Home share (open reports badge). */
export const useCounts = create<{ openReports: number; inboxUnread: number; set: (p: Partial<{ openReports: number; inboxUnread: number }>) => void }>(
  (set) => ({ openReports: 0, inboxUnread: 0, set: (p) => set(p) }),
)
