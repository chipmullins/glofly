import { app, BrowserWindow, dialog, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { ApiResult } from '../preload/api-types'
import { API_URL, endSessionLocally, getSessionToken } from './auth'
import { disconnectRealtime } from './realtime'

// Saving photos and files from chats. Files are never opened by Glofly: they're saved
// where you choose, marked as coming from the internet (so Windows and Office treat
// them with the usual care), and you can show them in their folder.

const MAX_BYTES = 30 * 1024 * 1024
const saved = new Set<string>() // only files saved here can be shown in their folder

const HIDDEN_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** A safe name to suggest in the Save dialog. */
export function safeFileName(raw: string): string {
  let name = (raw.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(HIDDEN_CHARS, '')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 150)
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`
  return name || 'file'
}

/** Photos are stored as WebP, so they're saved as .webp. */
const asWebp = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`
}

export async function saveAttachment(
  window: BrowserWindow | null,
  conversationId: string,
  attachmentId: string,
  kind: 'image' | 'file',
  name: string
): Promise<ApiResult<{ path: string } | null>> {
  const token = getSessionToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }

  const suggested = safeFileName(kind === 'image' ? asWebp(name) : name)
  const options = { defaultPath: join(app.getPath('downloads'), suggested) }
  const choice = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (choice.canceled || !choice.filePath) return { ok: true, data: null }

  const variant = kind === 'image' ? 'full' : 'file'
  let response: Response
  try {
    response = await fetch(
      `${API_URL}/conversations/${conversationId}/attachments/${attachmentId}/${variant}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) }
    )
  } catch {
    return {
      ok: false,
      error: 'unreachable',
      message: "Can't reach Glofly right now. Check your connection and try again."
    }
  }
  if (response.status === 401) {
    disconnectRealtime()
    await endSessionLocally()
    return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  }
  if (!response.ok) {
    return { ok: false, error: 'not_found', message: 'That file is no longer available.' }
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.byteLength > MAX_BYTES) {
    return { ok: false, error: 'server_error', message: "That file couldn't be saved." }
  }

  try {
    await writeFile(choice.filePath, data)
  } catch {
    return {
      ok: false,
      error: 'server_error',
      message: "Couldn't save there. Try another folder."
    }
  }
  // Mark of the Web: Windows remembers the file came from the internet.
  if (process.platform === 'win32') {
    await writeFile(
      `${choice.filePath}:Zone.Identifier`,
      '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=about:internet\r\n'
    ).catch(() => undefined) // not possible on some drives (e.g. USB sticks); that's fine
  }
  saved.add(choice.filePath)
  return { ok: true, data: { path: choice.filePath } }
}

/** Opens File Explorer with a file Glofly just saved selected. Nothing else. */
export function showInFolder(path: string): void {
  if (saved.has(path)) shell.showItemInFolder(path)
}
