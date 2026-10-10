// How loud calls are on this computer: one volume for the whole call, and one for each person
// (with "Mute for me", which only you hear). Changed from the call's Audio button or by
// right-clicking someone's tile; remembered on this computer for the next call.

export type CallAudio = {
  /** Everyone in the call, 0–100 */
  volume: number
  /** Each person, by user id, 0–100 (missing = 100) */
  people: Record<string, number>
  /** People you've muted for yourself (they can still talk to everyone else) */
  muted: string[]
}

const KEY = 'glofly.callAudio'
const DEFAULTS: CallAudio = { volume: 100, people: {}, muted: [] }

const clamp = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null

function load(): CallAudio {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CallAudio>
    const people: Record<string, number> = {}
    for (const [id, v] of Object.entries(saved.people ?? {})) {
      const n = clamp(v)
      if (n !== null && /^[0-9a-f-]{36}$/i.test(id)) people[id] = n
    }
    return {
      volume: clamp(saved.volume) ?? 100,
      people,
      muted: Array.isArray(saved.muted) ? saved.muted.filter((x) => typeof x === 'string') : []
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let audio: CallAudio = load()
const listeners = new Set<(a: CallAudio) => void>()

export const getCallAudio = (): CallAudio => audio

function save(next: CallAudio): void {
  audio = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable: it still applies until Glofly closes.
  }
  for (const l of listeners) l(next)
}

export function setCallVolume(volume: number): void {
  save({ ...audio, volume: clamp(volume) ?? 100 })
}

export function setPersonVolume(userId: string, volume: number): void {
  const v = clamp(volume) ?? 100
  // Turning someone up again also unmutes them.
  save({
    ...audio,
    people: { ...audio.people, [userId]: v },
    muted: v > 0 ? audio.muted.filter((id) => id !== userId) : audio.muted
  })
}

export function setMutedForMe(userId: string, muted: boolean): void {
  save({
    ...audio,
    muted: muted
      ? [...new Set([...audio.muted, userId])]
      : audio.muted.filter((id) => id !== userId)
  })
}

export const personVolume = (userId: string, a: CallAudio = audio): number =>
  a.people[userId] ?? 100

export const isMutedForMe = (userId: string, a: CallAudio = audio): boolean =>
  a.muted.includes(userId)

/** What someone actually plays at, 0–1: the call volume × their own, or 0 if muted for me. */
export function effectiveVolume(userId: string, a: CallAudio = audio): number {
  if (isMutedForMe(userId, a)) return 0
  return (a.volume / 100) * (personVolume(userId, a) / 100)
}

export function onCallAudioChange(listener: (a: CallAudio) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
