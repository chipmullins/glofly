import { useEffect, useRef, useState } from 'react'
import type { Character, Roll, Sheet5e, SheetSpell, SrdSpell } from '@glofly/shared/campfire/types'
import { abilityMod, totalLevel, withBonus } from '@glofly/shared/campfire/rules5e'
import { cf } from './api'
import { useCf } from './ctx'

// What the sheet window, the Sheet tab and the stat block share: editing a sheet (saved a moment
// after the last change), rolling and getting the total back, and spell details from the rules.

const SAVE_DELAY = 700

export type SheetEditor = {
  sheet: Sheet5e
  /** Shows the new sheet at once and saves it a moment later */
  save: (next: Sheet5e) => void
  set: <K extends keyof Sheet5e>(k: K, v: Sheet5e[K]) => void
  /** Saves now (rests, damage: things the server answers with a new sheet) */
  flush: () => Promise<void>
  patchChar: (body: Record<string, unknown>) => Promise<Character | null>
  canEdit: boolean
  /** A player on a sheet the GM locked: HP max and AC can't change */
  lockedField: boolean
}

export function useSheetEditor(ch: Character): SheetEditor {
  const { isGm, me, say, ctl } = useCf()
  const [sheet, setSheet] = useState<Sheet5e>(ch.sheet)
  const pending = useRef<number | null>(null)
  const latest = useRef<Sheet5e | null>(null)
  const dirty = useRef(false)
  const canEdit = isGm || ch.ownerId === me.id

  // A change from the server (damage, rests, another device) shows unless I'm mid-edit.
  useEffect(() => {
    if (!dirty.current) setSheet(ch.sheet)
  }, [ch.sheet])

  const store = (r: Character): void =>
    ctl.update((s) => ({ ...s, characters: s.characters.map((c) => (c.id === r.id ? r : c)) }))

  const send = async (next: Sheet5e): Promise<void> => {
    const r = await cf.patch<Character>(`/campfire/characters/${ch.id}`, { sheet: next })
    if (latest.current === next) {
      dirty.current = false
      latest.current = null
    }
    if (!r.ok) say(r.message)
    else if (!dirty.current) store(r.data)
  }
  const flush = async (): Promise<void> => {
    if (pending.current) window.clearTimeout(pending.current)
    pending.current = null
    if (latest.current) await send(latest.current)
  }
  useEffect(
    () => () => {
      // Leaving with a change still waiting: save it now.
      if (pending.current) {
        window.clearTimeout(pending.current)
        if (latest.current)
          void cf.patch(`/campfire/characters/${ch.id}`, { sheet: latest.current })
      }
    },
    [ch.id]
  )

  const save = (next: Sheet5e): void => {
    setSheet(next)
    dirty.current = true
    latest.current = next
    if (pending.current) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      void send(next)
    }, SAVE_DELAY)
  }
  const patchChar = async (body: Record<string, unknown>): Promise<Character | null> => {
    const r = await cf.patch<Character>(`/campfire/characters/${ch.id}`, body)
    if (!r.ok) {
      say(r.message)
      return null
    }
    store(r.data)
    return r.data
  }
  return {
    sheet,
    save,
    set: (k, v) => save({ ...sheet, [k]: v }),
    flush,
    patchChar,
    canEdit,
    lockedField: !isGm && sheet.locked
  }
}

export type RollWith = 'normal' | 'adv' | 'dis'
export const d20For = (w: RollWith): string =>
  w === 'adv' ? '2d20kh1' : w === 'dis' ? '2d20kl1' : '1d20'
/** "1d20+7" rolled with advantage → "2d20kh1+7". */
export const withD20 = (expr: string, w: RollWith): string => expr.replace(/^1d20/, d20For(w))

