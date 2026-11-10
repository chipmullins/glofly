import type { ApiResult } from '../../../preload/api-types'
import type { CampfireFile, CampfireFileKind } from '@glofly/shared/campfire/types'
import { isWeb, web } from '../lib/platform'

// Campfire's way to the server: one gateway (/campfire/… only, desktop main process or the web
// bridge), uploads by kind, live token drags, and the address of a table's files.

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export function cfRequest<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
  return window.glofly.campfire.request<T>(method, path, body)
}

export const cf = {
  get: <T>(path: string) => cfRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => cfRequest<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => cfRequest<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => cfRequest<T>('PUT', path, body),
  del: <T>(path: string) => cfRequest<T>('DELETE', path)
}

const server = isWeb && web ? web.apiUrl : null

/** A table's picture or music track: the server checks who may have it. */
export const fileUrl = (fileId: string): string =>
  server ? `${server}/campfire/files/${fileId}` : `glofly-media://campfire/${fileId}`

const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav'
}

/** The file's type (browsers leave it empty for some music files: then by its extension). */
function typeOf(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type || EXT_TYPES[ext] || 'application/octet-stream'
}

/** Uploads a file to a campaign (the main process / bridge checks kind, type and size first). */
export async function uploadFile(
  campaignId: string,
  kind: CampfireFileKind,
  file: File
): Promise<ApiResult<CampfireFile>> {
  const data = await file.arrayBuffer()
  return window.glofly.campfire.upload(campaignId, kind, data, typeOf(file))
}

/** Opens the system's file picker; resolves with the chosen file (or null). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let done = false
    input.addEventListener('change', () => {
      done = true
      resolve(input.files?.[0] ?? null)
      input.remove()
    })
    // No change: the picker was closed (resolve when the window gets focus back).
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!done) resolve(null)
        }, 800),
      { once: true }
    )
    document.body.appendChild(input)
    input.click()
  })
}

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
export const AUDIO_ACCEPT = '.mp3,.ogg,.m4a,.wav,audio/mpeg,audio/ogg,audio/mp4,audio/wav'

/** Reduce Motion: no movement, only fades and glows. */
export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A short random id for map builder pieces. */
export const pieceId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
