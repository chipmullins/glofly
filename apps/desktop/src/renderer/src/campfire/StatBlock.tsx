import { creditFor, rulesOf } from '@glofly/shared/campfire/rulesData'
import { useEffect, useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  isFullCharacter,
  type AttackResult,
  type Character,
  type Sheet5e,
  type SheetAttack,
  type SrdMonster
} from '@glofly/shared/campfire/types'
import {
  abilityMod,
  attackExpressions,
  crLabel,
  hitPointFormula,
  hpState,
  sizeCells
} from '@glofly/shared/campfire/rules5e'
import { cf } from './api'
import { signed, useCf, type StatBlockFor } from './ctx'
import { usePlace } from './place'
import { useRollNow } from './sheetCore'
import { CfWindow, SvgIcon } from './sheetBits'
import './sheet.css'

// GMs only (approved board SheetNpc): a monster's stat block, ready to roll. Either an NPC at the
// table (its own sheet and HP) or one straight from the compendium (placing it makes NPCs).
// Its rolls are GM-only so players never learn a monster's bonuses.

const HOW_MANY_HIDDEN = 3

export function StatBlock({
  what,
  onClose
}: {
  what: StatBlockFor
  onClose: () => void
}): React.JSX.Element {
  const { t, say, ctl, openSheet, tokenOf, selectedId, attackWith } = useCf()
  const rollNow = useRollNow()
  const place = usePlace()
  const [srd, setSrd] = useState<SrdMonster | null>(null)
  const [srdHp, setSrdHp] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const rules = rulesOf(t.campaign.settings)
  const ch =
    'characterId' in what
      ? ((t.characters.find((c) => c.id === what.characterId && isFullCharacter(c)) as
          Character | undefined) ?? null)
      : null

  useEffect(() => {
    if (!('slug' in what)) return
    let live = true
    void cf.get<SrdMonster>(`/campfire/srd/monsters/${what.slug}?rules=${rules}`).then((r) => {
      if (!live) return
      if (r.ok) setSrd(r.data)
      else say(r.message)
    })
    return () => {
      live = false
    }
  }, [what, say, rules])

  const sheet: Sheet5e | null = ch ? ch.sheet : srd ? srd.sheet : null
  const name = ch?.name ?? srd?.name ?? ''
  const slug = ch?.srdMonster ?? srd?.slug ?? null
  if (!sheet)
    return (
      <CfWindow label="Stat block" onClose={onClose} className="cfs-window--npc">
        <p className="cfs-hint" role="status">
          {'characterId' in what ? 'That character is gone.' : 'Opening the stat block…'}
        </p>
      </CfWindow>
    )

  const m = sheet.monster
  const hp = ch
    ? sheet.hp
    : { ...sheet.hp, current: srdHp ?? sheet.hp.current, max: srdHp ?? sheet.hp.max }
  const state = hpState(hp.current, hp.max)
  const formula = hitPointFormula(sheet)
  const cells = sizeCells(sheet.size)
  const subtitle = [
    `${sheet.size[0].toUpperCase()}${sheet.size.slice(1)} ${m?.type ?? 'creature'}`,
    m?.alignment || sheet.alignment,
    m ? `Challenge ${crLabel(m.cr)} (${m.xp.toLocaleString('en-US')} XP)` : ''
  ]
    .filter(Boolean)
    .join(' · ')

  const store = (c: Character): void =>
    ctl.update((s) => ({
      ...s,
      characters: s.characters.some((x) => x.id === c.id)
        ? s.characters.map((x) => (x.id === c.id ? c : x))
        : [...s.characters, c]
    }))

  const rerollHp = async (): Promise<void> => {
    if (!formula) return
    const r = await rollNow(formula, { label: `${name}: hit points`, gmOnly: true })
    if (!r) return
    const n = Math.max(1, r.total)
    if (!ch) {
      setSrdHp(n)
      return say(`${name} will have ${n} hit points.`)
    }
    const res = await cf.patch<Character>(`/campfire/characters/${ch.id}`, {
      sheet: { ...ch.sheet, hp: { current: n, max: n, temp: 0 } }
    })
    if (!res.ok) return say(res.message)
    store(res.data)
    say(`${name} has ${n} hit points now.`)
  }

  /** A fresh NPC with this stat block (its own HP), for placing or editing. */
  const copy = async (newName?: string): Promise<Character | null> => {
    const body = ch
      ? {
          kind: 'npc',
          name: newName ?? ch.name,
          sheet: { ...ch.sheet, hp: { ...ch.sheet.hp, current: ch.sheet.hp.max, temp: 0 } },
          ...(ch.portraitFileId ? { portraitFileId: ch.portraitFileId } : {})
        }
      : { kind: 'npc', srdMonster: slug, ...(newName ? { name: newName } : {}) }
    const r = await cf.post<Character>(`/campfire/campaigns/${t.campaign.id}/characters`, body)
    if (!r.ok) {
      say(r.message)
      return null
    }
    let made = r.data
    if (!ch && srdHp !== null) {
      const p = await cf.patch<Character>(`/campfire/characters/${made.id}`, {
        sheet: { ...made.sheet, hp: { current: srdHp, max: srdHp, temp: 0 } }
      })
      if (p.ok) made = p.data
    }
    store(made)
    return made
  }

  const placeSome = async (n: number, hidden: boolean): Promise<void> => {
    if (!t.scene) return say('Make a scene first.')
    setBusy(true)
    try {
      let placed = 0
      for (let i = 0; i < n; i++) {
        // The NPC itself goes on first (if it isn't on this scene yet); then copies with their own HP.
        const useSelf = ch && i === 0 && !tokenOf(ch.id)
        const who = useSelf ? ch : await copy()
        if (!who) break
        const tk = await place(
          {
            characterId: who.id,
            ...(who.portraitFileId ? { imageFileId: who.portraitFileId } : {})
          },
          { cells, hidden, select: n === 1 }
        )
        if (!tk) break
        placed++
      }
      if (placed)
        say(
          placed === 1
            ? `${name} is on the map${hidden ? ' (hidden)' : ''}.`
            : `${placed} × ${name} on the map${hidden ? ', hidden from players' : ''}.`
        )
    } finally {
      setBusy(false)
    }
  }

  const editCopy = async (): Promise<void> => {
    setBusy(true)
    const made = await copy(ch ? `${ch.name} (copy)`.slice(0, 60) : undefined)
    setBusy(false)
    if (made) openSheet(made.id)
  }

  // Rolls: an NPC at the table with its token out and a target picked attacks through the server.
  const myToken = ch
    ? (tokenOf(ch.id) ??
      (selectedId
        ? (t.tokens.find((x) => x.id === selectedId && x.characterId === ch.id) ?? null)
        : null))
    : null
  // 0.11.3: pick the attack, then click the token it attacks (rolls only if it's in range).
  const toHit = async (a: SheetAttack): Promise<void> => {
    const ex = attackExpressions(sheet, a)
    await attackWith(
      ch ? myToken : null,
      a,
      async (target, dis) => {
        const r = await cf.post<AttackResult>(`/campfire/campaigns/${t.campaign.id}/attack`, {
          attackerTokenId: myToken!.id,
          targetTokenId: target.id,
          attack: {
            id: a.id,
            name: a.name,
            toHit: ex.toHit,
            damage: ex.damage,
            damageType: a.damageType,
            kind: a.kind
          },
          ...(dis ? { advantage: 'dis' } : {}),
          visibility: 'gm'
        })
        if (!r.ok) say(r.message)
        else
          say(
            r.data.hit
              ? `${a.name} hits ${target.name || 'the target'}${r.data.crit ? ' (critical)' : ''}.`
              : `${a.name} misses${dis ? ' (long range)' : ''}.`
          )
      },
      async () => {
        await rollNow(ex.toHit, {
          label: `${name}: ${a.name} to hit`,
          characterId: ch?.id ?? null,
          gmOnly: true
        })
      }
    )
  }
  const damage = (a: SheetAttack): void =>
    void rollNow(attackExpressions(sheet, a).damage, {
      label: `${name}: ${a.name} damage`,
      characterId: ch?.id ?? null,
      gmOnly: true
    })

  const attackFor = (featureName: string): SheetAttack | undefined =>
    sheet.attacks.find((a) => a.name === featureName)
  const actions = m?.actions ?? []
  const extraAttacks = sheet.attacks.filter((a) => !actions.some((f) => f.name === a.name))
  const senses = (m?.senses || sheet.senses || '')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/ ft\./g, ' ft')
    .replace(/passive perception/i, 'passive Perception')

  return (
    <CfWindow label={`${name}: stat block`} onClose={onClose} className="cfs-window--npc">
      <div className="cfn">
        <div className="cfn-head">
          <span className="cfn-face" aria-hidden="true">
            {(name[0] ?? '?').toUpperCase()}
          </span>
          <div className="cfn-title">
            <h2>{name}</h2>
            <span className="cfs-muted">{subtitle}</span>
          </div>
          <span className="cfn-gm-pill">
            <SvgIcon name="lock" size={13} />
            Only game masters see this
          </span>
          <button
            type="button"
            className="cfs-close"
            aria-label="Close stat block"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="cfn-block">
          <div className="cfn-vitals">
            <span className="cfn-chip">
              <b className="cfn-big">{sheet.ac}</b>{' '}
              <span className="cfs-muted cfs-small">
                AC{sheet.acNote ? ` · ${sheet.acNote}` : ''}
              </span>
            </span>
            <span className="cfn-chip cfn-chip--hp">
              <span className="cfn-hp-line">
                <b className="cfn-big">{hp.current}</b>
                <span className="cfs-muted cfs-small">
                  / {hp.max} HP ·{' '}
                  {state === 'healthy' ? 'Healthy' : state === 'bloodied' ? 'Bloodied' : 'Defeated'}
                </span>
                {formula && (
                  <button type="button" className="cfn-reroll" onClick={() => void rerollHp()}>
                    Reroll HP ({formula})
                  </button>
                )}
              </span>
              <span
                className="cfn-bar"
                role="img"
                aria-label={`${hp.current} of ${hp.max} hit points, ${state}`}
              >
                <span
                  className={`cfn-bar-fill cfn-bar-fill--${state}`}
                  style={{
                    width: `${hp.max ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0}%`
                  }}
                />
              </span>
            </span>
            <span className="cfn-chip">
              <b className="cfn-big">{sheet.speed} ft</b>{' '}
              <span className="cfs-muted cfs-small">
                speed{sheet.otherSpeeds ? `, ${sheet.otherSpeeds}` : ''}
              </span>
            </span>
          </div>

          <div className="cfn-abilities">
            {ABILITIES.map((a) => {
              const mod = abilityMod(sheet.abilities[a])
              return (
                <div key={a} className="cfn-ability">
                  <span className="cfn-ability-name">{a.toUpperCase()}</span>
                  <button
                    type="button"
                    className="cfn-ability-roll"
                    aria-label={`Roll ${ABILITY_NAMES[a]} check for ${name} (${signed(mod)})`}
                    onClick={() =>
                      void rollNow(mod ? `1d20${mod > 0 ? '+' : '-'}${Math.abs(mod)}` : '1d20', {
                        label: `${name}: ${ABILITY_NAMES[a]} check`,
                        characterId: ch?.id ?? null,
                        gmOnly: true
                      })
                    }
                  >
                    {sheet.abilities[a]} ({signed(mod)})
                  </button>
                </div>
              )
            })}
          </div>

          {senses && (
            <p className="cfn-p">
              <b className="cfn-label">Senses</b> {senses}
            </p>
          )}
          {m?.languages && (
            <p className="cfn-p">
              <b className="cfn-label">Languages</b> {m.languages}
            </p>
          )}
          {(m?.conditionImmunities.length ?? 0) > 0 && (
            <p className="cfn-p">
              <b className="cfn-label">Condition immunities</b> {m!.conditionImmunities.join(', ')}
            </p>
          )}
          {m?.traits.map((f) => (
            <p key={f.id} className="cfn-p">
              <b>
                <i>{f.name}.</i>
              </b>{' '}
              {f.text}
            </p>
          ))}

          <h3 className="cfn-h3">Actions</h3>
          {actions.map((f) => {
            const a = attackFor(f.name)
            return (
              <p key={f.id} className="cfn-p">
                <b>
                  <i>{f.name}.</i>
                </b>{' '}
                {a ? attackText(f.text) : f.text}
                {a && <AttackButtons a={a} sheet={sheet} onHit={toHit} onDamage={damage} />}
              </p>
            )
          })}
          {extraAttacks.map((a) => (
            <p key={a.id} className="cfn-p">
              <b>
                <i>{a.name}.</i>
              </b>{' '}
              {a.kind === 'melee' ? 'Melee' : a.kind === 'ranged' ? 'Ranged' : 'Spell'} attack
              {a.range ? `, ${a.range}` : ''}.
              <AttackButtons a={a} sheet={sheet} onHit={toHit} onDamage={damage} />
            </p>
          ))}
          {actions.length === 0 && extraAttacks.length === 0 && (
            <p className="cfs-hint">No actions.</p>
          )}
          {(m?.reactions.length ?? 0) > 0 && <h3 className="cfn-h3">Reactions</h3>}
          {m?.reactions.map((f) => (
            <p key={f.id} className="cfn-p">
              <b>
                <i>{f.name}.</i>
              </b>{' '}
              {f.text}
            </p>
          ))}
          {(m?.legendary.length ?? 0) > 0 && <h3 className="cfn-h3">Legendary actions</h3>}
          {m?.legendary.map((f) => (
            <p key={f.id} className="cfn-p">
              <b>
                <i>{f.name}.</i>
              </b>{' '}
              {f.text}
            </p>
          ))}
        </div>

        <div className="cfn-buttons">
          <button
            type="button"
            className="cfs-button cfs-button--accent"
            disabled={busy || !t.scene}
            onClick={() => void placeSome(1, false)}
          >
            Place on the map
          </button>
          <button
            type="button"
            className="cfs-button"
            disabled={busy || !t.scene}
            onClick={() => void placeSome(HOW_MANY_HIDDEN, true)}
          >
            Place {HOW_MANY_HIDDEN}, hidden
          </button>
          <button
            type="button"
            className="cfs-button"
            disabled={busy}
            onClick={() => void editCopy()}
          >
            Edit a copy
          </button>
          {ch && (
            <button type="button" className="cfs-button" onClick={() => openSheet(ch.id)}>
              Full sheet
            </button>
          )}
        </div>

        <p className="cfn-foot">
          Players see the name, a health state (Healthy, Bloodied, Defeated) and whether attacks
          hit, never these numbers.
          {slug ? ` ${creditFor(rules)}` : ''}
        </p>
      </div>
    </CfWindow>
  )
}

