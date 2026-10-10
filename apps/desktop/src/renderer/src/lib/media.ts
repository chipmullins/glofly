/** Address of a profile photo. The main process fetches it (see src/main/media.ts). */
export const avatarUrl = (userId: string, version: string): string =>
  `glofly-media://avatars/${userId}/${version}`

/** Where a group photo loads from (fetched by the main process, see src/main/media.ts). */
export const groupPhotoUrl = (conversationId: string, version: string): string =>
  `glofly-media://groups/${conversationId}/${version}`
