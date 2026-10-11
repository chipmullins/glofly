// Voice messages (next step).
export type Voice = { recording: boolean }
export function useVoice(_id: string): Voice {
  return { recording: false }
}
export function VoiceRecorderBar(_p: { voice: Voice }) {
  return null
}
export function RecordButton(_p: { voice: Voice }) {
  return null
}