/**
 * "Melee Weapon Attack: +6 to hit, reach 5 ft., one target." → "Melee weapon attack, reach 5 ft,
 * one target." (the to-hit is on the button next to it, as on the board).
 */
function attackText(text: string): string {
  return text
    .replace(
      /^(Melee or Ranged|Melee|Ranged) (Weapon|Spell) Attack: [+-]?\d+ to hit, /,
      (_, kind: string, what: string) =>
        `${kind.replace(' or Ranged', ' or ranged')} ${what.toLowerCase()} attack, `
    )
    .replace(/ ft\.(?=[,\s])/g, ' ft')
}

function AttackButtons({
  a,
  sheet,
  onHit,
  onDamage
}: {
  a: SheetAttack
  sheet: Sheet5e
  onHit: (a: SheetAttack) => Promise<void>
  onDamage: (a: SheetAttack) => void
}): React.JSX.Element {
  const ex = attackExpressions(sheet, a)
  const hit = signed(Number(ex.toHit.replace(/^1d20/, '') || 0))
  return (
    <span className="cfn-attack">
      <button
        type="button"
        className="cfn-tohit"
        aria-label={`Roll ${a.name} to hit (${hit})`}
        onClick={() => void onHit(a)}
      >
        {hit}
      </button>
      <button
        type="button"
        className="cfn-dmg"
        aria-label={`Roll ${a.name} damage (${ex.damage})`}
        onClick={() => onDamage(a)}
      >
        {ex.damage}
      </button>
    </span>
  )
}
