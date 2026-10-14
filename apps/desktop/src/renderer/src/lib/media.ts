import { isWeb, web } from './platform'

// Profile and group photos. The desktop app's main process fetches them with the session token
// (see src/main/media.ts) behind glofly-media:// addresses. In a browser they load straight from
// the Glofly server, which accepts the session cookie (and only from glofly.app pages).

const server = isWeb && web ? web.apiUrl : null

/** Address of a profile photo. */
export const avatarUrl = (userId: string, version: string): string =>
  server ? `${server}/avatars/${userId}/${version}` : `glofly-media://avatars/${userId}/${version}`

/** Where a group photo loads from. */
export const groupPhotoUrl = (conversationId: string, version: string): string =>
  server
    ? `${server}/conversations/${conversationId}/photo/${version}`
    : `glofly-media://groups/${conversationId}/${version}`
