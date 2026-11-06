// Communities round (Nov 2026): constellation Integrations. API keys for bots and game servers,
// each locked to one constellation. Approved mockups: the "Glofly communities round: Integrations,
// bots & Sign in with Glofly" canvas (boards 1–4, 11). The server checks every rule here again.

/** What a key may do. Anything not listed is refused. */
export type IntegrationScope =
  | 'members:read'
  | 'link'
  | 'messages:write'
  | 'roles:write'
  | 'commands'
  | 'messages:read'

export const INTEGRATION_SCOPES: readonly { id: IntegrationScope; name: string; what: string }[] = [
  {
    id: 'members:read',
    name: 'Read members & roles',
    what: 'Look up who is in the constellation and their roles. Never emails, friends or messages.'
  },
  {
    id: 'link',
    name: 'Link game accounts',
    what: 'Give players a one-time code to link their Glofly account to your server.'
  },
  {
    id: 'messages:write',
    name: 'Post in nebulas you pick',
    what: 'Send messages (with buttons) into the nebulas you pick.'
  },
  {
    id: 'roles:write',
    name: 'Give and take roles',
    what: 'Only roles below its own, like a person with Manage roles.'
  },
  {
    id: 'commands',
    name: 'Slash commands',
    what: 'Add commands like /whitelist that members can use in the message box.'
  },
  {
    id: 'messages:read',
    name: 'Read messages in nebulas you pick',
    what: 'Only for bridges (like Discord). Members of those nebulas see a notice.'
  }
]

export const isIntegrationScope = (s: unknown): s is IntegrationScope =>
  typeof s === 'string' && INTEGRATION_SCOPES.some((x) => x.id === s)

/** Scopes that need a list of nebulas. */
export const NEBULA_SCOPES: readonly IntegrationScope[] = ['messages:write', 'messages:read']

/** Keys look like `gfk_<43 base64url characters>`; the part shown in lists is `gfk_` + 8. */
export const API_KEY_PREFIX = 'gfk_'
export const API_KEY_PATTERN = /^gfk_[A-Za-z0-9_-]{43}$/
export const apiKeyShown = (prefix: string): string => `${prefix}••••••••`

export const API_KEY_NAME_MAX = 40
export const API_KEYS_PER_CONSTELLATION_MAX = 10
export const API_KEY_ALLOWED_IPS_MAX = 10

export type ApiKeyLifetime = 'never' | '30d' | '90d' | '1y'
export const API_KEY_LIFETIMES: readonly { id: ApiKeyLifetime; name: string; days: number | null }[] = [
  { id: 'never', name: 'Never (until you reset it)', days: null },
  { id: '30d', name: 'In 30 days', days: 30 },
  { id: '90d', name: 'In 90 days', days: 90 },
  { id: '1y', name: 'In a year', days: 365 }
]

/** A key as the Integrations page lists it (never the key itself). */
export type ApiKeyInfo = {
  id: string
  name: string
  /** `gfk_` + its first 8 characters */
  prefix: string
  bot: { id: string; displayName: string; avatarVersion: string | null }
  /** The bot's role (null = only Member) */
  roleId: string | null
  scopes: IntegrationScope[]
  /** Nebulas it may post in (messages:write) */
  postNebulaIds: string[]
  /** Nebulas it may read (messages:read) */
  readNebulaIds: string[]
  allowedIps: string[]
  expiresAt: string | null
  createdAt: string
  createdBy: { id: string; displayName: string } | null
  lastUsedAt: string | null
}

/** One line of a constellation's Integrations → Activity. */
export type IntegrationActivity = {
  id: string
  at: string
  keyId: string | null
  keyName: string | null
  /** e.g. 'member.lookup', 'message.post', 'key.created', 'key.reset' */
  action: string
  /** A plain sentence for the page */
  text: string
  from: string | null
}
