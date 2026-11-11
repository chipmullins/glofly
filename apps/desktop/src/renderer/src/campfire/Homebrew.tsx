import { useCallback, useEffect, useState } from 'react'
import {
  ABILITIES,
  type Ability,
  type CreatureSize,
  type SkillId
} from '@glofly/shared/campfire/types'
import { SKILLS, SKILL_IDS } from '@glofly/shared/campfire/rules5e'
import type {
  Homebrew,
  HomebrewBackground,
  HomebrewData,
  HomebrewFeat,
  HomebrewItem,
  HomebrewKind,
  HomebrewMonster,
  HomebrewSpecies,
  HomebrewSpell,
  HomebrewSubclass,
  PartyLoot
} from '@glofly/shared/campfire/hub'
import { cf } from './api'
import { useCf } from './ctx'
import { campaignRules, loadHomebrew, useBuilder } from './rulesApi'
import './roundA.css'

// Round A: the campaign's homebrew library (approved board "Homebrew"). Game masters write items,
// spells, monsters, species, subclasses, backgrounds and feats; "Players can see it" shares one
// (shared species and backgrounds show up in the character builder). Players see shared ones only.

const KINDS: { id: HomebrewKind; label: string }[] = [
  { id: 'item', label: 'Items' },
  { id: 'spell', label: 'Spells' },
  { id: 'monster', label: 'Monsters' },
  { id: 'species', label: 'Species' },
  { id: 'subclass', label: 'Subclasses' },
  { id: 'background', label: 'Backgrounds' },
  { id: 'feat', label: 'Feats' }
]

const blank = (kind: HomebrewKind): HomebrewData => {
  switch (kind) {
    case 'item':
      return { itemKind: 'magic', rarity: 'Uncommon', text: '', weight: 0, attunement: false }
    case 'spell':
      return {
        level: 1,
        school: 'Evocation',
        castingTime: 'Action',
        range: '60 feet',
        duration: 'Instantaneous',
        concentration: false,
        text: '',
        classes: []
      }
    case 'species':
      return { size: 'medium', speed: 30, darkvision: 0, traits: [] }
    case 'subclass':
      return { classId: 'fighter', summary: '', features: [] }
    case 'background':
      return { skills: [], tools: '', text: '' }
    case 'feat':
      return { text: '', prerequisite: '' }
    case 'monster':
      return { cr: 1, type: 'monstrosity', text: '' }
  }
}

const subtitle = (h: Homebrew): string => {
  const d = h.data as unknown as Record<string, unknown>
  if (h.kind === 'item')
    return [
      `${(d.itemKind as string)[0].toUpperCase()}${(d.itemKind as string).slice(1)}`,
      d.rarity,
      d.attunement ? 'attunement' : ''
    ]
      .filter(Boolean)
      .join(' · ')
  if (h.kind === 'spell')
    return d.level ? `Level ${d.level} · ${d.school}` : `Cantrip · ${d.school}`
  if (h.kind === 'monster') return `CR ${d.cr} · ${d.type}`
  if (h.kind === 'species') return `Speed ${d.speed} ft`
  if (h.kind === 'subclass') return `For ${d.classId}`
  return ''
}

