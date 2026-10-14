import type { ApiResult, Attachment } from '../../../desktop/src/preload/api-types'
import { endSession, serverFetch } from './api'
import { isId, UNREACHABLE } from './config'

// Saving photos and files from chats: fetched with the session cookie, then handed to the
// browser as a download (it asks where, or puts it in Downloads, as the browser is set up).
// Files are never opened by Glofly.

const MAX_BYTES = 30 * 1024 * 1024

const HIDDEN_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/g

/** A safe name to suggest for the download. */
export function safeFileName(raw: string): string {
  const name = (raw.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(HIDDEN_CHARS, '')
    .replace(/[:*?"<>|]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 150)
  return name || 'file'
}

const asWebp = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`
}

export async function saveAttachment(
  conversationId: string,
  attachment: Attachment
): Promise<ApiResult<{ path: string } | null>> {
  if (!isId(conversationId) || !isId(attachment.id)) {
    return { ok: false, error: 'invalid', message: 'Something about that request was off.' }
  }
  const variant = attachment.kind === 'image' ? 'full' : 'file'
  let response: Response
  try {
    response = await serverFetch(
      'GET',
      `/conversations/${conversationId}/attachments/${attachment.id}/${variant}`,
      { timeoutMs: 120_000 }
    )
  } catch {
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }
  if (response.status === 401) {
    endSession()
    return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  }
  if (!response.ok) {
    return { ok: false, error: 'not_found', message: 'That file is no longer available.' }
  }
  const blob = await response.blob()
  if (blob.size > MAX_BYTES) {
    return { ok: false, error: 'server_error', message: "That file couldn't be saved." }
  }
  const name = safeFileName(attachment.kind === 'image' ? asWebp(attachment.name) : attachment.name)
  // Always a download (octet-stream), never shown or run by the browser.
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { ok: true, data: { path: name } }
}
