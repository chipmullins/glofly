import type { BuilderRules, CampaignHub, Character, Homebrew, RulesItem, RulesSet, Sheet5e, SessionRsvp, SrdSpell, SrdSpellSummary } from '@glofly/shared'
import { withHomebrew } from '@glofly/shared'
import { request } from '@/api/http'

// Campfire Round A on phones: the rules the builder uses (either rule set, plus the campaign's
// shared homebrew), the campaign hub, RSVPs and leveling up. Same routes as the desktop app.

const enc = encodeURIComponent
const builders = new Map<RulesSet, Promise<BuilderRules | null>>()

export function loadBuilder(rules: RulesSet): Promise<BuilderRules | null> {
  let p = builders.get(rules)
  if (!p) {
    p = request<BuilderRules>('GET', `/campfire/srd/builder?rules=${rules}`).then((r) => {
      if (!r.ok) builders.delete(rules)
      return r.ok ? r.data : null
    })
    builders.set(rules, p)
  }
  return p
}

/** The builder's rules with the campaign's shared homebrew species and backgrounds. */
export async function builderFor(campaignId: string, rules: RulesSet): Promise<BuilderRules | null> {
  const [data, brew] = await Promise.all([loadBuilder(rules), homebrew(campaignId)])
  return data ? withHomebrew(data, brew) : null
}

export async function homebrew(campaignId: string, kind?: string): Promise<Homebrew[]> {
  const r = await request<{ homebrew: Homebrew[] }>('GET', `/campfire/campaigns/${enc(campaignId)}/homebrew${kind ? `?kind=${kind}` : ''}`)
  return r.ok ? r.data.homebrew : []
}

export const roundA = {
  hub: (campaignId: string) => request<CampaignHub>('GET', `/campfire/campaigns/${enc(campaignId)}/hub`),
  rsvp: (sessionId: string, answer: SessionRsvp) => request<unknown>('PUT', `/campfire/sessions/${enc(sessionId)}/rsvp`, { answer }),
  makeCharacter: (campaignId: string, name: string, sheet: Sheet5e) => request<Character>('POST', `/campfire/campaigns/${enc(campaignId)}/characters`, { kind: 'pc', name, sheet }),
  saveSheet: (characterId: string, sheet: Sheet5e) => request<Character>('PATCH', `/campfire/characters/${enc(characterId)}`, { sheet }),
  roll: (campaignId: string, expression: string, label: string, characterId: string) =>
    request<{ total: number }>('POST', `/campfire/campaigns/${enc(campaignId)}/rolls`, { expression, label, characterId, visibility: 'all' }),
  /** 0.11.4: every non-magic item (class starting gear and its shop) */
  mundaneItems: async (rules: RulesSet): Promise<RulesItem[]> => {
    const r = await request<{ items: RulesItem[] }>('GET', `/campfire/srd/items/mundane?rules=${rules}`)
    return r.ok ? r.data.items : []
  },
  items: async (rules: RulesSet, q: string): Promise<RulesItem[]> => {
    const r = await request<{ items: RulesItem[] }>('GET', `/campfire/srd/items?rules=${rules}&q=${enc(q)}`)
    return r.ok ? r.data.items : []
  },
  spells: async (rules: RulesSet, q: string, opts: { level?: number; cls?: string } = {}): Promise<SrdSpellSummary[]> => {
    const p = [`rules=${rules}`, `q=${enc(q)}`, opts.level !== undefined ? `level=${opts.level}` : '', opts.cls ? `class=${enc(opts.cls)}` : ''].filter(Boolean).join('&')
    const r = await request<{ spells: SrdSpellSummary[] }>('GET', `/campfire/srd/spells?${p}`)
    return r.ok ? r.data.spells : []
  },
  spell: async (rules: RulesSet, slug: string): Promise<SrdSpell | null> => {
    const r = await request<SrdSpell>('GET', `/campfire/srd/spells/${enc(slug)}?rules=${rules}`)
    return r.ok ? r.data : null
  },
}