export function HomebrewLibrary(): React.JSX.Element {
  const { t, isGm, say } = useCf()
  const [all, setAll] = useState<Homebrew[]>([])
  const [kind, setKind] = useState<HomebrewKind>('item')
  const [sel, setSel] = useState<string | 'new' | null>(null)
  const reload = useCallback(async () => setAll(await loadHomebrew(t.campaign.id)), [t.campaign.id])
  useEffect(() => {
    void reload()
  }, [reload])
  const list = all.filter((h) => h.kind === kind)
  const cur = sel && sel !== 'new' ? (all.find((h) => h.id === sel) ?? null) : null

  return (
    <div className="cfa-brew cfa-panel" style={{ padding: 0, minHeight: 600 }}>
      <nav className="cfa-brew-kinds" aria-label="Kinds">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-current={kind === k.id}
            onClick={() => {
              setKind(k.id)
              setSel(null)
            }}
          >
            {k.label}
            <span>{all.filter((h) => h.kind === k.id).length}</span>
          </button>
        ))}
        {isGm && (
          <p className="cf-sub" style={{ marginTop: 'auto' }}>
            Only your own writing: no text from books you don’t have the rights to share.
          </p>
        )}
      </nav>
      <div className="cfa-brew-list">
        {isGm && (
          <button type="button" className="cf-primary" onClick={() => setSel('new')}>
            + New{' '}
            {KINDS.find((k) => k.id === kind)!
              .label.toLowerCase()
              .replace(/s$/, '')
              .replace(/ie$/, 'y')}
          </button>
        )}
        {list.map((h) => (
          <button
            key={h.id}
            type="button"
            className="cfa-brew-item"
            aria-pressed={sel === h.id}
            onClick={() => setSel(h.id)}
          >
            <span>
              <b>{h.name}</b>
              {isGm && (
                <span className={h.shared ? 'cfa-tag' : 'cfa-hidden-tag'}>
                  {h.shared ? 'Shared' : 'Hidden'}
                </span>
              )}
            </span>
            <span>{subtitle(h)}</span>
          </button>
        ))}
        {!list.length && (
          <p className="cf-sub">
            {isGm ? 'Nothing here yet.' : 'Your game master hasn’t shared any.'}
          </p>
        )}
      </div>
      <section className="cfa-brew-edit" aria-label="Homebrew entry">
        {(cur || sel === 'new') && (
          <Editor
            key={cur?.id ?? `new-${kind}`}
            kind={cur?.kind ?? kind}
            entry={cur}
            readOnly={!isGm}
            onSaved={(h) => {
              setSel(h.id)
              void reload()
            }}
            onDeleted={() => {
              setSel(null)
              void reload()
            }}
            say={say}
            campaignId={t.campaign.id}
            rules={campaignRules(t.campaign.settings)}
          />
        )}
        {!cur && sel !== 'new' && (
          <p className="cf-sub">
            Pick something on the left{isGm ? ', or make something new' : ''}.
          </p>
        )}
      </section>
    </div>
  )
}

