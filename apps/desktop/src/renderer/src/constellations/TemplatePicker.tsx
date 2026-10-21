import {
  ACCENT_THEME,
  CONSTELLATION_TEMPLATES,
  ROLE_COLORS,
  type ConstellationTemplate
} from '@glofly/shared/constellations'
import './TemplatePicker.css'

// 0.8.0 templates (approved Templates board, with Chip's change): "Start empty" at the top (dashed
// +), a small "Choose a premade template" divider, then Friends hangout, Gaming squad and Study
// group. The right side shows what you'll get: nebulas (with "only <role>" chips), the roles
// members can pick, house rules, the welcome and the accent. The Create button takes the accent.

type Template = (typeof CONSTELLATION_TEMPLATES)[number]

/** The mockup's names for the template accents (the closest accents the app has). */
const ACCENT_NAMES: Record<ConstellationTemplate, string> = {
  blank: 'Firefly gold',
  friends: 'Firefly gold',
  gaming: 'Violet',
  study: 'Lagoon'
}

export const templateAccent = (t: Template): (typeof ACCENT_THEME)[keyof typeof ACCENT_THEME] =>
  ACCENT_THEME[t.accent]

function Choice({
  t,
  on,
  onPick
}: {
  t: Template
  on: boolean
  onPick: () => void
}): React.JSX.Element {
  const a = templateAccent(t)
  const empty = t.id === 'blank'
  return (
    <button
      type="button"
      className="cx-tpl-choice"
      aria-pressed={on}
      onClick={onPick}
      style={{ ['--tpl' as string]: a.color, ['--tpl-rgb' as string]: a.rgb }}
    >
      {empty ? (
        <span className="cx-tpl-swatch cx-tpl-swatch--empty" aria-hidden="true">
          +
        </span>
      ) : (
        <span className="cx-tpl-swatch" aria-hidden="true" />
      )}
      <span className="cx-tpl-choice-text">
        <b>{t.name}</b>
        <span>{t.what}</span>
      </span>
    </button>
  )
}

export default function TemplatePicker({
  value,
  onChange,
  busy,
  onBack,
  onCreate
}: {
  value: ConstellationTemplate
  onChange: (t: ConstellationTemplate) => void
  busy: boolean
  onBack: () => void
  onCreate: () => void
}): React.JSX.Element {
  const empty = CONSTELLATION_TEMPLATES.find((t) => t.id === 'blank')!
  const premade = CONSTELLATION_TEMPLATES.filter((t) => t.id !== 'blank')
  const cur = CONSTELLATION_TEMPLATES.find((t) => t.id === value) ?? empty
  const a = templateAccent(cur)
  const pickable = cur.roles.filter((r) => r.selfAssign)
  return (
    <div
      className="cx-tpl"
      style={{
        ['--tpl' as string]: a.color,
        ['--tpl-rgb' as string]: a.rgb,
        ['--tpl-on' as string]: a.on
      }}
    >
      <div>
        <h1 id="cx-cc-title">Start a constellation</h1>
        <p className="cx-tpl-lead">
          Pick a starting point. You can change every part of it afterwards.
        </p>
      </div>
      <div className="cx-tpl-cols">
        <div className="cx-tpl-list" role="group" aria-label="Starting points">
          <Choice t={empty} on={value === empty.id} onPick={() => onChange(empty.id)} />
          <div className="cx-tpl-divider">
            Choose a premade template
            <span aria-hidden="true" />
          </div>
          {premade.map((t) => (
            <Choice key={t.id} t={t} on={value === t.id} onPick={() => onChange(t.id)} />
          ))}
        </div>

        <section
          className="cx-tpl-get"
          aria-label={`What you'll get: ${cur.name}`}
          aria-live="polite"
        >
          <div className="cx-tpl-get-head">
            <span className="cx-tpl-dot" aria-hidden="true" />
            <b>What you&apos;ll get: {cur.name}</b>
            <span className="cx-tpl-accent">Accent: {ACCENT_NAMES[cur.id]}</span>
          </div>
          <div className="cx-tpl-get-cols">
            <div className="cx-tpl-get-col">
              <div>
                <div className="cx-tpl-caps">Nebulas</div>
                {cur.categories.map((cat) => (
                  <div key={cat.name}>
                    <div className="cx-tpl-cat">{cat.name.toUpperCase()}</div>
                    {cat.nebulas.map((n) => (
                      <div key={n.name} className="cx-tpl-neb">
                        <span className="cx-tpl-glyph" aria-hidden="true">
                          {n.kind === 'text' ? '#' : '◖'}
                        </span>
                        <span>
                          {n.kind === 'voice' && <span className="cx-tpl-sr">voice: </span>}
                          {n.name}
                        </span>
                        {n.roles?.length ? (
                          <span className="cx-tpl-only">only {n.roles.join(', ')}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div>
                <div className="cx-tpl-caps">Roles members can pick</div>
                <div className="cx-tpl-roles">
                  {pickable.map((r) => (
                    <span key={r.name} className="cx-tpl-role">
                      <span style={{ background: ROLE_COLORS[r.color].dot }} aria-hidden="true" />
                      {r.name}
                    </span>
                  ))}
                  {!pickable.length && (
                    <span className="cx-tpl-none">None, add your own later</span>
                  )}
                </div>
              </div>
            </div>
            <div className="cx-tpl-get-col">
              <div>
                <div className="cx-tpl-caps">House rules</div>
                {cur.rules.length ? (
                  <ol className="cx-tpl-rules">
                    {cur.rules.map((r, i) => (
                      <li key={i}>
                        <span aria-hidden="true">{i + 1}.</span>
                        {r}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <span className="cx-tpl-none">None yet</span>
                )}
              </div>
              <div>
                <div className="cx-tpl-caps">Welcome new members see</div>
                <div className="cx-tpl-welcome">
                  {cur.welcome ?? 'Welcome! (You write this yourself in Settings → Welcome.)'}
                </div>
              </div>
            </div>
          </div>
          <div className="cx-tpl-actions">
            <button type="button" className="cx-tpl-back" onClick={onBack}>
              Back
            </button>
            <button type="button" className="cx-tpl-create" disabled={busy} onClick={onCreate}>
              {busy ? 'Creating…' : `Create ${cur.name}`}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
