// Photos, files and voice messages: sizes and the short summaries shown for them.

import type { Attachment } from './types'
import { voiceTime } from './voice'

/** 1234567 → "1.2 MB" */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "Report.pdf" → "PDF" */
export function fileTypeLabel(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  return ext && ext.length <= 6 ? ext.toUpperCase() : 'File'
}

/** What to show for photos/files when there's no text: "Photo", "3 photos", "Report.pdf", "2 files". */
export function attachmentSummary(list: Pick<Attachment, 'kind' | 'name' | 'voice' | 'video'>[]): string {
  if (!list.length) return ''
  if (list.length === 1 && list[0].voice)
    return `Voice message (${voiceTime(list[0].voice.durationMs)})`
  const videos = list.filter((a) => a.video).length
  if (videos === list.length) return videos === 1 ? 'Video' : `${videos} videos`
  const photos = list.filter((a) => a.kind === 'image').length
  if (photos === list.length) return photos === 1 ? 'Photo' : `${photos} photos`
  if (photos === 0) return list.length === 1 ? list[0].name : `${list.length} files`
  return `${list.length} attachments`
}

/** Same, for a reply quote (which only knows the first attachment and how many there are). */
export function quoteSummary(a: {
  kind: 'image' | 'file'
  name: string
  count: number
  voice?: boolean
  video?: boolean
}): string {
  const first = a.voice ? 'Voice message' : a.video ? 'Video' : a.kind === 'image' ? 'Photo' : a.name
  return a.count > 1 ? `${first} and ${a.count - 1} more` : first
}

/** A file name that looks like a video Glofly can play in the chat (MP4, MOV, WebM). */
export const looksLikeVideo = (name: string): boolean => /\.(mp4|m4v|mov|webm)$/i.test(name)
