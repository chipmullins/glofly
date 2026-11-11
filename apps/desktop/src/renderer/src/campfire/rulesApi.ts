import { useEffect, useState } from 'react'
import type { BuilderRules, RulesItem, RulesSet } from '@glofly/shared/campfire/rulesData'
import { rulesOf } from '@glofly/shared/campfire/rulesData'
import type {
  CampaignSettings,
  SheetSpell,
  SrdSpell,
  SrdSpellSummary
} from '@glofly/shared/campfire/types'
import type { CampaignHub, Homebrew } from '@glofly/shared/campfire/hub'
import { cf } from './api'

// Round A: the rule set a campaign uses, its builder data (cached for the session), spells and
// items from that rule set, the campaign hub and its homebrew.

export const campaignRules = (settings: CampaignSettings): RulesSet => rulesOf(settings)

const builders = new Map<RulesSet, Promise<BuilderRules | null>>()
export function loadBuilder(rules: RulesSet): Promise<BuilderRules | null> {
  let p = builders.get(rules)
  if (!p) {
    p = cf
      .get<BuilderRules>(`/campfire/srd/builder?rules=${rules}`)
      .then((r) => (r.ok ? r.data : null))
    builders.set(rules, p)
    void p.then((d) => !d && builders.delete(rules))
  }
  return p
}

export function useBuilder(rules: RulesSet): BuilderRules | null {
  const [data, setData] = useState<BuilderRules | null>(null)
  useEffect(() => {
    let on = true
    void loadBuilder(rules).then((d) => on && setData(d))
    return () => {
      on = false
    }
  }, [rules])
  return data
}

export async function searchSpells(
  rules: RulesSet,
  q: string,
  opts: { level?: number; cls?: string } = {}
): Promise<SrdSpellSummary[]> {
  const params = new URLSearchParams({ rules, q })
  if (opts.level !== undefined) params.set('level', String(opts.level))
  if (opts.cls) params.set('class', opts.cls)
  const r = await cf.get<{ spells: SrdSpellSummary[] }>(`/campfire/srd/spells?${params}`)
  return r.ok ? r.data.spells : []
}

export async function spellDetails(rules: RulesSet, slug: string): Promise<SrdSpell | null> {
  const r = await cf.get<SrdSpell>(
    `/campfire/srd/spells/${encodeURIComponent(slug)}?rules=${rules}`
  )
  return r.ok ? r.data : null
}

export async function searchItems(rules: RulesSet, q: string, kind?: string): Promise<RulesItem[]> {
  const params = new URLSearchParams({ rules, q })
  if (kind) params.set('kind', kind)
  const r = await cf.get<{ items: RulesItem[] }>(`/campfire/srd/items?${params}`)
  return r.ok ? r.data.items : []
}

export async function loadHub(campaignId: string): Promise<CampaignHub | null> {
  const r = await cf.get<CampaignHub>(`/campfire/campaigns/${campaignId}/hub`)
  return r.ok ? r.data : null
}

export async function loadHomebrew(campaignId: string, kind?: string): Promise<Homebrew[]> {
  const r = await cf.get<{ homebrew: Homebrew[] }>(
    `/campfire/campaigns/${campaignId}/homebrew${kind ? `?kind=${kind}` : ''}`
  )
  return r.ok ? r.data.homebrew : []
}

/** A spell from the rules as a sheet spell (details filled in, roll from its damage). */
export function sheetSpellFrom(s: SrdSpell, prepared = true): SheetSpell {
  const dmg =
    s.damage?.bySlot?.[String(Math.max(s.level, 0))] ?? s.damage?.byCharacterLevel?.['1'] ?? null
  return {
    slug: s.slug,
    name: s.name,
    level: s.level,
    prepared,
    castingTime: s.castingTime.slice(0, 60),
    range: s.range.slice(0, 60),
    duration: s.duration.slice(0, 60),
    ...(s.concentration ? { concentration: true } : {}),
    ...(dmg && /^\d+d\d+([+-]\d+)?$/.test(dmg) ? { roll: dmg } : {}),
    notes: (s.desc.split(/(?<=\.)\s/)[0] ?? '').slice(0, 120)
  }
}
