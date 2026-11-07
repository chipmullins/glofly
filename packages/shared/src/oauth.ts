// Communities round (Nov 2026): Sign in with Glofly (OAuth 2.0 + OpenID Connect). Approved
// mockups: the "Glofly communities round" canvas, boards 5, 6, 10, 12 and 14. The server checks
// every rule here again.

/** What an app can ask for. Name and photo ("profile") always come with signing in. */
export type OAuthScope = 'openid' | 'profile' | 'email' | 'roles'
/** Scopes a developer can turn on for their app (openid and profile are always allowed). */
export const OAUTH_OPTIONAL_SCOPES: readonly { id: 'email' | 'roles'; name: string; what: string }[] = [
  { id: 'email', name: 'Email', what: 'Your email address (only if you agree each time).' },
  { id: 'roles', name: 'Roles in constellations', what: 'Your roles in constellations you pick.' }
]
export const isOAuthScope = (s: unknown): s is OAuthScope =>
  s === 'openid' || s === 'profile' || s === 'email' || s === 'roles'

export const OAUTH_APP_NAME_MAX = 40
export const OAUTH_REDIRECTS_MAX = 5
export const OAUTH_APPS_PER_DEVELOPER_MAX = 10

/**
 * A return address an app may register. https anywhere; http only on this computer (for
 * developing, RFC 8252); or a phone app's own scheme ("gloslate://auth"). Never javascript:, data:,
 * file: or a fragment.
 */
export function redirectUriProblem(uri: string): string | null {
  // Parsed by hand: this module runs where URL may not exist (the shared build has no DOM/Node types).
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#\s]*)([^#\s]*)(#.*)?$/.exec(uri)
  if (!m) return 'That isn’t an address (like https://example.com/auth/glofly/callback).'
  if (uri.length > 300) return 'Return addresses can be up to 300 characters.'
  const [, rawScheme, authority, , hash] = m
  const scheme = rawScheme.toLowerCase()
  if (hash) return 'Leave out the # part.'
  if (authority.includes('@')) return 'Leave the user name and password out of the address.'
  const host = authority.replace(/:\d+$/, '').toLowerCase()
  if (scheme === 'https') return host ? null : 'That isn’t an address (like https://example.com/auth/glofly/callback).'
  if (scheme === 'http') {
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
      ? null
      : 'Use https (http only works for localhost while developing).'
  }
  if (['javascript', 'data', 'file', 'vbscript', 'blob', 'about', 'ftp', 'ws', 'wss'].includes(scheme))
    return 'That kind of address can’t be used.'
  // A phone app's own scheme ("gloslate"): letters, digits, + - .
  return /^[a-z][a-z0-9+.-]{2,}$/.test(scheme) ? null : 'That kind of address can’t be used.'
}

/**
 * The Glofly Developer Terms (glofly.app/developer-terms) people agree to when they make a
 * Sign in with Glofly app. Bump when the terms change in a way developers must agree to again.
 */
export const DEVELOPER_TERMS_VERSION = '2026-11-07'
export const DEVELOPER_TERMS_URL = 'https://glofly.app/developer-terms'

/** An app in Settings → Developer. */
export type DeveloperApp = {
  id: string
  clientId: string
  name: string
  website: string | null
  /** The app's own privacy policy (https; required for new apps) and terms, linked on the consent page */
  privacyUrl: string | null
  termsUrl: string | null
  /** The Developer Terms version its maker agreed to (null: not yet) */
  devTermsVersion: string | null
  redirectUris: string[]
  scopes: ('email' | 'roles')[]
  /** A server app (has a client secret) or a phone/browser app (none; PKCE only) */
  confidential: boolean
  firstParty: boolean
  disabled: boolean
  disabledReason: string | null
  /** People who allowed it */
  people: number
  createdAt: string
}

/** An app in Settings → Connected apps. */
export type ConnectedApp = {
  appId: string
  name: string
  website: string | null
  firstParty: boolean
  scopes: OAuthScope[]
  /** Constellations whose roles it can see (names) */
  constellations: string[]
  since: string
  lastUsedAt: string | null
}

/** What the consent page shows (GET /oauth/request). */
export type OAuthRequestInfo = {
  app: { name: string; website: string | null; firstParty: boolean; madeBy: string | null; privacyUrl?: string | null; termsUrl?: string | null }
  scopes: OAuthScope[]
  /** "roles": constellations you're in, to pick from (ones allowed before are ticked) */
  constellations: { id: string; name: string; picked: boolean }[]
  /** Allowed before with the same scopes: the page can say "Continue" */
  allowedBefore: boolean
}
