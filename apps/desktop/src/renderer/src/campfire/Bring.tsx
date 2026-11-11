import { useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type Character,
  type Sheet5e,
  type SkillId
} from '@glofly/shared/campfire/types'
import {
  abilityMod,
  normalizeSheet,
  SKILLS,
  SKILL_IDS,
  slotsForClasses
} from '@glofly/shared/campfire/rules5e'
import {
  parseClassLevel,
  sheetFromPdfFields,
  type ImportResult,
  type PdfFields
} from '@glofly/shared/campfire/importSheet'
import { blankSheet } from '@glofly/shared/campfire/rules5e'
import type { RulesSet } from '@glofly/shared/campfire/rulesData'
import { cf, pickFile } from './api'
import { signed, useCf } from './ctx'
import { loadBuilder, searchItems, searchSpells, sheetSpellFrom, spellDetails } from './rulesApi'
import { inventoryFromItem } from '@glofly/shared/campfire/builder'

// Round A, switching over (approved board "SwitchOver"): import a character sheet PDF (read here
// with pdf-lib: the PDF never leaves this computer), or copy a character in from another sheet.
// Both end on a check step; nothing is saved until "Bring … to the table".

/** Reads a PDF's form fields (names → text or ticked). */
async function readPdfFields(file: File): Promise<PdfFields> {
  const { PDFDocument, PDFCheckBox, PDFTextField, PDFDropdown } = await import('pdf-lib')
  const pdf = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
    updateMetadata: false
  })
  const out: PdfFields = {}
  for (const field of pdf.getForm().getFields().slice(0, 2000)) {
    const name = field.getName().slice(0, 120)
    try {
      if (field instanceof PDFTextField) out[name] = (field.getText() ?? '').slice(0, 8000)
      else if (field instanceof PDFCheckBox) out[name] = field.isChecked()
      else if (field instanceof PDFDropdown)
        out[name] = field.getSelected().join(', ').slice(0, 200)
    } catch {
      // A field that can't be read is skipped.
    }
  }
  return out
}

/** Matches spell names to the rules (exact name, either rule set's spelling). */
async function matchSpells(
  rules: RulesSet,
  names: string[]
): Promise<{ spells: Sheet5e['spellcasting']['spells']; unmatched: string[] }> {
  const spells: Sheet5e['spellcasting']['spells'] = []
  const unmatched: string[] = []
  for (const name of names.slice(0, 80)) {
    const hit = (await searchSpells(rules, name)).find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    )
    const full = hit ? await spellDetails(rules, hit.slug) : null
    if (full) spells.push(sheetSpellFrom(full))
    else unmatched.push(name)
  }
  return { spells, unmatched }
}

/** Gives items that match the rules by name their weight, armor and attack (armor and shields
 *  worn: the sheet's AC already counts them). */
async function matchItems(rules: RulesSet, sheet: Sheet5e): Promise<void> {
  const inventory: Sheet5e['inventory'] = []
  const attacks = [...sheet.attacks]
  for (const it of sheet.inventory.slice(0, 80)) {
    const hit = (await searchItems(rules, it.name)).find(
      (r) => r.name.toLowerCase() === it.name.toLowerCase()
    )
    if (!hit) {
      inventory.push(it)
      continue
    }
    const rich = {
      ...inventoryFromItem(hit, it.id, !!(hit.armor || hit.kind === 'shield')),
      qty: it.qty,
      notes: it.notes
    }
    // A weapon the PDF already listed as an attack keeps that attack.
    const known = attacks.find((a) => a.name.toLowerCase() === hit.name.toLowerCase())
    if (known) rich.attackId = known.id
    inventory.push(rich)
  }
  sheet.inventory = inventory
}

