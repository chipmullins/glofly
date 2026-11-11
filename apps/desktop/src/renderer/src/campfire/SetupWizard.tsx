import { useEffect, useState } from 'react'
import type { CampaignSettings } from '@glofly/shared/campfire/types'
import { creditFor, rulesOf, type RulesSet } from '@glofly/shared/campfire/rulesData'
import { HUB_LIMITS, type CampaignHub } from '@glofly/shared/campfire/hub'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { useCf } from './ctx'
import { CfWindow } from './sheetBits'
import { loadHub } from './rulesApi'
import './sheet.css'
import './roundA.css'

// Round A: the game master's setup (approved boards "GmSetup" and "SwitchOver"). Shown once
// right after "New campaign" and again from the hub as the campaign settings (step 2).
// Step 1 asks "new story or one you're in the middle of?": continuing saves the sessions played,
// the party level, the story so far (the hub's first recap) and open quests.

type Step = 1 | 2 | 3 | 4 | 5
const STEPS: { n: Step; title: string; sub: string }[] = [
  { n: 1, title: 'Name and picture', sub: '' },
  { n: 2, title: 'Rules and table', sub: 'How your game runs' },
  { n: 3, title: 'Invite players', sub: 'Who’s at the table' },
  { n: 4, title: 'First scene', sub: 'Upload a map or build one' },
  { n: 5, title: 'First session', sub: 'Day, time and reminders' }
]

