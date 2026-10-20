import { useRef, useState } from 'react'
import { DEFAULT_WELCOME, RULE_MAX, RULES_MAX } from '@glofly/shared/constellations'
import type { WelcomeSettings } from '@glofly/shared/constellations'
import type { ApiResult, ConstellationDetail } from '../../../preload/api-types'
import { api, can } from '../lib/constellations'
import { BannerArt } from './identity'
import { ACCENT_CHOICES } from './communityLib'

// 0.7.5 Constellations polish: Settings → Overview's identity and welcome parts. The accent color
// and banner photo (the approved Identity board), the house rules and what new members see (the
// Welcome and Celebrations boards), and whether invite links show a preview (the Invite board).

type Detail = ApiResult<{ constellation: ConstellationDetail }>

const WELCOME_ROWS: { key: keyof WelcomeSettings; name: string; what: string }[] = [
  {
    key: 'screen',
    name: 'Welcome new members',
    what: 'Right after they join: the description, the house rules and the roles they can pick.'
  },
  {
    key: 'joinLines',
    name: 'Say when someone joins',
    what: '“Priya joined. Say hi!” in the first text nebula, with a wave button.'
  },
  {
    key: 'milestones',
    name: 'Celebrate milestones',
    what: '10, 50, 100 and 250 members, and its birthday each year.'
  },
  {
    key: 'preview',
    name: 'Show a preview on the invite page',
    what: 'The name, picture, description and counts, for people who open an invite link. Public constellations always show it.'
  }
]

export default function IdentitySettings({
  c,
  busy,
  run,
  onProblem
}: {
  c: ConstellationDetail
  busy: boolean
  run: (task: () => Promise<Detail>) => Promise<boolean>
  onProblem: (m: string) => void
}): React.JSX.Element {
  const editable = can(c, 'manageConstellation')
  const bannerRef = useRef<HTMLInputElement>(null)
  const welcome = { ...DEFAULT_WELCOME, ...c.welcome }
  const [rules, setRules] = useState<string[]>(() => (c.rules?.length ? c.rules : []))
  const [rulesSaved, setRulesSaved] = useState(false)
  const current = c.accent ?? 'gold'
  const rulesDirty =
    rules
      .map((r) => r.trim())
      .filter(Boolean)
      .join('\n') !== (c.rules ?? []).join('\n')

  async function pickBanner(file: File | undefined): Promise<void> {
    if (!file) return
    const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!okTypes.includes(file.type) || file.size > 8 * 1024 * 1024) {
      onProblem('Pick a JPG, PNG, WebP or GIF picture up to 8 MB.')
      return
    }
    const r = await api.setBanner(c.id, await file.arrayBuffer(), file.type as 'image/png')
    if (!r.ok) onProblem(r.message)
  }

  async function saveRules(): Promise<void> {
    const ok = await run(() =>
      api.update(c.id, { rules: rules.map((r) => r.trim()).filter(Boolean) })
    )
    if (ok) {
      setRulesSaved(true)
      setTimeout(() => setRulesSaved(false), 1800)
    }
  }

  return (
    <>
      <fieldset className="cx-fieldset">
        <legend>Accent</legend>
        <p className="cx-settings-hint">
          Tints this constellation only: the open nebula, badges, Join buttons and the message box.
        </p>
        <div role="radiogroup" aria-label="Accent color" className="cx-swatches cx-accents">
          {ACCENT_CHOICES.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={current === a.id}
              aria-label={a.name}
              title={a.name}
              disabled={!editable || busy}
              className={current === a.id ? 'cx-accent cx-accent--on' : 'cx-accent'}
              style={{ background: a.color }}
              onClick={() =>
                void run(() => api.update(c.id, { accent: a.id === 'gold' ? null : a.id }))
              }
            />
          ))}
          <span className="cx-accent-name">
            {ACCENT_CHOICES.find((a) => a.id === current)?.name}
          </span>
        </div>
      </fieldset>
      <fieldset className="cx-fieldset">
        <legend>Banner</legend>
        <div className="cx-banner-pick">
          <BannerArt c={c} width={440} height={96} className="cx-banner-preview" />
          <input
            ref={bannerRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => {
              void pickBanner(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {editable && (
            <div className="cx-banner-buttons">
              <button
                type="button"
                className="cx-button"
                onClick={() => bannerRef.current?.click()}
              >
                {c.bannerVersion ? 'Change banner' : 'Add a banner photo'}
              </button>
              {c.bannerVersion && (
                <button
                  type="button"
                  className="cx-link-button cx-link-button--quiet"
                  onClick={() => void api.removeBanner(c.id)}
                >
                  Use the night sky instead
                </button>
              )}
            </div>
          )}
        </div>
      </fieldset>
      <fieldset className="cx-fieldset">
        <legend>House rules</legend>
        <p className="cx-settings-hint">
          New members agree to these before they post. Leave it empty for no rules.
        </p>
        <ol className="cx-rules-edit">
          {rules.map((r, i) => (
            <li key={i}>
              <span className="cx-rules-n">{i + 1}</span>
              <input
                type="text"
                value={r}
                maxLength={RULE_MAX}
                disabled={!editable}
                aria-label={`Rule ${i + 1}`}
                placeholder="Be kind. No hate, no harassment."
                onChange={(e) => setRules(rules.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {editable && (
                <button
                  type="button"
                  className="cx-link-button cx-link-button--danger"
                  aria-label={`Remove rule ${i + 1}`}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
        {editable && (
          <div className="cx-dialog-actions" style={{ justifyContent: 'flex-start' }}>
            {rules.length < RULES_MAX && (
              <button type="button" className="cx-button" onClick={() => setRules([...rules, ''])}>
                Add a rule
              </button>
            )}
            <button
              type="button"
              className="cx-button cx-button--primary"
              disabled={!rulesDirty || busy}
              onClick={() => void saveRules()}
            >
              {rulesSaved ? 'Saved' : 'Save rules'}
            </button>
          </div>
        )}
      </fieldset>
      <fieldset className="cx-fieldset">
        <legend>New members</legend>
        <div className="cx-perms">
          {WELCOME_ROWS.map((row, i) => (
            <label
              key={row.key}
              className={i === WELCOME_ROWS.length - 1 ? 'cx-perm cx-perm--last' : 'cx-perm'}
            >
              <span style={{ flex: 1 }}>
                <span className="cx-perm-name">{row.name}</span>
                <span className="cx-perm-what">{row.what}</span>
              </span>
              <input
                type="checkbox"
                checked={welcome[row.key]}
                disabled={!editable || busy}
                onChange={() =>
                  void run(() => api.update(c.id, { welcome: { [row.key]: !welcome[row.key] } }))
                }
              />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}
