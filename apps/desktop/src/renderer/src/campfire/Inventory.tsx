import { useEffect, useState } from 'react'
import type { SheetItem } from '@glofly/shared/campfire/types'
import {
  armorClassFromItems,
  attackExpressions,
  attackToHit,
  carriedWeight
} from '@glofly/shared/campfire/rules5e'
import {
  ATTUNEMENT_MAX,
  carryingCapacity,
  NO_COINS,
  type Coins,
  type RulesItem
} from '@glofly/shared/campfire/rulesData'
import { attackFromItem, inventoryFromItem } from '@glofly/shared/campfire/builder'
import { homebrewSheetItem, type Homebrew, type HomebrewItem } from '@glofly/shared/campfire/hub'
import { pieceId } from './api'
import { useCf } from './ctx'
import { NumBox, TextBox } from './ui'
import { campaignRules, loadHomebrew, searchItems } from './rulesApi'
import type { SheetEditor } from './sheetCore'
import './roundA.css'

// Round A: the sheet's Inventory tab (approved board "Inventory"): equip toggles that change AC
// (armor + Dexterity, shields and magic bonuses; attuned items only once attuned), weapons from
// the rules that add their attack to Actions, coins, attunement (3 at most) and carrying weight.
// Older sheets' items (just name, how many, notes) keep working: everything new is optional.

const COIN_KEYS: (keyof Coins)[] = ['cp', 'sp', 'ep', 'gp', 'pp']

const does = (it: SheetItem): string => {
  if (it.armor)
    return `${it.kind === 'shield' ? 'Shield' : 'Armor'} · AC ${it.armor.base}${it.armor.dex ? ` + Dexterity${it.armor.maxDex != null ? ` (max ${it.armor.maxDex})` : ''}` : ''}`
  if (it.acBonus) return `${it.acBonus > 0 ? '+' : ''}${it.acBonus} AC while equipped`
  return ''
}

