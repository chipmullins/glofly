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

// ───────────── Webhooks ─────────────

/** Events an outgoing webhook can send. Never message contents. */
export type WebhookEvent = 'member.joined' | 'member.left' | 'member.roles'
export const WEBHOOK_EVENTS: readonly { id: WebhookEvent; name: string }[] = [
  { id: 'member.joined', name: 'Member joined' },
  { id: 'member.left', name: 'Member left (or was removed)' },
  { id: 'member.roles', name: "Someone's roles changed" }
]
export const isWebhookEvent = (s: unknown): s is WebhookEvent =>
  typeof s === 'string' && WEBHOOK_EVENTS.some((e) => e.id === s)

export const WEBHOOKS_PER_CONSTELLATION_MAX = 10
/** Outgoing webhooks switch themselves off after this many failed deliveries in a row. */
export const WEBHOOK_FAILURES_MAX = 50

export type WebhookInfo = {
  id: string
  kind: 'incoming' | 'outgoing'
  name: string
  /** incoming */
  nebulaId: string | null
  botUserId: string | null
  /** incoming: the bot's role (null = only Member) */
  roleId: string | null
  /** outgoing */
  url: string | null
  events: WebhookEvent[]
  createdAt: string
  lastUsedAt: string | null
  lastStatus: number | null
  failures: number
  disabled: boolean
}

/**
 * What an outgoing webhook receives (POST, JSON). Check it came from Glofly: the header
 * `Glofly-Signature: t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${body}`);
 * refuse anything older than 5 minutes.
 */
export type WebhookPayload = {
  id: string
  type: WebhookEvent | 'ping'
  constellationId: string
  createdAt: string
  data: {
    user?: { id: string; username: string; displayName: string }
    roleIds?: string[]
  }
}

// ───────────── Bots in chats: buttons, slash commands, interactions ─────────────

export type MessageButtonStyle = 'primary' | 'secondary' | 'danger'
/** A button under a bot's message. Clicking it tells the bot; Glofly checks nothing else. */
export type MessageButton = { id: string; label: string; style: MessageButtonStyle }
export const MESSAGE_BUTTONS_MAX = 5
export const MESSAGE_BUTTON_LABEL_MAX = 40
export const MESSAGE_BUTTON_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Slash command names: what follows the /, lower case. */
export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
export const COMMAND_DESCRIPTION_MAX = 100
export const COMMANDS_PER_KEY_MAX = 25
/** What can follow the command name ("/whitelist apply" → "apply"). */
export const COMMAND_TEXT_MAX = 500

/** A slash command in a constellation's / menu. */
export type ConstellationCommand = {
  name: string
  description: string
  bot: { id: string; displayName: string; avatarVersion: string | null }
}

/** "/whitelist apply" → { name: 'whitelist', text: 'apply' } (null if it isn't a command). */
export function parseSlashCommand(input: string): { name: string; text: string } | null {
  const m = /^\/([a-z0-9][a-z0-9-]{0,31})(?:\s+([\s\S]*))?$/i.exec(input.trim())
  if (!m) return null
  return { name: m[1].toLowerCase(), text: (m[2] ?? '').trim() }
}

/**
 * What a bot's interactions address receives (POST, JSON), signed like outgoing webhooks
 * (`Glofly-Signature`, with the secret from PUT /api/v1/interactions). Answer with 2xx quickly and
 * reply through the API (POST /api/v1/nebulas/:nebulaId/messages, replyToId = messageId).
 */
export type InteractionPayload = {
  id: string
  type: 'command' | 'button' | 'ping'
  constellationId: string
  nebulaId: string | null
  /** command: the member's message ("/whitelist apply"); button: the bot's message */
  messageId: string | null
  user: { id: string; username: string; displayName: string } | null
  /** The member's roles (ids), for the bot's own checks */
  roleIds: string[]
  command?: { name: string; text: string }
  button?: { id: string }
  createdAt: string
}
