import { useEffect, useMemo, useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type Character,
  type SheetSpell,
  type SrdSpellSummary
} from '@glofly/shared/campfire/types'
import { abilityMod } from '@glofly/shared/campfire/rules5e'
import { averageHitDie } from '@glofly/shared/campfire/rulesData'
import {
  levelUpPreview,
  levelUpSheet,
  spellCounts,
  type AsiChoice
} from '@glofly/shared/campfire/builder'
import { cf } from './api'
import { useCf } from './ctx'
import { CfWindow, Portrait } from './sheetBits'
import { campaignRules, searchSpells, sheetSpellFrom, spellDetails, useBuilder } from './rulesApi'
import './sheet.css'
import './roundA.css'

// Round A: leveling up (approved board "LevelUp"): hit points (the average, or a d10 rolled on
// the server), an Ability Score Improvement or a feat when the class gets one, the subclass at
// its level, new spells; the rest (hit dice, slots, features, numbers) is done by the shared
// levelUpSheet. The game master sees it in the table's history (the HP roll is a table roll).

export function LevelUp({
  ch,
  onClose
}: {
  ch: Character
  onClose: () => void
}): React.JSX.Element {
  const { t, say, ctl } = useCf()
  const rules = ch.sheet.rules ?? campaignRules(t.campaign.settings)
  const data = useBuilder(rules)
  const preview = data ? levelUpPreview(data, ch.sheet) : null
  const [hp, setHp] = useState<'average' | number>('average')
  const [asi, setAsi] = useState<AsiChoice>({ kind: 'asi', plus: {} })
  const [subclass, setSubclass] = useState<string | null>(null)
  const [spells, setSpells] = useState<SheetSpell[]>([])
  const [busy, setBusy] = useState(false)
  const [rolling, setRolling] = useState(false)

  const conMod = abilityMod(ch.sheet.abilities.con)
  const avg = preview ? averageHitDie(preview.cls.hitDie) : 0
  const asiTotal =
    asi.kind === 'asi' ? Object.values(asi.plus).reduce((n, v) => n + (v ?? 0), 0) : 2
  const next = useMemo(
    () =>
      data && preview
        ? levelUpSheet(data, ch.sheet, {
            rolled: hp === 'average' ? null : hp,
            asi: preview.level.asi ? asi : undefined,
            subclassId: subclass,
            spells
          })
        : null,
    [data, preview, ch.sheet, hp, asi, subclass, spells]
  )

  const rollHp = async (): Promise<void> => {
    if (!preview) return
    setRolling(true)
    const r = await cf.post<{ result: { total: number } }>(
      `/campfire/campaigns/${t.campaign.id}/rolls`,
      {
        expression: `1d${preview.cls.hitDie}`,
        label: `${ch.name}: hit points for level ${preview.next}`,
        characterId: ch.id,
        visibility: 'all'
      }
    )
    setRolling(false)
    if (!r.ok) return say(r.message)
    setHp(r.data.result.total)
  }

  const finish = async (): Promise<void> => {
    if (!next) return
    setBusy(true)
    const r = await cf.patch<Character>(`/campfire/characters/${ch.id}`, { sheet: next })
    setBusy(false)
    if (!r.ok) return say(r.message)
    ctl.update((s) => ({
      ...s,
      characters: s.characters.map((c) => (c.id === ch.id ? r.data : c))
    }))
    say(`${ch.name} is level ${preview!.next}.`)
    onClose()
  }

  if (!data || !preview)
    return (
      <CfWindow label="Level up" onClose={onClose} className="cfs-window--small">
        <div className="cfa-pad">
          <p className="cfa-lead">
            {!data
              ? 'Loading the rules…'
              : ch.sheet.classes[0]?.level >= 20
                ? `${ch.name} is level 20: as high as it goes.`
                : `${ch.name}'s class isn't in the rules, so level up on the sheet by hand.`}
          </p>
        </div>
      </CfWindow>
    )

  const ready = (!preview.level.asi || asiTotal === 2) && (!preview.needsSubclass || !!subclass)
  return (
    <CfWindow label={`Level up: ${ch.name}`} onClose={onClose} className="cfa-window--mid">
      <header className="cfa-lu-head">
        <Portrait ch={ch} size={76} />
        <div>
          <span className="cfa-kicker">Level up</span>
          <h1>
            {ch.name} reaches level {preview.next}
          </h1>
          <span className="cf-sub">
            {preview.cls.name} {preview.next - 1}
            {ch.sheet.classes[0]?.subclass ? ` (${ch.sheet.classes[0].subclass})` : ''} →{' '}
            {preview.cls.name} {preview.next}
          </span>
        </div>
        <button type="button" className="cf-ghost" onClick={onClose}>
          Finish later
        </button>
      </header>
      <div className="cfa-lu-grid">
        <div className="cfa-col">
          <section className="cfa-lu-card" aria-labelledby="lu-hp">
            <h2 id="lu-hp">
              Hit points
              <span>
                {ch.sheet.hp.max} → <b style={{ color: '#9be0b2' }}>{next?.hp.max}</b>
              </span>
            </h2>
            <div className="cfa-pick2" role="radiogroup" aria-label="Hit points">
              <button
                type="button"
                role="radio"
                aria-checked={hp === 'average'}
                onClick={() => setHp('average')}
              >
                <b>+{Math.max(1, avg + conMod)}</b>
                <span>
                  Take the average: {avg} {conMod >= 0 ? '+' : '−'} {Math.abs(conMod)}{' '}
                  (Constitution)
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={hp !== 'average'}
                disabled={rolling}
                onClick={() => (hp === 'average' ? void rollHp() : undefined)}
              >
                <b>{hp === 'average' ? `Roll 1d${preview.cls.hitDie}` : `Rolled ${hp}`}</b>
                <span>
                  {hp === 'average'
                    ? 'Rolled on the server, everyone sees it'
                    : `+${Math.max(1, hp + conMod)} hit points`}
                </span>
              </button>
            </div>
          </section>
          {preview.level.asi && (
            <section
              className={`cfa-lu-card${asiTotal !== 2 ? ' cfa-lu-card--todo' : ''}`}
              aria-labelledby="lu-asi"
            >
              <h2 id="lu-asi">
                Ability Score Improvement<span>{asiTotal === 2 ? 'Done' : 'Choose'}</span>
              </h2>
              <p className="cf-sub">
                +2 to one ability or +1 to two (up to 20), or take a feat instead.
              </p>
              <div className="cfa-opts" role="radiogroup" aria-label="Improvement">
                <button
                  type="button"
                  role="radio"
                  aria-checked={asi.kind === 'asi'}
                  onClick={() => setAsi({ kind: 'asi', plus: {} })}
                >
                  Raise scores
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={asi.kind === 'feat'}
                  onClick={() =>
                    setAsi({
                      kind: 'feat',
                      featId:
                        data.feats.find(
                          (f) => f.type === 'general' && f.id !== 'ability-score-improvement'
                        )?.id ?? ''
                    })
                  }
                >
                  Pick a feat
                </button>
              </div>
              {asi.kind === 'asi' ? (
                <div className="cfa-grid cfa-grid--3">
                  {ABILITIES.map((a) => {
                    const plus = asi.plus[a] ?? 0
                    const score = ch.sheet.abilities[a]
                    const bump = (d: number): void => {
                      const v = Math.max(0, Math.min(2, plus + d))
                      const others = asiTotal - plus
                      if (others + v > 2 || score + v > 20) return
                      setAsi({ kind: 'asi', plus: { ...asi.plus, [a]: v } })
                    }
                    return (
                      <div key={a} className={`cfa-ability${plus ? ' cfa-ability--main' : ''}`}>
                        <div className="cfa-ability-top">
                          <b>{a.toUpperCase()}</b>
                          <span className="cf-sub">{ABILITY_NAMES[a as Ability]}</span>
                        </div>
                        <span className="cfa-stepper">
                          <button
                            type="button"
                            aria-label={`Less ${ABILITY_NAMES[a as Ability]}`}
                            disabled={!plus}
                            onClick={() => bump(-1)}
                          >
                            −
                          </button>
                          <b>{score + plus}</b>
                          <button
                            type="button"
                            aria-label={`More ${ABILITY_NAMES[a as Ability]}`}
                            disabled={asiTotal >= 2 || score + plus >= 20}
                            onClick={() => bump(1)}
                          >
                            +
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <select
                  aria-label="Feat"
                  value={asi.featId}
                  onChange={(e) => setAsi({ kind: 'feat', featId: e.target.value })}
                >
                  {data.feats
                    .filter(
                      (f) =>
                        f.type !== 'origin' &&
                        f.type !== 'epic-boon' &&
                        f.type !== 'fighting-style' &&
                        f.id !== 'ability-score-improvement'
                    )
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                        {f.prerequisite ? ` (${f.prerequisite})` : ''}
                      </option>
                    ))}
                </select>
              )}
            </section>
          )}
          {preview.needsSubclass && (
            <section
              className={`cfa-lu-card${!subclass ? ' cfa-lu-card--todo' : ''}`}
              aria-labelledby="lu-sub"
            >
              <h2 id="lu-sub">
                {preview.cls.subclassLabel}
                <span>{subclass ? 'Done' : 'Choose'}</span>
              </h2>
              <div className="cfa-chips">
                {preview.cls.subclasses.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={subclass === s.id}
                    className={`cf-chip${subclass === s.id ? ' cf-chip--on' : ''}`}
                    onClick={() => setSubclass(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="cfa-col">
          {preview.cls.spellAbility && (
            <SpellPicks
              rules={rules}
              cls={preview.cls.name}
              classId={preview.cls.id}
              data={data}
              level={preview.next}
              mod={abilityMod(ch.sheet.abilities[preview.cls.spellAbility])}
              have={ch.sheet.spellcasting.spells}
              picks={spells}
              setPicks={setSpells}
            />
          )}
          <section className="cfa-lu-card" aria-labelledby="lu-auto">
            <h2 id="lu-auto">Done for you</h2>
            <ul className="cfa-sofar">
              <li>
                ✓ Hit dice {preview.next - 1} → {preview.next} (d{preview.cls.hitDie})
              </li>
              {preview.cls.spellAbility && (
                <li>✓ Spell slots from the {preview.cls.name.toLowerCase()} table</li>
              )}
              {preview.newFeatures.map((f) => (
                <li key={f.name} title={f.text}>
                  ✓ New: {f.name}
                </li>
              ))}
              <li>✓ Attacks, saves and skills recalculated</li>
            </ul>
          </section>
        </div>
      </div>
      <footer className="cfa-foot">
        <span className="cf-sub">
          Your game master sees this level up in the table’s history. {data.credit}
        </span>
        <button
          type="button"
          className="cf-primary cfa-push cfa-big"
          disabled={!ready || busy}
          onClick={() => void finish()}
        >
          {busy ? 'Saving…' : `Finish level ${preview.next}`}
        </button>
      </footer>
    </CfWindow>
  )
}

function SpellPicks({
  rules,
  cls,
  classId,
  data,
  level,
  mod,
  have,
  picks,
  setPicks
}: {
  rules: '2014' | '2024'
  cls: string
  classId: string
  data: NonNullable<ReturnType<typeof useBuilder>>
  level: number
  mod: number
  have: SheetSpell[]
  picks: SheetSpell[]
  setPicks: (s: SheetSpell[]) => void
}): React.JSX.Element {
  const c = data.classes.find((x) => x.id === classId)!
  const now = spellCounts(c, level, mod)
  const before = spellCounts(c, level - 1, mod)
  const more = Math.max(0, now.spells - before.spells) + Math.max(0, now.cantrips - before.cantrips)
  const row = c.levels.find((l) => l.level === level)
  const maxLevel = row
    ? (row.pact?.level ?? row.slots.reduce((top, n, i) => (n ? i + 1 : top), 0))
    : 0
  const [q, setQ] = useState('')
  const [list, setList] = useState<SrdSpellSummary[]>([])
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void searchSpells(rules, q, { cls }).then((s) =>
          setList(s.filter((x) => x.level <= maxLevel && !have.some((h) => h.slug === x.slug)))
        ),
      150
    )
    return () => window.clearTimeout(timer)
  }, [rules, q, cls, maxLevel, have])
  return (
    <section className="cfa-lu-card" aria-labelledby="lu-spells">
      <h2 id="lu-spells">
        {more ? `${more} new spell${more === 1 ? '' : 's'}` : 'Spells'}
        <span>
          {before.spells} → {now.spells}
        </span>
      </h2>
      <input
        className="cfa-search"
        type="search"
        placeholder={`${cls} spells, up to level ${maxLevel}`}
        aria-label={`Search ${cls} spells`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="cfa-list">
        {list.slice(0, 8).map((s) => {
          const on = picks.some((p) => p.slug === s.slug)
          return (
            <li key={s.slug}>
              <span>
                <b>{s.name}</b>
                <span className="cf-sub">
                  {s.level === 0 ? 'Cantrip' : `Level ${s.level}`} · {s.school}
                </span>
              </span>
              <button
                type="button"
                className={on ? 'cf-primary cf-small' : 'cf-ghost cf-small'}
                disabled={!on && picks.length >= Math.max(1, more)}
                onClick={async () => {
                  if (on) return setPicks(picks.filter((p) => p.slug !== s.slug))
                  const full = await spellDetails(rules, s.slug)
                  if (full) setPicks([...picks, sheetSpellFrom(full)])
                }}
              >
                {on ? 'Picked' : 'Pick'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