function Editor({
  kind,
  entry,
  readOnly,
  onSaved,
  onDeleted,
  say,
  campaignId,
  rules
}: {
  kind: HomebrewKind
  entry: Homebrew | null
  readOnly: boolean
  onSaved: (h: Homebrew) => void
  onDeleted: () => void
  say: (m: string) => void
  campaignId: string
  rules: '2014' | '2024'
}): React.JSX.Element {
  const [name, setName] = useState(entry?.name ?? '')
  const [shared, setShared] = useState(entry?.shared ?? false)
  const [data, setData] = useState<HomebrewData>(entry?.data ?? blank(kind))
  const builder = useBuilder(rules)
  const d = data as unknown as Record<string, unknown>
  const put = (patch: Record<string, unknown>): void =>
    setData({ ...(data as object), ...patch } as HomebrewData)

  const save = async (): Promise<void> => {
    const body = { name, shared, data }
    const r = entry
      ? await cf.patch<Homebrew>(`/campfire/homebrew/${entry.id}`, body)
      : await cf.post<Homebrew>(`/campfire/campaigns/${campaignId}/homebrew`, { ...body, kind })
    if (!r.ok) return say(r.message)
    say('Saved.')
    onSaved(r.data)
  }
  const toLoot = async (): Promise<void> => {
    if (!entry) return
    const hub = await cf.get<{ loot: PartyLoot }>(`/campfire/campaigns/${campaignId}/hub`)
    if (!hub.ok) return say(hub.message)
    const loot = hub.data.loot
    const r = await cf.put(`/campfire/campaigns/${campaignId}/loot`, {
      loot: {
        ...loot,
        items: [
          ...loot.items,
          {
            id: `h${Date.now().toString(36)}`,
            name: entry.name,
            qty: 1,
            notes: '',
            homebrewId: entry.id
          }
        ]
      }
    })
    say(r.ok ? `${entry.name} is in the party loot. Give it to someone there.` : r.message)
  }

  if (readOnly)
    return (
      <>
        <h2>{entry?.name}</h2>
        <span className="cf-sub">{entry ? subtitle(entry) : ''}</span>
        <p className="cfa-recap">{String(d.text ?? d.summary ?? '')}</p>
        {kind === 'species' &&
          (data as HomebrewSpecies).traits.map((tr) => (
            <p key={tr.name} className="cfa-recap">
              <b>{tr.name}.</b> {tr.text}
            </p>
          ))}
        {kind === 'subclass' &&
          (data as HomebrewSubclass).features.map((f) => (
            <p key={f.name} className="cfa-recap">
              <b>
                {f.name} (level {f.level}).
              </b>{' '}
              {f.text}
            </p>
          ))}
      </>
    )

  const field = (label: string, el: React.ReactNode): React.JSX.Element => (
    <label className="cf-field">
      <span>{label}</span>
      {el}
    </label>
  )
  return (
    <>
      <div className="cfa-inline-row">
        <input
          aria-label="Name"
          className="cfa-grow"
          value={name}
          maxLength={100}
          placeholder="Cloak of the Bell-Diver"
          onChange={(e) => setName(e.target.value)}
          style={{ font: '800 18px/1.1 var(--glo-font-display)', height: 42 }}
        />
        <label className="cf-check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />{' '}
          Players can see it
        </label>
      </div>
      {kind === 'item' && (
        <>
          <div className="cfa-two">
            {field(
              'Kind',
              <select
                value={(data as HomebrewItem).itemKind}
                onChange={(e) => put({ itemKind: e.target.value })}
              >
                <option value="magic">Wondrous / magic item</option>
                <option value="weapon">Weapon</option>
                <option value="armor">Armor</option>
                <option value="shield">Shield</option>
                <option value="gear">Gear</option>
              </select>
            )}
            {field(
              'Rarity',
              <select
                value={(data as HomebrewItem).rarity}
                onChange={(e) => put({ rarity: e.target.value })}
              >
                {['', 'Common', 'Uncommon', 'Rare', 'Very rare', 'Legendary', 'Artifact'].map(
                  (r) => (
                    <option key={r} value={r}>
                      {r || 'None'}
                    </option>
                  )
                )}
              </select>
            )}
          </div>
          {field(
            'What it does',
            <textarea
              rows={4}
              value={(data as HomebrewItem).text}
              onChange={(e) => put({ text: e.target.value })}
            />
          )}
          <div className="cfa-box">
            <b>What Campfire does with it</b>
            <div className="cfa-inline-row">
              <label className="cf-check">
                <input
                  type="checkbox"
                  checked={(data as HomebrewItem).attunement}
                  onChange={(e) => put({ attunement: e.target.checked })}
                />{' '}
                Needs attunement
              </label>
              <label className="cfa-inline">
                <span>AC bonus</span>
                <input
                  type="number"
                  min={-5}
                  max={10}
                  value={(data as HomebrewItem).acBonus ?? 0}
                  onChange={(e) => put({ acBonus: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="cfa-inline">
                <span>Speed</span>
                <input
                  placeholder="swim 30 ft"
                  value={(data as HomebrewItem).speed ?? ''}
                  onChange={(e) => put({ speed: e.target.value })}
                />
              </label>
              <label className="cfa-inline">
                <span>Charges</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={(data as HomebrewItem).charges ?? 0}
                  onChange={(e) => put({ charges: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="cfa-inline">
                <span>Weight (lb)</span>
                <input
                  type="number"
                  min={0}
                  value={(data as HomebrewItem).weight}
                  onChange={(e) => put({ weight: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
            <span className="cf-sub">
              Anything else stays as text on the sheet; you and the player keep track of it.
            </span>
          </div>
        </>
      )}
      {kind === 'spell' && (
        <>
          <div className="cfa-inline-row">
            <label className="cfa-inline">
              <span>Level</span>
              <select
                value={(data as HomebrewSpell).level}
                onChange={(e) => put({ level: Number(e.target.value) })}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? 'Cantrip' : i}
                  </option>
                ))}
              </select>
            </label>
            {(['school', 'castingTime', 'range', 'duration'] as const).map((k) => (
              <label key={k} className="cfa-inline">
                <span>
                  {k === 'castingTime' ? 'Casting time' : k[0].toUpperCase() + k.slice(1)}
                </span>
                <input value={String(d[k] ?? '')} onChange={(e) => put({ [k]: e.target.value })} />
              </label>
            ))}
            <label className="cf-check">
              <input
                type="checkbox"
                checked={(data as HomebrewSpell).concentration}
                onChange={(e) => put({ concentration: e.target.checked })}
              />{' '}
              Concentration
            </label>
            <label className="cfa-inline">
              <span>Roll</span>
              <input
                placeholder="2d8"
                value={(data as HomebrewSpell).roll ?? ''}
                onChange={(e) => put({ roll: e.target.value })}
              />
            </label>
          </div>
          {field(
            'Classes (comma separated)',
            <input
              value={(data as HomebrewSpell).classes.join(', ')}
              onChange={(e) =>
                put({
                  classes: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                })
              }
            />
          )}
          {field(
            'What it does',
            <textarea
              rows={6}
              value={(data as HomebrewSpell).text}
              onChange={(e) => put({ text: e.target.value })}
            />
          )}
        </>
      )}
      {kind === 'monster' && (
        <>
          <div className="cfa-inline-row">
            <label className="cfa-inline">
              <span>Challenge</span>
              <input
                type="number"
                min={0}
                max={30}
                step={0.125}
                value={(data as HomebrewMonster).cr}
                onChange={(e) => put({ cr: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="cfa-inline">
              <span>Type</span>
              <input
                value={(data as HomebrewMonster).type}
                onChange={(e) => put({ type: e.target.value })}
              />
            </label>
          </div>
          {field(
            'Notes and tactics',
            <textarea
              rows={6}
              value={(data as HomebrewMonster).text}
              onChange={(e) => put({ text: e.target.value })}
            />
          )}
          <p className="cf-sub">
            Make its stat block as an NPC at the table (Add → New NPC); this keeps the notes with
            it.
          </p>
        </>
      )}
      {kind === 'species' && (
        <>
          <div className="cfa-inline-row">
            <label className="cfa-inline">
              <span>Size</span>
              <select
                value={(data as HomebrewSpecies).size}
                onChange={(e) => put({ size: e.target.value as CreatureSize })}
              >
                {['small', 'medium', 'large'].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="cfa-inline">
              <span>Speed</span>
              <input
                type="number"
                min={0}
                max={120}
                value={(data as HomebrewSpecies).speed}
                onChange={(e) => put({ speed: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="cfa-inline">
              <span>Darkvision</span>
              <input
                type="number"
                min={0}
                max={300}
                step={30}
                value={(data as HomebrewSpecies).darkvision}
                onChange={(e) => put({ darkvision: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          {rules === '2014' && (
            <div className="cfa-inline-row">
              {ABILITIES.map((a) => (
                <label key={a} className="cfa-mini">
                  <span>{a.toUpperCase()}</span>
                  <input
                    type="number"
                    min={-2}
                    max={3}
                    style={{ width: 56 }}
                    value={(data as HomebrewSpecies).bonuses?.[a] ?? 0}
                    onChange={(e) =>
                      put({
                        bonuses: {
                          ...((data as HomebrewSpecies).bonuses ?? {}),
                          [a]: Number(e.target.value) || 0
                        }
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <TextsField
            label="Traits (one per line, “Name: what it does”)"
            value={(data as HomebrewSpecies).traits}
            onChange={(traits) => put({ traits })}
          />
        </>
      )}
      {kind === 'subclass' && (
        <>
          {field(
            'Class',
            <select
              value={(data as HomebrewSubclass).classId}
              onChange={(e) => put({ classId: e.target.value })}
            >
              {(builder?.classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {field(
            'Summary',
            <textarea
              rows={2}
              value={(data as HomebrewSubclass).summary}
              onChange={(e) => put({ summary: e.target.value })}
            />
          )}
          <TextsField
            label="Features (one per line, “3 Name: what it does” starting with the level)"
            value={(data as HomebrewSubclass).features.map((f) => ({
              name: `${f.level} ${f.name}`,
              text: f.text
            }))}
            onChange={(list) =>
              put({
                features: list.map((f) => ({
                  level: Math.max(1, Math.min(20, Number(/^\d+/.exec(f.name)?.[0] ?? 3))),
                  name: f.name.replace(/^\d+\s*/, ''),
                  text: f.text
                }))
              })
            }
          />
        </>
      )}
      {kind === 'background' && (
        <>
          <div className="cfa-box">
            <b>Skills</b>
            <div className="cfa-chips">
              {SKILL_IDS.map((k) => {
                const on = (data as HomebrewBackground).skills.includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    className={`cf-chip${on ? ' cf-chip--on' : ''}`}
                    onClick={() =>
                      put({
                        skills: on
                          ? (data as HomebrewBackground).skills.filter((x) => x !== k)
                          : [...(data as HomebrewBackground).skills, k as SkillId]
                      })
                    }
                  >
                    {SKILLS[k].name}
                  </button>
                )
              })}
            </div>
          </div>
          {rules === '2024' && (
            <div className="cfa-box">
              <b>Abilities it can raise (pick three)</b>
              <div className="cfa-chips">
                {ABILITIES.map((a) => {
                  const list = (data as HomebrewBackground).abilities ?? []
                  const on = list.includes(a)
                  return (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && list.length >= 3}
                      className={`cf-chip${on ? ' cf-chip--on' : ''}`}
                      onClick={() =>
                        put({
                          abilities: on ? list.filter((x) => x !== a) : [...list, a as Ability]
                        })
                      }
                    >
                      {a.toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {field(
            'Tools',
            <input
              value={(data as HomebrewBackground).tools}
              onChange={(e) => put({ tools: e.target.value })}
            />
          )}
          {field(
            'Description',
            <textarea
              rows={4}
              value={(data as HomebrewBackground).text}
              onChange={(e) => put({ text: e.target.value })}
            />
          )}
        </>
      )}
      {kind === 'feat' && (
        <>
          {field(
            'Prerequisite',
            <input
              value={(data as HomebrewFeat).prerequisite}
              onChange={(e) => put({ prerequisite: e.target.value })}
            />
          )}
          {field(
            'What it does',
            <textarea
              rows={6}
              value={(data as HomebrewFeat).text}
              onChange={(e) => put({ text: e.target.value })}
            />
          )}
        </>
      )}
      <div className="cfa-inline-row" style={{ marginTop: 'auto' }}>
        {entry && (
          <button
            type="button"
            className="cf-ghost cf-danger-text"
            onClick={async () => {
              if (!window.confirm(`Delete ${entry.name}?`)) return
              const r = await cf.del(`/campfire/homebrew/${entry.id}`)
              if (!r.ok) return say(r.message)
              onDeleted()
            }}
          >
            Delete
          </button>
        )}
        {entry && kind === 'item' && (
          <button type="button" className="cf-ghost" onClick={() => void toLoot()}>
            Add to party loot
          </button>
        )}
        <button
          type="button"
          className="cf-primary cfa-push"
          disabled={!name.trim()}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </>
  )
}

/** "Name: text" lines ⇄ a list of named texts. */
function TextsField({
  label,
  value,
  onChange
}: {
  label: string
  value: { name: string; text: string }[]
  onChange: (v: { name: string; text: string }[]) => void
}): React.JSX.Element {
  const [text, setText] = useState(value.map((x) => `${x.name}: ${x.text}`).join('\n'))
  return (
    <label className="cf-field">
      <span>{label}</span>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(
            e.target.value
              .split('\n')
              .map((l) => {
                const i = l.indexOf(':')
                return i > 0
                  ? { name: l.slice(0, i).trim(), text: l.slice(i + 1).trim() }
                  : { name: l.trim(), text: '' }
              })
              .filter((x) => x.name)
          )
        }}
      />
    </label>
  )
}
