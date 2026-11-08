// GIFs (0.5.0), from GIPHY. A GIF message keeps only GIPHY's id; every app builds its addresses
// here (always GIPHY's own servers), so a message can never point an app anywhere else.

import { plainFormatted } from './format'
import type { GifInfo } from './types'

/** GIPHY ids: letters and numbers. */
export const isGifId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9]{5,40}$/.test(id)

/** A GIF picture on GIPHY's servers: 'small' for lists and chats (200 px wide), 'full' to open. */
export function gifUrl(id: string, size: 'small' | 'full' = 'small'): string {
  if (!isGifId(id)) return ''
  return `https://media.giphy.com/media/${id}/${size === 'small' ? '200w.webp' : 'giphy.webp'}`
}

/** The text a GIF message carries for older apps (and search): its GIPHY page. */
export const gifFallback = (g: Pick<GifInfo, 'id'>): string => `GIF: https://giphy.com/gifs/${g.id}`

/** A GIF the search found. */
export type GifResult = GifInfo

/** A GIF's size in a chat (fits a box, keeps its shape). */
export function gifSize(g: Pick<GifInfo, 'width' | 'height'>, max = 260): { width: number; height: number } {
  const w = g.width > 0 ? g.width : max
  const h = g.height > 0 ? g.height : max * 0.75
  const scale = Math.min(max / w, max / h, 2)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * How a message's text reads in a quote, a notification or the chat list: 0.5.0 GIFs, polls and
 * games carry a plain-text version for older apps, shortened here to what newer apps show.
 */
export function shortBody(body: string): string {
  if (/^GIF: https:\/\/giphy\.com\/gifs\/[A-Za-z0-9]+$/.test(body)) return 'GIF'
  if (body.startsWith('📊 Poll: ')) return body.split('\n')[0]
  if (body.startsWith('🎲 started ')) return body.replace(/ — play it in the newest Glofly$/, '')
  // 0.9.3: formatting markers come off and spoilers stay hidden in previews and pushes.
  return plainFormatted(body)
}
