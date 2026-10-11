// Photos, files and voice messages. The summaries and sizes are shared with the mobile app
// (packages/shared/src/attachments.ts); the glofly-media addresses are desktop only.
export * from '@glofly/shared/attachments'

/** Where a voice message plays from (fetched by the main process, see src/main/media.ts). */
export const voiceUrl = (conversationId: string, attachmentId: string): string =>
  `glofly-media://attachments/${conversationId}/${attachmentId}/voice`

/** Where a photo in a chat loads from (fetched by the main process, see src/main/media.ts). */
export const photoUrl = (
  conversationId: string,
  attachmentId: string,
  variant: 'preview' | 'full'
): string => `glofly-media://attachments/${conversationId}/${attachmentId}/${variant}`
