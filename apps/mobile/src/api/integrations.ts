import type { ApiKeyInfo, ApiKeyLifetime, ConstellationCommand, IntegrationScope, WebhookInfo } from '@glofly/shared'
import { request } from './http'

// Communities round (Nov 2026): constellation Integrations, slash commands and bot buttons on
// phones (the same routes as the desktop app's lib/integrations.ts).

const base = (id: string) => `/constellations/${id}/integrations`

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
  load: (id: string) => request<{ keys: ApiKeyInfo[]; hooks: WebhookInfo[] }>('GET', base(id)),
  makeKey: (id: string, fields: KeyFields, password: string) => request<{ key: ApiKeyInfo; secret: string }>('POST', `${base(id)}/keys`, { ...fields, password }),
  resetKey: (id: string, keyId: string, password: string) => request<{ secret: string; prefix: string }>('POST', `${base(id)}/keys/${keyId}/reset`, { password }),
  deleteKey: (id: string, keyId: string) => request<{ ok: true }>('DELETE', `${base(id)}/keys/${keyId}`),
  commands: (id: string) => request<{ commands: ConstellationCommand[] }>('GET', `/constellations/${id}/commands`),
  runCommand: (id: string, nebulaId: string, input: string) =>
    request<{ ok: true; messageId: string; delivered: boolean }>('POST', `/constellations/${id}/commands/run`, { nebulaId, input }),
  clickButton: (id: string, messageId: string, buttonId: string) =>
    request<{ ok: true; delivered: boolean }>('POST', `/constellations/${id}/messages/${messageId}/buttons/${buttonId}`),
}
