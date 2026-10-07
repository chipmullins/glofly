/** Address of a profile photo. The main process fetches it (see src/main/media.ts). */
export const avatarUrl = (userId: string, version: string): string =>
  `glofly-media://avatars/${userId}/${version}`