/** Rolls at the table and gives the roll back (for numbers the sheet uses: HP, healing). */
export function useRollNow(): (
  expression: string,
  opts: { label: string; characterId?: string | null; gmOnly?: boolean }
) => Promise<Roll | null> {
  const { t, share, ctl, say } = useCf()
  return async (expression, opts) => {
    const gmOnly = opts.gmOnly === true
    if (!gmOnly && share.mode === 'whisper' && !share.to.length) {
      say('Pick who to whisper to (under the dice).')
      return null
    }
    const visibility = gmOnly ? 'gm' : share.mode
    const r = await cf.post<Roll>(`/campfire/campaigns/${t.campaign.id}/rolls`, {
      expression,
      label: opts.label.slice(0, 100),
      ...(opts.characterId ? { characterId: opts.characterId } : {}),
      visibility,
      ...(visibility === 'whisper' ? { whisperTo: share.to } : {})
    })
    if (!r.ok) {
      say(r.message)
      return null
    }
    ctl.update((s) =>
      s.rolls.some((x) => x.id === r.data.id)
        ? s
        : { ...s, rolls: [r.data, ...s.rolls].slice(0, 200) }
    )
    return r.data
  }
}

/** "Ranger 5 (Hunter) / Rogue 1" */
export const classesLine = (sheet: Sheet5e): string =>
  sheet.classes
    .map((c) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ''}`)
    .join(' / ')

/** "1 bonus action" → "Bonus action"; "90 feet" → "90 ft"; "Up to 1 hour" → "1 hour". */
export function spellLine(sp: SheetSpell): string {
  const time = (sp.castingTime ?? '')
    .replace(/^1 (action|bonus action|reaction)\b.*$/i, (_, a: string) => a)
    .replace(/^./, (c) => c.toUpperCase())
  const range = (sp.range ?? '')
    .replace(/(\d+)[ -]feet/gi, '$1 ft')
    .replace(/(\d+)[ -]foot/gi, '$1-ft')
    .replace(/^(Touch|Self)\b/, (w) => w.toLowerCase())
  const duration = (sp.duration ?? '').replace(/^Up to /i, '').replace(/^Instantaneous$/i, '')
  return [time, range, duration].filter(Boolean).join(' · ')
}

/**
 * A spell from the rules as a sheet entry: its timing, range, duration, concentration, and the
 * dice it rolls (damage for its level or the character's level; healing spells with their
 * "1d8 + your spellcasting ability modifier" worked out from the sheet).
 */
export function spellFromSrd(sp: SrdSpell, sheet: Sheet5e): SheetSpell {
  const out: SheetSpell = {
    slug: sp.slug,
    name: sp.name,
    level: sp.level,
    prepared: true,
    castingTime: sp.castingTime,
    range: sp.range,
    duration: sp.duration
  }
  if (sp.concentration) out.concentration = true
  const clean = (d: string): string => d.replace(/\s+/g, '')
  const bySlot = sp.damage?.bySlot
  const byLevel = sp.damage?.byCharacterLevel
  if (bySlot && bySlot[String(sp.level)]) out.roll = clean(bySlot[String(sp.level)])
  else if (byLevel) {
    const lvl = Math.max(1, totalLevel(sheet))
    const key = Object.keys(byLevel)
      .map(Number)
      .filter((k) => k <= lvl)
      .sort((a, b) => b - a)[0]
    if (key !== undefined) out.roll = clean(byLevel[String(key)])
  } else {
    const heal = /hit points equal to (\d+d\d+) \+ your spellcasting ability modifier/i.exec(
      sp.desc
    )
    if (heal) {
      const a = sheet.spellcasting.ability
      out.roll = withBonus(heal[1], a ? abilityMod(sheet.abilities[a]) : 0)
    }
  }
  const first = sp.desc.split(/(?<=\.)\s/)[0] ?? ''
  if (first)
    out.notes = first.length > 80 ? `${first.slice(0, first.lastIndexOf(' ', 77))}…` : first
  return out
}

/** Thousands with commas: 6,500. */
export const thousands = (n: number): string => n.toLocaleString('en-US')
