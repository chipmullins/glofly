import { Platform } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import type { Attachment } from '@glofly/shared'
import { authHeaders, url } from '@/api/http'
import { inform } from '@/ui/dialogs'

// Loading chat photos, files and voice messages (they need the session, so headers go along),
// and saving or sharing them.

export const attachmentUrl = (conversationId: string, a: Pick<Attachment, 'id'>, variant: 'preview' | 'full' | 'file') =>
  url(`/conversations/${conversationId}/attachments/${a.id}/${variant}`)

export const imageSource = (conversationId: string, a: Attachment, variant: 'preview' | 'full') => ({
  uri: attachmentUrl(conversationId, a, variant),
  headers: authHeaders(),
  cacheKey: `att-${a.id}-${variant}`,
})

/** Downloads to this phone's cache (kept by name, so the share sheet shows the real file name). */
async function download(conversationId: string, a: Attachment, variant: 'full' | 'file'): Promise<File> {
  const dir = new Directory(Paths.cache, 'downloads', a.id)
  if (!dir.exists) dir.create({ intermediates: true })
  const name = variant === 'full' ? `${a.name.replace(/\.[^.]+$/, '') || 'photo'}.webp` : a.name
  const target = new File(dir, name)
  if (target.exists && target.size > 0) return target
  return File.downloadFileAsync(attachmentUrl(conversationId, a, variant), target, { headers: authHeaders(), idempotent: true })
}

/** A file from a chat: opens Android's share sheet (save to Files or Drive, open in an app…). */
export async function shareFile(conversationId: string, a: Attachment): Promise<void> {
  if (Platform.OS === 'web') return void inform('Files open in the app', 'Downloading files works in the Glofly app on your phone.')
  try {
    const f = await download(conversationId, a, a.kind === 'image' ? 'full' : 'file')
    await Sharing.shareAsync(f.uri, { dialogTitle: a.name })
  } catch {
    void inform("Couldn't get the file", 'Check your connection and try again.')
  }
}

/** Saves a chat photo to the phone's gallery. */
export async function savePhoto(conversationId: string, a: Attachment): Promise<void> {
  if (Platform.OS === 'web') return void inform('Saving photos works in the app')
  try {
    // Loaded only on phones (it has no web version).
    const MediaLibrary = require('expo-media-library') as typeof import('expo-media-library')
    const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo'])
    if (!perm.granted) return void inform('Not allowed', 'Allow Glofly to save photos in Android Settings → Apps → Glofly → Permissions.')
    const f = await download(conversationId, a, 'full')
    await MediaLibrary.saveToLibraryAsync(f.uri)
    void inform('Saved', 'The photo is in your gallery.')
  } catch {
    void inform("Couldn't save the photo", 'Check your connection and try again.')
  }
}