export function SetupWizard({
  start = 1,
  onClose,
  onScene
}: {
  start?: Step
  onClose: () => void
  /** Step 4's buttons: the table makes the scene (upload / build) */
  onScene: (kind: 'upload' | 'build') => Promise<void> | void
}): React.JSX.Element {
  const { t, ctl, say, me } = useCf()
  const [step, setStep] = useState<Step>(start)
  const [done, setDone] = useState<Set<Step>>(new Set())
  const [hub, setHub] = useState<CampaignHub | null>(null)
  const [name, setName] = useState(t.campaign.name)
  const [pitch, setPitch] = useState('')
  const [banner, setBanner] = useState<string | null>(null)
  const [continuing, setContinuing] = useState(false)
  const [sessionsBefore, setSessionsBefore] = useState(0)
  const [level, setLevel] = useState(1)
  const [story, setStory] = useState('')
  const [quests, setQuests] = useState('')
  const [settings, setSettings] = useState<CampaignSettings>(t.campaign.settings)
  const [title, setTitle] = useState('')
  const [day, setDay] = useState('')
  const [time, setTime] = useState('19:00')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadHub(t.campaign.id).then((h) => {
      if (!h) return
      setHub(h)
      setPitch(h.pitch)
      setBanner(h.bannerFileId)
      setSessionsBefore(h.progress.sessionsBefore)
      setLevel(h.progress.level)
      setContinuing(h.progress.sessionsBefore > 0 || h.sessions.some((s) => s.before))
    })
  }, [t.campaign.id])

  const rules: RulesSet = rulesOf(settings)
  const set = <K extends keyof CampaignSettings>(k: K, v: CampaignSettings[K]): void =>
    setSettings((s) => ({ ...s, [k]: v }))

  /** Saves the step on screen; false if something was refused. */
  const save = async (): Promise<boolean> => {
    setBusy(true)
    try {
      if (step === 1) {
        if (name.trim() && name.trim() !== t.campaign.name) {
          const r = await cf.patch(`/campfire/campaigns/${t.campaign.id}`, { name: name.trim() })
          if (!r.ok) return (say(r.message), false)
        }
        const r = await cf.patch(`/campfire/campaigns/${t.campaign.id}/hub`, {
          pitch,
          bannerFileId: banner
        })
        if (!r.ok) return (say(r.message), false)
        if (continuing) {
          const c = await cf.post(`/campfire/campaigns/${t.campaign.id}/continue`, {
            sessionsBefore,
            level,
            ...(story.trim() ? { story: story.trim() } : {}),
            quests: quests
              .split('\n')
              .map((q) => q.trim())
              .filter(Boolean)
              .slice(0, 30)
          })
          if (!c.ok) return (say(c.message), false)
          setQuests('') // saved once; going back and forward doesn't add them again
        }
      }
      if (step === 2) {
        const r = await cf.patch(`/campfire/campaigns/${t.campaign.id}`, {
          settings: {
            gmApprovesDamage: settings.gmApprovesDamage,
            showMonsterHp: settings.showMonsterHp,
            diceVisibility: settings.diceVisibility,
            rules,
            moveOnTurn: !!settings.moveOnTurn,
            leveling: settings.leveling ?? 'milestone',
            diagonal: settings.diagonal ?? '5'
          }
        })
        if (!r.ok) return (say(r.message), false)
      }
      if (step === 5 && day) {
        const startsAt = new Date(`${day}T${time || '19:00'}`)
        if (Number.isNaN(startsAt.getTime()))
          return (say('That day or time doesn’t look right.'), false)
        const r = await cf.post(`/campfire/campaigns/${t.campaign.id}/sessions`, {
          title: title.trim(),
          startsAt: startsAt.toISOString()
        })
        if (!r.ok) return (say(r.message), false)
      }
      setDone((d) => new Set(d).add(step))
      return true
    } finally {
      setBusy(false)
    }
  }
  const next = async (): Promise<void> => {
    if (!(await save())) return
    if (step === 5) {
      ctl.reload()
      onClose()
      return
    }
    setStep((step + 1) as Step)
  }

  const pickBanner = async (): Promise<void> => {
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return
    say('Uploading the picture…')
    const up = await uploadFile(t.campaign.id, 'handout', file)
    if (!up.ok) return say(up.message)
    setBanner(up.data.id)
    say('Picture ready.')
  }

  const where = t.campaign.home.kind === 'nebula' ? 'voice nebula' : 'group'
  const nextLabel = step === 5 ? 'Finish setup' : `Next: ${STEPS[step].title.toLowerCase()}`

  return (
    <CfWindow label="Campaign setup" onClose={onClose} className="cfa-window">
      <div className="cfa-wizard">
        <nav className="cfa-rail" aria-label="Setup steps">
          <span className="cfa-kicker">{start === 1 ? 'New campaign' : 'Campaign settings'}</span>
          <h2 style={{ margin: '0 0 12px' }}>{name || t.campaign.name}</h2>
          <ol>
            {STEPS.map((s) => (
              <li key={s.n}>
                <button
                  type="button"
                  className="cfa-rail-step"
                  aria-current={step === s.n ? 'step' : undefined}
                  onClick={() => setStep(s.n)}
                >
                  <span
                    className={`cfa-rail-num${done.has(s.n) && step !== s.n ? ' cfa-rail-num--done' : ''}`}
                  >
                    {done.has(s.n) && step !== s.n ? '✓' : s.n}
                  </span>
                  <span>
                    <b>{s.title}</b>
                    {s.n === 1 ? name || 'Name it' : s.sub}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="cfa-rail-note">
            <b style={{ color: 'var(--cf-ink)' }}>Everything here can change later</b>
            <br />
            The campaign hub’s Settings button opens this again. Skip ahead any time: the table
            works with the defaults.
          </div>
        </nav>
        <div className="cfa-wiz-main">
          <div className="cfa-wiz-body">
            <div>
              <span className="cfa-kicker">Step {step} of 5</span>
              <h1 style={{ margin: '4px 0' }}>
                {step === 1 ? 'New story or one you’re in the middle of?' : STEPS[step - 1].title}
              </h1>
              {step === 2 && (
                <p className="cf-sub">
                  Which rulebook the character builder and the monster list use, and how the table
                  behaves. Each choice says what players will see.
                </p>
              )}
            </div>

            {step === 1 && (
              <>
                <div className="cfa-two">
                  <label className="cf-field">
                    <span>Name</span>
                    <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                  </label>
                  <label className="cf-field">
                    <span>One line pitch (players see it on the hub)</span>
                    <input
                      value={pitch}
                      maxLength={HUB_LIMITS.pitch}
                      placeholder="A drowned temple, a bell that won’t stop ringing"
                      onChange={(e) => setPitch(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="cfa-banner-pick"
                  style={
                    banner
                      ? { backgroundImage: `url("${fileUrl(banner)}")`, color: 'transparent' }
                      : undefined
                  }
                  onClick={() => void pickBanner()}
                >
                  {banner ? 'Change the picture' : '+ Banner picture (optional)'}
                </button>
                <div className="cfa-two" role="radiogroup" aria-label="New story or continuing">
                  {[
                    {
                      on: false,
                      b: 'Starting fresh',
                      s: 'Session 1, characters at level 1 (or the level you pick)'
                    },
                    {
                      on: true,
                      b: 'Continuing a campaign',
                      s: 'Coming from Roll20, another app, Discord or the kitchen table'
                    }
                  ].map((o) => (
                    <label
                      key={o.b}
                      className={`cfa-radio-card${continuing === o.on ? ' cfa-radio-card--on' : ''}`}
                    >
                      <input
                        type="radio"
                        name="cfa-fresh"
                        checked={continuing === o.on}
                        onChange={() => setContinuing(o.on)}
                      />
                      <span>
                        <b>{o.b}</b>
                        <span>{o.s}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {continuing ? (
                  <div className="cfa-box">
                    <div className="cfa-inline-row">
                      <label className="cfa-inline">
                        <span>Sessions played so far</span>
                        <input
                          type="number"
                          min={0}
                          max={999}
                          value={sessionsBefore}
                          onChange={(e) =>
                            setSessionsBefore(
                              Math.max(0, Math.min(999, Number(e.target.value) || 0))
                            )
                          }
                        />
                      </label>
                      <label className="cfa-inline">
                        <span>Party level</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={level}
                          onChange={(e) =>
                            setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                          }
                        />
                      </label>
                    </div>
                    <label className="cf-field">
                      <span>The story so far (becomes the first recap in the hub)</span>
                      <textarea
                        rows={4}
                        value={story}
                        maxLength={HUB_LIMITS.recap}
                        placeholder="The party cleared the docks, made an enemy of…"
                        onChange={(e) => setStory(e.target.value)}
                      />
                    </label>
                    <label className="cf-field">
                      <span>Open quests (one per line)</span>
                      <textarea
                        rows={3}
                        value={quests}
                        onChange={(e) => setQuests(e.target.value)}
                      />
                    </label>
                    <span className="cf-sub">
                      Players bring their characters at level {level}: import a character sheet PDF,
                      copy the numbers in from another sheet, or build one at that level. Upload
                      your map pictures as scenes in step 4.
                    </span>
                  </div>
                ) : (
                  <label className="cfa-inline">
                    <span>Characters start at level</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={level}
                      onChange={(e) =>
                        setLevel(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                      }
                      onBlur={() =>
                        void cf.patch(`/campfire/campaigns/${t.campaign.id}/hub`, {
                          progress: { sessionsBefore: 0, level }
                        })
                      }
                    />
                  </label>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <section className="cfa-section">
                  <h3>Rules set</h3>
                  <div className="cfa-two" role="radiogroup" aria-label="Rules set">
                    {(
                      [
                        {
                          id: '2024',
                          b: '5e, 2024 rules',
                          tag: 'Newer',
                          s: 'Backgrounds give the ability score bonuses; species give traits. Weapon masteries, updated spells and monsters.',
                          m: 'System Reference Document 5.2'
                        },
                        {
                          id: '2014',
                          b: '5e, 2014 rules',
                          tag: '',
                          s: 'Species (races) give the ability score bonuses. Pick this if your group plays the older books.',
                          m: 'System Reference Document 5.1'
                        }
                      ] as const
                    ).map((o) => (
                      <label
                        key={o.id}
                        className={`cfa-radio-card${rules === o.id ? ' cfa-radio-card--on' : ''}`}
                      >
                        <input
                          type="radio"
                          name="cfa-rules"
                          checked={rules === o.id}
                          onChange={() => set('rules', o.id)}
                        />
                        <span>
                          <b>
                            {o.b} {o.tag && <span className="cfa-tag">{o.tag}</span>}
                          </b>
                          <span>{o.s}</span>
                          <span className="cf-sub">{o.m}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="cf-sub">
                    Both are free to use (CC BY 4.0). Your homebrew works with either. Characters
                    made before a switch keep their numbers.
                  </p>
                </section>
                <section className="cfa-section">
                  <h3>How the table behaves</h3>
                  <Toggle
                    on={settings.gmApprovesDamage}
                    set={(v) => set('gmApprovesDamage', v)}
                    b="You approve damage"
                    s="Hits wait for you to apply, change or skip them, so you can fudge a roll or add a resistance. Off: damage lands at once."
                  />
                  <Toggle
                    on={!!settings.moveOnTurn}
                    set={(v) => set('moveOnTurn', v)}
                    b="Players move only on their turn"
                    s="During a fight, tokens lock until it’s that player’s turn. Outside fights everyone moves freely."
                  />
                  <Seg
                    b="Monster health players see"
                    value={settings.showMonsterHp}
                    set={(v) => set('showMonsterHp', v)}
                    opts={[
                      ['exact', 'Numbers'],
                      ['bloodied', 'Bloodied only'],
                      ['none', 'Nothing']
                    ]}
                    s={
                      settings.showMonsterHp === 'bloodied'
                        ? 'Bloodied: the bar turns red under half, no numbers.'
                        : settings.showMonsterHp === 'exact'
                          ? 'Players see each monster’s hit points.'
                          : 'Players see no health bar on monsters.'
                    }
                  />
                  <Seg
                    b="Players’ rolls"
                    value={settings.diceVisibility}
                    set={(v) => set('diceVisibility', v)}
                    opts={[
                      ['all', 'Everyone sees them'],
                      ['gm', 'Only you']
                    ]}
                    s="Your own rolls can always be secret."
                  />
                  <Seg
                    b="Leveling"
                    value={settings.leveling ?? 'milestone'}
                    set={(v) => set('leveling', v)}
                    opts={[
                      ['milestone', 'Milestones'],
                      ['xp', 'Experience points']
                    ]}
                    s={
                      (settings.leveling ?? 'milestone') === 'milestone'
                        ? 'Milestones: you level the party up from the campaign hub.'
                        : 'Experience points: each sheet keeps its own XP.'
                    }
                  />
                  <Seg
                    b="Diagonals"
                    value={settings.diagonal ?? '5'}
                    set={(v) => set('diagonal', v)}
                    opts={[
                      ['5', '5 ft each'],
                      ['5-10', '5 then 10 ft']
                    ]}
                    s="How the ruler and movement count a diagonal square."
                  />
                </section>
              </>
            )}

            {step === 3 && (
              <>
                <p className="cfa-lead">
                  Everyone in this {where} can open the table. People who join show up here; make
                  someone a co-game master so they can run things with you.
                </p>
                <ul className="cfa-people">
                  {t.members.map((m) => (
                    <li key={m.userId} className="cfa-row">
                      <b className="cfa-grow">
                        {m.user?.displayName ?? 'Someone'}
                        {m.userId === me.id ? ' (you)' : ''}
                      </b>
                      {m.userId === me.id ? (
                        <span className="cfa-tag">Game master</span>
                      ) : (
                        <label className="cf-check">
                          <input
                            type="checkbox"
                            checked={m.role === 'gm'}
                            onChange={async (e) => {
                              const r = await cf.put(
                                `/campfire/campaigns/${t.campaign.id}/members/${m.userId}`,
                                { role: e.target.checked ? 'gm' : 'player' }
                              )
                              if (!r.ok) say(r.message)
                              else ctl.reload()
                            }}
                          />{' '}
                          Co-game master
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
                {t.members.length <= 1 && (
                  <p className="cf-sub">
                    No one else has opened it yet. Light Campfire in a call and everyone there sees
                    “Join”.
                  </p>
                )}
                <p className="cf-sub">
                  {continuing
                    ? `When they join, they’re asked to bring their character at level ${level}.`
                    : 'When they join, the character builder walks them through making a character.'}
                </p>
              </>
            )}

            {step === 4 && (
              <>
                <p className="cfa-lead">
                  The first map players see. You can add more scenes any time from the table’s “Maps
                  and scenes”.
                </p>
                <div className="cfa-two">
                  <button
                    type="button"
                    className="cfa-choice"
                    onClick={() => void onScene('upload')}
                  >
                    <span className="cfa-choice-text">
                      <b>Upload a map picture</b>
                      <span>PNG, JPG or WebP. Line the grid up on the table afterwards.</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cfa-choice"
                    onClick={() => void onScene('build')}
                  >
                    <span className="cfa-choice-text">
                      <b>Build one</b>
                      <span>Floors, walls, doors and lights with the map builder.</span>
                    </span>
                  </button>
                </div>
                {t.scenes.length > 0 && (
                  <p className="cf-sub">
                    ✓ {t.scenes.length} scene{t.scenes.length === 1 ? '' : 's'} ready:{' '}
                    {t.scenes.map((s) => s.name).join(', ')}
                  </p>
                )}
              </>
            )}

            {step === 5 && (
              <>
                <p className="cfa-lead">
                  Players can say if they’re coming, and everyone gets a reminder a day before and
                  half an hour before.
                </p>
                <div className="cfa-inline-row">
                  <label className="cf-field cfa-grow">
                    <span>Title (optional)</span>
                    <input
                      value={title}
                      maxLength={HUB_LIMITS.title}
                      placeholder="Into the crypt"
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label className="cf-field">
                    <span>Day</span>
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                  </label>
                  <label className="cf-field">
                    <span>Time</span>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </label>
                </div>
                {hub && hub.sessions.filter((s) => !s.before).length > 0 && (
                  <p className="cf-sub">
                    Already planned: {hub.sessions.filter((s) => !s.before).length} session(s). See
                    the hub’s Sessions tab.
                  </p>
                )}
                {!day && (
                  <p className="cf-sub">No day yet? Finish anyway and plan it from the hub.</p>
                )}
              </>
            )}
          </div>
          <div className="cfa-wiz-foot">
            <button
              type="button"
              className="cf-ghost"
              disabled={step === 1}
              onClick={() => setStep((step - 1) as Step)}
            >
              Back
            </button>
            <span className="cf-sub">{creditFor(rules)}</span>
            {step < 5 && (
              <button type="button" className="cf-ghost" onClick={onClose}>
                {start === 1 ? 'Skip setup' : 'Close'}
              </button>
            )}
            <button
              type="button"
              className="cf-primary"
              disabled={busy || (step === 1 && !name.trim())}
              onClick={() => void next()}
            >
              {nextLabel}
            </button>
          </div>
        </div>
      </div>
    </CfWindow>
  )
}

function Toggle({
  on,
  set,
  b,
  s
}: {
  on: boolean
  set: (v: boolean) => void
  b: string
  s: string
}): React.JSX.Element {
  return (
    <div className="cfa-setting">
      <div className="cfa-setting-row">
        <div>
          <b>{b}</b>
          <span className="cf-sub">{s}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={b}
          className="cfa-switch"
          onClick={() => set(!on)}
        />
      </div>
    </div>
  )
}

function Seg<T extends string>({
  b,
  s,
  value,
  set,
  opts
}: {
  b: string
  s: string
  value: T
  set: (v: T) => void
  opts: [T, string][]
}): React.JSX.Element {
  return (
    <div className="cfa-setting">
      <b>{b}</b>
      <div className="cfa-seg" role="radiogroup" aria-label={b}>
        {opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={value === v ? 'cfa-seg-on' : ''}
            onClick={() => set(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="cf-sub">{s}</span>
    </div>
  )
}