export function InventoryTab({ ed }: { ed: SheetEditor }): React.JSX.Element {
  const { sheet, save, canEdit, lockedField } = ed
  const { t, say } = useCf()
  const rules = sheet.rules ?? campaignRules(t.campaign.settings)
  const items = sheet.inventory
  const coins = sheet.coins ?? NO_COINS
  const [adding, setAdding] = useState<'rules' | 'own' | null>(null)
  const [acNote, setAcNote] = useState<string | null>(null)
  const attuned = items.filter((i) => i.attunement && i.attuned).length
  const weight = carriedWeight(sheet)
  const capacity = carryingCapacity(sheet.abilities.str)

  /** Saves a new inventory; AC follows the equipped armor (unless a locked player sheet). */
  const commit = (inventory: SheetItem[], extra: Partial<typeof sheet> = {}): void => {
    const next = { ...sheet, ...extra, inventory }
    const ac = armorClassFromItems(next)
    if (ac != null && ac !== sheet.ac && !lockedField) {
      setAcNote(`was ${sheet.ac}`)
      window.setTimeout(() => setAcNote(null), 6000)
      next.ac = ac
    }
    save(next)
  }
  const change = (id: string, patch: Partial<SheetItem>): void =>
    commit(items.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (it: SheetItem): void =>
    commit(
      items.filter((x) => x.id !== it.id),
      it.attackId ? { attacks: sheet.attacks.filter((a) => a.id !== it.attackId) } : {}
    )
  const addRulesItem = (r: RulesItem): void => {
    const id = pieceId('i')
    const item = inventoryFromItem(r, id, false)
    const attack = attackFromItem(r, sheet.abilities, pieceId('a'))
    if (attack) item.attackId = attack.id
    commit([...items, item], attack ? { attacks: [...sheet.attacks, attack] } : {})
    say(attack ? `${r.name} added. Its attack is in Actions.` : `${r.name} added.`)
  }
  const addHomebrew = (h: Homebrew): void => {
    commit([
      ...items,
      {
        id: pieceId('i'),
        name: h.name,
        qty: 1,
        notes: (h.data as HomebrewItem).text.slice(0, 500),
        ...homebrewSheetItem(h.data as HomebrewItem, h.id)
      }
    ])
    say(`${h.name} added.`)
  }

  return (
    <div className="cfa-inv">
      <section className="cfs-section" aria-label="Equipment">
        <div className="cfa-inline-row">
          <h3 className="cfa-grow" style={{ margin: 0 }}>
            Equipment{' '}
            {acNote && (
              <span className="cfa-tag">
                AC {sheet.ac} · {acNote}
              </span>
            )}
          </h3>
          {canEdit && (
            <>
              <button
                type="button"
                className={adding === 'rules' ? 'cf-primary' : 'cf-ghost'}
                onClick={() => setAdding(adding === 'rules' ? null : 'rules')}
              >
                + Add from the rules
              </button>
              <button
                type="button"
                className={adding === 'own' ? 'cf-primary' : 'cf-ghost'}
                onClick={() => setAdding(adding === 'own' ? null : 'own')}
              >
                + Your own item
              </button>
            </>
          )}
        </div>
        {adding === 'rules' && (
          <RulesSearch
            rules={rules}
            onAdd={addRulesItem}
            campaignId={t.campaign.id}
            onHomebrew={addHomebrew}
          />
        )}
        {adding === 'own' && (
          <OwnItem
            onAdd={(it) => {
              commit([...items, it])
              setAdding(null)
            }}
          />
        )}
        <table className="cfs-table cfa-inv-table">
          <thead>
            <tr>
              <th scope="col">Equipped</th>
              <th scope="col">Item</th>
              <th scope="col">What it does</th>
              <th scope="col" className="cfs-table-qty">
                Weight
              </th>
              {canEdit && (
                <th scope="col">
                  <span className="cf-sr">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const wearable = !!(
                it.armor ||
                it.acBonus ||
                it.kind === 'weapon' ||
                it.kind === 'shield' ||
                it.kind === 'magic' ||
                it.kind === 'armor'
              )
              const atk = it.attackId ? sheet.attacks.find((a) => a.id === it.attackId) : null
              return (
                <tr key={it.id} className={it.equipped ? 'cfa-inv-on' : ''}>
                  <td>
                    {wearable && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!it.equipped}
                        aria-label={`${it.name} equipped`}
                        disabled={!canEdit}
                        className="cfa-switch"
                        onClick={() => {
                          // One suit of armor at a time: putting on armor takes the other off.
                          const on = !it.equipped
                          commit(
                            items.map((x) =>
                              x.id === it.id
                                ? { ...x, equipped: on }
                                : on &&
                                    it.armor &&
                                    it.kind !== 'shield' &&
                                    x.armor &&
                                    x.kind !== 'shield'
                                  ? { ...x, equipped: false }
                                  : x
                            )
                          )
                        }}
                      />
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <TextBox
                        className="cfs-inline-text cfs-inline-text--bold"
                        label="Item name"
                        value={it.name}
                        maxLength={80}
                        onChange={(v) => v.trim() && change(it.id, { name: v.trim() })}
                      />
                    ) : (
                      <b>{it.name}</b>
                    )}
                    <span className="cfa-inv-sub">
                      {canEdit ? (
                        <NumBox
                          label={`How many ${it.name}`}
                          className="cfs-qty"
                          value={it.qty}
                          min={0}
                          max={99999}
                          onChange={(n) => change(it.id, { qty: n })}
                        />
                      ) : (
                        `× ${it.qty}`
                      )}
                      {it.homebrewId && <span className="cfa-tag">Homebrew</span>}
                      {it.rarity && <span className="cf-sub">{it.rarity}</span>}
                      {it.attunement && (
                        <label className="cf-check">
                          <input
                            type="checkbox"
                            disabled={!canEdit || (!it.attuned && attuned >= ATTUNEMENT_MAX)}
                            checked={!!it.attuned}
                            onChange={(e) => change(it.id, { attuned: e.target.checked })}
                          />{' '}
                          Attuned
                        </label>
                      )}
                    </span>
                  </td>
                  <td>
                    {atk && (
                      <span className="cfa-inv-sub">
                        {signed(attackToHit(sheet, atk))} to hit ·{' '}
                        {attackExpressions(sheet, atk).damage} {atk.damageType}
                      </span>
                    )}
                    {does(it) && <span className="cfa-inv-sub">{does(it)}</span>}
                    {canEdit ? (
                      <TextBox
                        className="cfs-inline-text"
                        label={`${it.name} notes`}
                        placeholder="Notes"
                        value={it.notes}
                        maxLength={500}
                        onChange={(v) => change(it.id, { notes: v })}
                      />
                    ) : (
                      <span className="cf-sub">{it.notes}</span>
                    )}
                  </td>
                  <td className="cfs-table-qty">
                    {canEdit ? (
                      <NumBox
                        label={`${it.name} weight in pounds`}
                        className="cfs-qty"
                        value={it.weight ?? 0}
                        min={0}
                        max={9999}
                        onChange={(n) => change(it.id, { weight: n })}
                      />
                    ) : (
                      `${it.weight ?? 0} lb`
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="cfs-x"
                        aria-label={`Remove ${it.name}`}
                        onClick={() => remove(it)}
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {items.length === 0 && <p className="cfs-hint">Nothing carried yet.</p>}
        <p className="cf-sub">
          Equipping armor or a shield updates AC; weapons from the rules show up in Actions with
          their to-hit and damage.
        </p>
      </section>
      <aside className="cfa-inv-side">
        <section className="cfa-setting" aria-label="Coins">
          <b>Coins</b>
          <div className="cfa-coins">
            {COIN_KEYS.map((k) => (
              <label key={k} className="cfa-mini">
                <span>{k.toUpperCase()}</span>
                {canEdit ? (
                  <NumBox
                    label={k}
                    value={coins[k]}
                    min={0}
                    max={9_999_999}
                    onChange={(n) => save({ ...sheet, coins: { ...coins, [k]: n } })}
                  />
                ) : (
                  <b>{coins[k]}</b>
                )}
              </label>
            ))}
          </div>
        </section>
        <section className="cfa-setting" aria-label="Attunement">
          <b>
            Attunement {attuned} of {ATTUNEMENT_MAX}
          </b>
          <div className="cfa-dots" aria-hidden="true">
            {Array.from({ length: ATTUNEMENT_MAX }, (_, i) => (
              <span key={i} className={`cfa-dot${i < attuned ? ' cfa-dot--yes' : ''}`} />
            ))}
          </div>
          <span className="cf-sub">Attuning takes a short rest with the item.</span>
        </section>
        <section className="cfa-setting" aria-label="Carrying">
          <b>
            Carrying {weight} / {capacity} lb
          </b>
          <div className="cfa-bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.min(100, capacity ? (weight / capacity) * 100 : 0)}%`,
                background: weight > capacity ? 'var(--cf-danger, #ff6b6b)' : undefined
              }}
            />
          </div>
          <span className="cf-sub">
            Strength {sheet.abilities.str} × 15. Coins count 50 to the pound.
          </span>
        </section>
      </aside>
    </div>
  )
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

function RulesSearch({
  rules,
  onAdd,
  campaignId,
  onHomebrew
}: {
  rules: '2014' | '2024'
  onAdd: (r: RulesItem) => void
  campaignId: string
  onHomebrew: (h: Homebrew) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<RulesItem[]>([])
  const [brew, setBrew] = useState<Homebrew[]>([])
  useEffect(() => {
    void loadHomebrew(campaignId, 'item').then(setBrew)
  }, [campaignId])
  useEffect(() => {
    const id = window.setTimeout(() => void searchItems(rules, q).then(setFound), 200)
    return () => window.clearTimeout(id)
  }, [rules, q])
  const brewHits = brew.filter((h) => h.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="cfa-box">
      <input
        className="cfa-search"
        autoFocus
        aria-label="Search the rules' items"
        placeholder="Longsword, chain mail, rope…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="cfa-list" style={{ maxHeight: 260, overflow: 'auto' }}>
        {brewHits.map((h) => (
          <li key={h.id} className="cfa-row">
            <b className="cfa-grow">
              {h.name} <span className="cfa-tag">Homebrew</span>
            </b>
            <button type="button" className="cf-ghost" onClick={() => onHomebrew(h)}>
              Add
            </button>
          </li>
        ))}
        {found.slice(0, 40).map((r) => (
          <li key={r.id} className="cfa-row">
            <span className="cfa-grow">
              <b>{r.name}</b>{' '}
              <span className="cf-sub">
                {r.weapon
                  ? `${r.weapon.damage} ${r.weapon.type}`
                  : r.armor
                    ? `AC ${r.armor.base}${r.armor.dex ? ' + Dex' : ''}`
                    : r.kind}{' '}
                · {r.weight} lb
              </span>
            </span>
            <button type="button" className="cf-ghost" onClick={() => onAdd(r)}>
              Add
            </button>
          </li>
        ))}
        {!found.length && !brewHits.length && <li className="cf-sub">Nothing by that name.</li>}
      </ul>
    </div>
  )
}

function OwnItem({ onAdd }: { onAdd: (it: SheetItem) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [weight, setWeight] = useState(0)
  const [ac, setAc] = useState(0)
  const [attune, setAttune] = useState(false)
  return (
    <form
      className="cfa-box cfa-inline-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd({
          id: pieceId('i'),
          name: name.trim().slice(0, 80),
          qty,
          notes: '',
          weight,
          kind: ac || attune ? 'magic' : 'gear',
          ...(ac ? { acBonus: ac } : {}),
          ...(attune ? { attunement: true } : {})
        })
      }}
    >
      <input
        className="cfa-grow"
        autoFocus
        aria-label="Item name"
        placeholder="Rope, 50 ft"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className="cfa-inline">
        <span>How many</span>
        <input
          type="number"
          min={0}
          max={99999}
          value={qty}
          onChange={(e) => setQty(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <label className="cfa-inline">
        <span>Weight (lb)</span>
        <input
          type="number"
          min={0}
          value={weight}
          onChange={(e) => setWeight(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <label className="cfa-inline">
        <span>AC bonus</span>
        <input
          type="number"
          min={-5}
          max={10}
          value={ac}
          onChange={(e) => setAc(Number(e.target.value) || 0)}
        />
      </label>
      <label className="cf-check">
        <input type="checkbox" checked={attune} onChange={(e) => setAttune(e.target.checked)} />{' '}
        Needs attunement
      </label>
      <button type="submit" className="cf-primary" disabled={!name.trim()}>
        Add
      </button>
    </form>
  )
}
