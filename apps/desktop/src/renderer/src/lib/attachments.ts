// Photos, files and voice messages. The summaries and sizes are shared with the mobile app
// (packages/shared/src/attachments.ts). The desktop app loads them through glofly-media://
// (fetched by its main process, see src/main/media.ts); a browser loads them straight from the
// Glofly server with the session cookie.
import { isWeb, web } from './platform'
export * from '@glofly/shared/attachments'

const server = isWeb && web ? web.apiUrl : null

/**
 * Can this browser decode Opus (what the desktop and Android apps record)? Safari can't always,
 * so it gets the server's AAC copy (the one the iPhone app plays).
 */
const opusOk = (): boolean => {
  try {
    const audio = document.createElement('audio')
    return (
      audio.canPlayType('audio/webm; codecs="opus"') !== '' &&
      audio.canPlayType('audio/ogg; codecs="opus"') !== ''
    )
  } catch {
    return false
  }
}
const voiceVariant = server ? (opusOk() ? 'file' : 'm4a') : 'voice'

/** Where a voice message plays from. */
export const voiceUrl = (conversationId: string, attachmentId: string): string =>
  server
    ? `${server}/conversations/${conversationId}/attachments/${attachmentId}/${voiceVariant}`
    : `glofly-media://attachments/${conversationId}/${attachmentId}/voice`

/** Where a photo in a chat loads from. */
export const photoUrl = (
  conversationId: string,
  attachmentId: string,
  variant: 'preview' | 'full'
): string =>
  server
    ? `${server}/conversations/${conversationId}/attachments/${attachmentId}/${variant}`
    : `glofly-media://attachments/${conversationId}/${attachmentId}/${variant}`
