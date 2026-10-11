import type { Attachment } from '@glofly/shared'
import { inform } from '@/ui/dialogs'

// Photos and files to send (full version in the next step).
export type Uploads = { busy: boolean; readyAttachments: () => Attachment[]; clear: () => void }
export function useUploads(_id: string): Uploads {
  return { busy: false, readyAttachments: () => [], clear: () => {} }
}
export async function attachMenu(_u: Uploads) {
  await inform('Photos and files are coming soon')
}
export function UploadTray(_p: { uploads: Uploads }) {
  return null
}
