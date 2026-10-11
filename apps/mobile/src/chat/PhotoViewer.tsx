import type { Message } from '@glofly/shared'

// The full-size photo viewer (next step).
export type ViewerState = { message: Message; index: number }
export function PhotoViewer(_p: { state: ViewerState; onClose: () => void }) {
  return null
}