export function ImportPanel({
  rules,
  onBack,
  onMade
}: {
  rules: RulesSet
  onBack: () => void
  onMade: (c: Character) => void
}): React.JSX.Element {
  const [result, setResult] = useState<
    (ImportResult & { file: string; unmatched: string[] }) | null
  >(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (): Promise<void> => {
    const file = await pickFile('application/pdf,.pdf')
    if (!file) return
    if (file.size > 15 * 1024 * 1024)
      return setError('That PDF is bigger than 15 MB. Export just the character sheet.')
    setError(null)
    setBusy('Reading the PDF…')
    try {
      const fields = await readPdfFields(file)
      const data = await loadBuilder(rules)
      const r = sheetFromPdfFields(fields, rules, data)
      if (!Object.keys(fields).length) {
        setBusy(null)
        return setError(
          'That PDF has no form fields to read (it may be a picture of a sheet). Use “Copy it in from another sheet” instead.'
        )
      }
      setBusy('Matching spells to the rules…')
      const { spells, unmatched } = await matchSpells(rules, r.spellNames)
      r.sheet.spellcasting.spells = spells
      setBusy('Matching items to the rules…')
      await matchItems(rules, r.sheet)
      setResult({ ...r, file: file.name, unmatched })
    } catch {
      setError(
        "That PDF couldn't be read. Try exporting it again, or copy the character in instead."
      )
    }
    setBusy(null)
  }

  if (!result)
    return (
      <div className="cfa-pad cfa-choose">
        <p className="cfa-lead">
          In D&amp;D Beyond, open your character and choose <b>Export to PDF</b>, then pick the file
          here. Any filled-in 5e character sheet PDF works too.
        </p>
        <button
          type="button"
          className="cf-primary cfa-big"
          disabled={!!busy}
          onClick={() => void choose()}
        >
          {busy ?? 'Choose a PDF'}
        </button>
        {error && (
          <p className="cf-error" role="alert">
            {error}
          </p>
        )}
        <p className="cf-sub">
          The PDF is read on this computer and not kept or uploaded. Features and notes come over as
          text on the sheet.
        </p>
        <button type="button" className="cf-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    )
  return (
    <Check
      initial={result.sheet}
      name={result.name}
      found={result.found}
      missing={[
        ...result.missing,
        ...(result.unmatched.length
          ? [`Spells not in the rules: ${result.unmatched.join(', ')}`]
          : [])
      ]}
      from={result.file}
      onBack={() => setResult(null)}
      onMade={onMade}
    />
  )
}

/** The check step: everything found, with the key numbers editable. */
function Check({
  initial,
  name: name0,
  found,
  missing,
  from,
  onBack,
  onMade
}: {
  initial: Sheet5e
  name: string
  found: string[]
  missing: string[]
  from: string
  onBack: () => void
  onMade: (c: Character) => void
}): React.JSX.Element {
  const { t, say } = useCf()
  const [name, setName] = useState(name0)
  const [sheet, setSheet] = useState(initial)
  const [busy, setBusy] = useState(false)
  const setNum = (patch: (s: Sheet5e) => void): void =>
    setSheet((s) => {
      const next: Sheet5e = JSON.parse(JSON.stringify(s))
      patch(next)
      return next
    })
  const save = async (): Promise<void> => {
    if (!name.trim()) return say('Give them a name.')
    setBusy(true)
    const r = await cf.post<Character>(`/campfire/campaigns/${t.campaign.id}/characters`, {
      kind: 'pc',
      name: name.trim(),
      sheet: normalizeSheet(sheet)
    })
    setBusy(false)
    if (!r.ok) return say(r.message)
    onMade(r.data)
  }
  return (
    <div className="cfa-pad cfa-check">
      <span className="cfa-kicker">Check what we found</span>
      <label className="cf-field">
        <span>Name</span>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <span className="cf-sub">
        {[sheet.race, sheet.classes.map((c) => `${c.name} ${c.level}`).join(' / ')]
          .filter(Boolean)
          .join(' · ')}{' '}
        · from {from}
      </span>
      <div className="cfa-scores cfa-scores--edit" aria-label="Ability scores">
        {ABILITIES.map((a) => (
          <label key={a}>
            <span>{a.toUpperCase()}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={sheet.abilities[a]}
              onChange={(e) => setNum((s) => (s.abilities[a] = Number(e.target.value) || 10))}
            />
          </label>
        ))}
      </div>
      <div className="cfa-inline-row">
        <label className="cfa-inline">
          <span>AC</span>
          <input
            type="number"
            min={0}
            max={40}
            value={sheet.ac}
            onChange={(e) => setNum((s) => (s.ac = Number(e.target.value) || 10))}
          />
        </label>
        <label className="cfa-inline">
          <span>HP max</span>
          <input
            type="number"
            min={1}
            max={999}
            value={sheet.hp.max}
            onChange={(e) =>
              setNum(
                (s) =>
                  (s.hp = {
                    ...s.hp,
                    max: Number(e.target.value) || 1,
                    current: Math.min(s.hp.current, Number(e.target.value) || 1)
                  })
              )
            }
          />
        </label>
        <label className="cfa-inline">
          <span>Speed</span>
          <input
            type="number"
            min={0}
            max={200}
            value={sheet.speed}
            onChange={(e) => setNum((s) => (s.speed = Number(e.target.value) || 0))}
          />
        </label>
      </div>
      <ul className="cfa-found">
        {found.map((x) => (
          <li key={x}>
            <span className="cfa-ok">✓</span>
            {x}
          </li>
        ))}
        {sheet.spellcasting.spells.length > 0 && (
          <li>
            <span className="cfa-ok">✓</span>
            {sheet.spellcasting.spells.length} spells matched to the rules
          </li>
        )}
        {missing.map((x) => (
          <li key={x} className="cfa-found--warn">
            <span>!</span>
            {x}: fill it in on the sheet after
          </li>
        ))}
      </ul>
      <div className="cfa-inline-row">
        <button type="button" className="cf-ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="cf-primary cfa-push"
          disabled={busy || !name.trim()}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : `Bring ${name.trim() || 'them'} to the table`}
        </button>
      </div>
    </div>
  )
}

/** "Copy it in from another sheet": one page with the numbers that matter. */
export function QuickEntry({
  rules,
  level,
  onBack,
  onMade
}: {
  rules: RulesSet
  level: number
  onBack: () => void
  onMade: (c: Character) => void
}): React.JSX.Element {
  const [classLine, setClassLine] = useState(level > 1 ? `Fighter ${level}` : '')
  const [species, setSpecies] = useState('')
  const [scores, setScores] = useState<Record<Ability, number>>({
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10
  })
  const [ac, setAc] = useState(10)
  const [hp, setHp] = useState(10)
  const [speed, setSpeed] = useState(30)
  const [saves, setSaves] = useState<Ability[]>([])
  const [skills, setSkills] = useState<Partial<Record<SkillId, 1 | 2>>>({})
  const [spellNames, setSpellNames] = useState('')
  const [notes, setNotes] = useState('')
  const [checking, setChecking] = useState<{ sheet: Sheet5e; missing: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const next = async (): Promise<void> => {
    setBusy(true)
    const data = await loadBuilder(rules)
    const s = blankSheet()
    s.rules = rules
    s.race = species.trim().slice(0, 60)
    s.classes = parseClassLevel(classLine, data)
    s.abilities = scores
    s.ac = ac
    s.hp = { current: hp, max: hp, temp: 0 }
    s.speed = speed
    s.saves = Object.fromEntries(saves.map((a) => [a, true]))
    s.skills = skills
    s.hitDice = s.classes.map((c) => ({ die: c.hitDie, max: c.level, used: 0 }))
    const slots = slotsForClasses(s.classes)
    s.spellcasting.slots = slots.slots.map((max) => ({ max, used: 0 }))
    s.spellcasting.pact = slots.pact
      ? { level: slots.pact.level, max: slots.pact.slots, used: 0 }
      : null
    const cls = data?.classes.find((c) => c.name === s.classes[0]?.name)
    s.spellcasting.ability = cls?.spellAbility ?? null
    const { spells, unmatched } = await matchSpells(
      rules,
      spellNames
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
    s.spellcasting.spells = spells
    s.notes = notes.slice(0, 20000)
    setBusy(false)
    setChecking({
      sheet: normalizeSheet(s),
      missing: [
        ...(s.classes.length ? [] : ['Class and level']),
        ...(unmatched.length ? [`Spells not in the rules: ${unmatched.join(', ')}`] : [])
      ]
    })
  }

  if (checking)
    return (
      <Check
        initial={checking.sheet}
        name=""
        found={[
          `${checking.sheet.classes.map((c) => `${c.name} ${c.level}`).join(' / ') || 'No class yet'}`,
          `AC ${checking.sheet.ac} · HP ${checking.sheet.hp.max} · Speed ${checking.sheet.speed} ft`
        ]}
        missing={checking.missing}
        from="what you copied in"
        onBack={() => setChecking(null)}
        onMade={onMade}
      />
    )

  return (
    <div className="cfa-pad cfa-copy">
      <p className="cfa-lead">
        Copy the numbers from your Roll20 or paper sheet. You can fill in the rest on the sheet
        afterwards.
      </p>
      <div className="cfa-inline-row">
        <label className="cf-field cfa-grow">
          <span>Class and level (e.g. “Ranger 5” or “Fighter 3 / Wizard 2”)</span>
          <input value={classLine} onChange={(e) => setClassLine(e.target.value)} />
        </label>
        <label className="cf-field cfa-grow">
          <span>Species</span>
          <input value={species} maxLength={60} onChange={(e) => setSpecies(e.target.value)} />
        </label>
      </div>
      <div className="cfa-scores cfa-scores--edit" aria-label="Ability scores">
        {ABILITIES.map((a) => (
          <label key={a}>
            <span>{a.toUpperCase()}</span>
            <input
              type="number"
              min={1}
              max={30}
              value={scores[a]}
              onChange={(e) => setScores({ ...scores, [a]: Number(e.target.value) || 10 })}
            />
            <span className="cf-sub">{signed(abilityMod(scores[a]))}</span>
          </label>
        ))}
      </div>
      <div className="cfa-inline-row">
        <label className="cfa-inline">
          <span>AC</span>
          <input
            type="number"
            min={0}
            max={40}
            value={ac}
            onChange={(e) => setAc(Number(e.target.value) || 10)}
          />
        </label>
        <label className="cfa-inline">
          <span>HP max</span>
          <input
            type="number"
            min={1}
            max={999}
            value={hp}
            onChange={(e) => setHp(Number(e.target.value) || 1)}
          />
        </label>
        <label className="cfa-inline">
          <span>Speed</span>
          <input
            type="number"
            min={0}
            max={200}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value) || 0)}
          />
        </label>
      </div>
      <fieldset className="cfa-box">
        <legend>Saving throws you’re proficient in</legend>
        <div className="cfa-chips">
          {ABILITIES.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={saves.includes(a)}
              className={`cf-chip${saves.includes(a) ? ' cf-chip--on' : ''}`}
              onClick={() =>
                setSaves(saves.includes(a) ? saves.filter((x) => x !== a) : [...saves, a])
              }
            >
              {ABILITY_NAMES[a]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="cfa-box">
        <legend>Skills (tap twice for expertise)</legend>
        <div className="cfa-chips">
          {SKILL_IDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={!!skills[k]}
              className={`cf-chip${skills[k] ? ' cf-chip--on' : ''}`}
              onClick={() =>
                setSkills({ ...skills, [k]: skills[k] === 1 ? 2 : skills[k] === 2 ? undefined : 1 })
              }
            >
              {SKILLS[k].name}
              {skills[k] === 2 ? ' ★' : ''}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="cf-field">
        <span>Spells (names, one per line or separated by commas)</span>
        <textarea rows={3} value={spellNames} onChange={(e) => setSpellNames(e.target.value)} />
      </label>
      <label className="cf-field">
        <span>Anything else (features, items, notes)</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="cfa-inline-row">
        <button type="button" className="cf-ghost" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          className="cf-primary cfa-push"
          disabled={busy}
          onClick={() => void next()}
        >
          {busy ? 'Checking…' : 'Check it'}
        </button>
      </div>
    </div>
  )
}
