// Voice messages: the pure parts (the recorder and player differ per app).

/** "0:07", "4:59" */
export function voiceTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** How many waveform bars a recording gets. */
export const VOICE_BARS = 48

/** Loudness samples (0–1) → up to VOICE_BARS bar heights (0–100), scaled so the loudest bar is full. */
export function toPeaks(levels: number[], bars = VOICE_BARS): number[] {
  if (levels.length === 0) return [0]
  const out: number[] = []
  const count = Math.min(bars, levels.length)
  const per = levels.length / count
  for (let i = 0; i < count; i++) {
    const slice = levels.slice(
      Math.floor(i * per),
      Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1)
    )
    out.push(Math.max(...slice))
  }
  const top = Math.max(...out, 0.02)
  return out.map((b) => Math.round(Math.min(1, b / top) * 100))
}
