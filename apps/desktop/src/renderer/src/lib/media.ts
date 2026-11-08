import { isWeb, web } from './platform'

// Profile and group photos. The desktop app's main process fetches them with the session token
// (see src/main/media.ts) behind glofly-media:// addresses. In a browser they load straight from
// the Glofly server, which accepts the session cookie (and only from glofly.app pages).

const server = isWeb && web ? web.apiUrl : null

/** Address of a profile photo. */
export const avatarUrl = (userId: string, version: string): string =>
  server ? `${server}/avatars/${userId}/${version}` : `glofly-media://avatars/${userId}/${version}`

/** 0.9.1: a profile's header image. */
export const headerUrl = (userId: string, version: string): string =>
  server ? `${server}/headers/${userId}/${version}` : `glofly-media://headers/${userId}/${version}`

/** 0.9.1: a game's box art (IGDB, served by Glofly). */
export const gameCoverUrl = (id: string): string =>
  server ? `${server}/games/cover/${id}` : `glofly-media://game-covers/${id}`

/** Where a group photo loads from. */
export const groupPhotoUrl = (conversationId: string, version: string): string =>
  server
    ? `${server}/conversations/${conversationId}/photo/${version}`
    : `glofly-media://groups/${conversationId}/${version}`

/** 0.7.5: a constellation's banner photo. */
export const constellationBannerUrl = (constellationId: string, version: string): string =>
  server
    ? `${server}/constellations/${constellationId}/banner/${version}`
    : `glofly-media://constellation-banners/${constellationId}/${version}`

/** 2.0: a constellation's icon photo. */
export const constellationIconUrl = (constellationId: string, version: string): string =>
  server
    ? `${server}/constellations/${constellationId}/icon/${version}`
    : `glofly-media://constellation-icons/${constellationId}/${version}`
