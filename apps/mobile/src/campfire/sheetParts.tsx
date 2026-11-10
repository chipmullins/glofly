import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { SheetSpell, SrdSpell } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { campfireApi } from './api'
import { useFire } from './lib'

// Pieces the phone character sheet and the monster stat block share (SheetPhone / SheetNpc boards).

export type RollMode = 'normal' | 'adv' | 'dis'

/** A d20 roll with advantage or disadvantage: the first 1d20 becomes 2d20kh1 / 2d20kl1. */
export function withMode(expr: string, mode: RollMode): string {
  if (mode === 'normal') return expr
  return expr.replace(/^1?d20(?![0-9])/i, mode === 'adv' ? '2d20kh1' : '2d20kl1')
}
export const modeLabel = (label: string, mode: RollMode): string => (mode === 'adv' ? `${label} (advantage)` : mode === 'dis' ? `${label} (disadvantage)` : label)

/** Normal / Advantage / Disadvantage for every d20 the sheet rolls. */
export function RollModeSwitch({ mode, onChange }: { mode: RollMode; onChange: (m: RollMode) => void }) {
  const fire = useFire()
  const opts: [RollMode, string][] = [
    ['normal', 'Normal'],
    ['adv', 'Advantage'],
    ['dis', 'Disadvantage'],
  ]
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text size={12} style={{ color: fire.muted }}>
        Roll with
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Roll with" style={{ flex: 1, flexDirection: 'row', gap: 4, padding: 3, borderRadius: 12, backgroundColor: fire.well }}>
        {opts.map(([k, label]) => {
          const on = k === mode
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Roll with ${label.toLowerCase()}`}
              onPress={() => onChange(k)}
              style={{ flex: 1, height: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (k === 'adv' ? fire.healSoft : k === 'dis' ? fire.hurtSoft : fire.amberSoft) : 'transparent' }}
            >
              <Text size={12} weight="bold" numberOfLines={1} style={{ color: on ? (k === 'adv' ? fire.healText : k === 'dis' ? fire.hurtText : fire.amber) : fire.muted }}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** The sheet's section tabs (Overview / Actions / Spells / More). */
export function SheetTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly [T, string][]; value: T; onChange: (t: T) => void }) {
  const fire = useFire()
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Sheet sections" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: fire.well }}>
      {tabs.map(([k, label]) => {
        const on = k === value
        return (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            onPress={() => onChange(k)}
            style={{ flex: 1, height: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? fire.amberSoft : 'transparent' }}
          >
            <Text size={13} weight="bold" numberOfLines={1} style={{ color: on ? fire.amber : fire.muted }}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// SRD spell details (casting time, range, concentration, dice) for spells on a sheet: looked up by
// slug, or by the exact name when the sheet has none. Kept for the app's lifetime.
const spellCache = new Map<string, SrdSpell | null>()
const inflight = new Map<string, Promise<SrdSpell | null>>()

async function lookUp(sp: SheetSpell): Promise<SrdSpell | null> {
  const key = sp.slug ?? `name:${sp.name.toLowerCase()}`
  if (spellCache.has(key)) return spellCache.get(key) ?? null
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    let slug = sp.slug
    if (!slug) {
      const r = await campfireApi.srdSpells(sp.name)
      slug = r.ok ? (r.data.spells.find((x) => x.name.toLowerCase() === sp.name.toLowerCase())?.slug ?? null) : null
    }
    const r = slug ? await campfireApi.srdSpell(slug) : null
    const found = r && r.ok ? r.data : null
    spellCache.set(key, found)
    inflight.delete(key)
    return found
  })()
  inflight.set(key, p)
  return p
}

export function useSrdSpells(spells: SheetSpell[]): Record<string, SrdSpell | null> {
  const [found, setFound] = useState<Record<string, SrdSpell | null>>({})
  const names = spells.map((s) => `${s.slug ?? ''}|${s.name}`).join(',')
  useEffect(() => {
    let live = true
    for (const sp of spells) {
      void lookUp(sp).then((r) => {
        if (live) setFound((f) => (f[sp.name] === r ? f : { ...f, [sp.name]: r }))
      })
    }
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names])
  return found
}

/** The dice a spell rolls at a slot level (or, for cantrips, at the character's level). */
export function spellDice(srd: SrdSpell | null | undefined, slotLevel: number, charLevel: number, spellMod: number): { expr: string; heal: boolean } | null {
  if (!srd) return null
  const d = srd.damage
  if (d?.bySlot) {
    const keys = Object.keys(d.bySlot).map(Number).filter((n) => n <= Math.max(slotLevel, srd.level)).sort((a, b) => b - a)
    const k = keys[0] ?? Number(Object.keys(d.bySlot)[0])
    if (d.bySlot[String(k)]) return { expr: d.bySlot[String(k)].replace(/\s+/g, ''), heal: false }
  }
  if (d?.byCharacterLevel) {
    const keys = Object.keys(d.byCharacterLevel).map(Number).filter((n) => n <= charLevel).sort((a, b) => b - a)
    const k = keys[0] ?? Number(Object.keys(d.byCharacterLevel)[0])
    if (d.byCharacterLevel[String(k)]) return { expr: d.byCharacterLevel[String(k)].replace(/\s+/g, ''), heal: false }
  }
  // Healing spells say it in words: "regains … hit points equal to 1d8 + your spellcasting ability modifier".
  const m = /regains?[^.]*?hit points equal to (\d+d\d+)( \+ your spellcasting ability modifier)?/i.exec(srd.desc)
  if (m) {
    const extra = Math.max(0, slotLevel - srd.level)
    const [n, die] = m[1].split('d').map(Number)
    const dice = `${n + n * (/increases by \d+d\d+ for each slot level/i.test(srd.higherLevel) ? extra : 0)}d${die}`
    return { expr: m[2] ? (spellMod >= 0 ? `${dice}+${spellMod}` : `${dice}-${-spellMod}`) : dice, heal: true }
  }
  return null
}

/** Fields a newer sheet may carry (the desktop sheet may add them); shown only when present. */
export type SpellExtras = { concentration?: boolean; castingTime?: string; range?: string; duration?: string; notes?: string }
export type SheetExtras = { inspiration?: boolean; xp?: number }
