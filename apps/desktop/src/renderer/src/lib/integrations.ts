import type {
  ApiKeyInfo,
  ApiKeyLifetime,
  ApiResult,
  ConstellationCommand,
  IntegrationActivity,
  IntegrationScope,
  WebhookEvent,
  WebhookInfo
} from '@glofly/shared'

// Communities round (Nov 2026): constellation settings → Integrations, slash commands and bot
// buttons. Everything goes through window.glofly.constellations.request (only /constellations/…).

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const call = <T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> =>
  window.glofly.constellations.request<T>(method, path, body)
const base = (id: string): string => `/constellations/${id}/integrations`

export type KeyFields = {
  name: string
  roleId: string | null
  scopes: IntegrationScope[]
  postNebulaIds: string[]
  readNebulaIds: string[]
  allowedIps: string[]
  lifetime: ApiKeyLifetime
}

export const integrations = {
  load: (id: string) => call<{ keys: ApiKeyInfo[]; hooks: WebhookInfo[] }>('GET', base(id)),
  activity: (id: string, before?: string) =>
    call<{ items: IntegrationActivity[] }>(
      'GET',
      `${base(id)}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`
    ),
  makeKey: (id: string, fields: KeyFields, password: string) =>
    call<{ key: ApiKeyInfo; secret: string }>('POST', `${base(id)}/keys`, { ...fields, password }),
  changeKey: (id: string, keyId: string, fields: Partial<KeyFields>, password: string) =>
    call<{ key: ApiKeyInfo }>('PATCH', `${base(id)}/keys/${keyId}`, { ...fields, password }),
  resetKey: (id: string, keyId: string, password: string) =>
    call<{ secret: string; prefix: string }>('POST', `${base(id)}/keys/${keyId}/reset`, { password }),
  deleteKey: (id: string, keyId: string) => call<{ ok: true }>('DELETE', `${base(id)}/keys/${keyId}`),
  makeIncoming: (id: string, v: { name: string; nebulaId: string; roleId: string | null }, password: string) =>
    call<{ hook: WebhookInfo; url: string }>('POST', `${base(id)}/hooks`, { kind: 'incoming', ...v, password }),
  makeOutgoing: (id: string, v: { name: string; url: string; events: WebhookEvent[] }, password: string) =>
    call<{ hook: WebhookInfo; secret: string }>('POST', `${base(id)}/hooks`, { kind: 'outgoing', ...v, password }),
  changeHook: (
    id: string,
    hookId: string,
    v: Partial<{ name: string; url: string; events: WebhookEvent[]; enabled: boolean }>,
    password: string
  ) => call<{ hook: WebhookInfo }>('PATCH', `${base(id)}/hooks/${hookId}`, { ...v, password }),
  resetHook: (id: string, hookId: string, password: string) =>
    call<{ url?: string; secret?: string }>('POST', `${base(id)}/hooks/${hookId}/reset`, { password }),
  testHook: (id: string, hookId: string) =>
    call<{ status: number; ok: boolean }>('POST', `${base(id)}/hooks/${hookId}/test`),
  deleteHook: (id: string, hookId: string) => call<{ ok: true }>('DELETE', `${base(id)}/hooks/${hookId}`),
  // Members
  commands: (id: string) =>
    call<{ commands: ConstellationCommand[] }>('GET', `/constellations/${id}/commands`),
  runCommand: (id: string, nebulaId: string, input: string) =>
    call<{ ok: true; messageId: string; delivered: boolean }>('POST', `/constellations/${id}/commands/run`, {
      nebulaId,
      input
    }),
  clickButton: (id: string, messageId: string, buttonId: string) =>
    call<{ ok: true; delivered: boolean }>(
      'POST',
      `/constellations/${id}/messages/${messageId}/buttons/${buttonId}`
    )
}
