import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ONBOARDING_ANSWERS_MAX,
  ONBOARDING_DESCRIPTION_MAX,
  ONBOARDING_LABEL_MAX,
  ONBOARDING_QUESTIONS_MAX,
  ONBOARDING_TITLE_MAX,
  accentOf,
  onboardingQuestionLine
} from '@glofly/shared/constellations'
import type {
  ConstellationDetail,
  Nebula,
  OnboardingAnswer,
  OnboardingQuestion
} from '../../../preload/api-types'
import { api } from '../lib/constellations'
import './Onboarding.css'

// Communities round 4.3 (approved boards 25–27): onboarding.
//  - OnboardingSetup: Settings → Onboarding (questions, answers, "Everyone sees").
//  - OnboardingFlow: what a new member answers right after the welcome screen, then "Your …".
//  - YourAnswersDialog: "Your answers & nebulas" (change an answer, Browse nebulas).
// The server checks everything again (answers only give roles members may pick themselves and
// only show optional nebulas; constellations/onboarding.ts).

const newId = (): string => Math.random().toString(36).slice(2, 12)

/** Should the questions show now? (After the welcome screen, once.) */
export function needsOnboarding(c: ConstellationDetail): boolean {
  return (
    !!c.onboarding?.enabled &&
    !!c.onboarding.questions.length &&
    !!c.me.onboarding &&
    c.me.onboarding.onboardedAt === null &&
    !c.me.owner
  )
}

/** Nebulas for everyone (not role-only, not in a role-only category): the ones that can be optional. */
function forEveryone(c: ConstellationDetail): Nebula[] {
  return c.nebulas.filter((n) => {
    const cat = c.categories.find((x) => x.id === n.categoryId)
    return n.visibility !== 'roles' && cat?.visibility !== 'roles'
  })
}

/** Role-only nebulas a role opens (what "shows #rocket-league" means for "gives Rocket League"). */
function opensFor(c: ConstellationDetail, roleIds: string[]): Nebula[] {
  return c.nebulas.filter(
    (n) => n.visibility === 'roles' && n.roleIds?.some((r) => roleIds.includes(r))
  )
}

const label = (n: Pick<Nebula, 'kind' | 'name'>): string =>
  n.kind === 'voice' ? n.name : `#${n.name}`

// ───────────── Settings → Onboarding (board 25) ─────────────

function Switch({
  on,
  label: l,
  onChange,
  disabled
}: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={l}
      disabled={disabled}
      className={on ? 'am-switch am-switch--on' : 'am-switch'}
      onClick={() => onChange(!on)}
    >
      <span className="am-knob" />
    </button>
  )
}

function AnswerEditor({
  c,
  answer,
  optionalIds,
  onChange,
  onRemove,
  onDone
}: {
  c: ConstellationDetail
  answer: OnboardingAnswer
  optionalIds: Set<string>
  onChange: (a: OnboardingAnswer) => void
  onRemove: () => void
  onDone: () => void
}): React.JSX.Element {
  const pickable = c.roles.filter((r) => r.selfAssign && r.kind === 'custom')
  const optional = c.nebulas.filter((n) => optionalIds.has(n.id))
  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
  return (
    <div className="ob-answer ob-answer--editing">
      <div className="ob-answer-fields">
        <label className="ob-emoji-field">
          <span className="sr-only">Emoji</span>
          <input
            value={answer.emoji}
            maxLength={8}
            placeholder="🙂"
            onChange={(e) => onChange({ ...answer, emoji: e.target.value })}
          />
        </label>
        <label className="ob-grow">
          <span className="sr-only">Answer</span>
          <input
            autoFocus
            value={answer.label}
            maxLength={ONBOARDING_LABEL_MAX}
            placeholder="Answer"
            onChange={(e) => onChange({ ...answer, label: e.target.value })}
          />
        </label>
      </div>
      <label>
        <span className="sr-only">Description</span>
        <input
          value={answer.description}
          maxLength={ONBOARDING_DESCRIPTION_MAX}
          placeholder="A few words (optional)"
          onChange={(e) => onChange({ ...answer, description: e.target.value })}
        />
      </label>
      <span className="ob-pick-head">Gives roles</span>
      <div className="ob-pick">
        {pickable.length ? (
          pickable.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={answer.roleIds.includes(r.id)}
              className={
                answer.roleIds.includes(r.id)
                  ? 'ob-chip ob-chip--role ob-chip--on'
                  : 'ob-chip ob-chip--off'
              }
              onClick={() => onChange({ ...answer, roleIds: toggle(answer.roleIds, r.id) })}
            >
              {r.name}
            </button>
          ))
        ) : (
          <span className="ob-muted">No roles members pick themselves yet (Settings → Roles).</span>
        )}
      </div>
      <span className="ob-pick-head">Shows optional nebulas</span>
      <div className="ob-pick">
        {optional.length ? (
          optional.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-pressed={answer.nebulaIds.includes(n.id)}
              className={
                answer.nebulaIds.includes(n.id)
                  ? 'ob-chip ob-chip--nebula ob-chip--on'
                  : 'ob-chip ob-chip--off'
              }
              onClick={() => onChange({ ...answer, nebulaIds: toggle(answer.nebulaIds, n.id) })}
            >
              {label(n)}
            </button>
          ))
        ) : (
          <span className="ob-muted">
            Take a nebula out of “Everyone sees” to make it optional.
          </span>
        )}
      </div>
      <div className="ob-answer-actions">
        <button type="button" className="ob-link ob-link--danger" onClick={onRemove}>
          Remove answer
        </button>
        <button
          type="button"
          className="ix-btn ix-btn--small"
          onClick={onDone}
          disabled={!answer.label.trim()}
        >
          Done
        </button>
      </div>
    </div>
  )
}

export function OnboardingSetup({
  c,
  onChanged,
  onProblem
}: {
  c: ConstellationDetail
  onChanged: (next: ConstellationDetail) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [enabled, setEnabled] = useState(!!c.onboarding?.enabled)
  const [questions, setQuestions] = useState<OnboardingQuestion[]>(
    () => c.onboarding?.questions ?? []
  )
  const [optionalIds, setOptionalIds] = useState<Set<string>>(
    () => new Set(c.nebulas.filter((n) => n.optional).map((n) => n.id))
  )
  const [at, setAt] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saved, setSaved] = useState(false)
  const drag = useRef<number | null>(null)
  const open = forEveryone(c)
  const everyoneSees = open.filter((n) => !optionalIds.has(n.id))
  const canMakeOptional = open.filter((n) => optionalIds.has(n.id))
  const q = questions[at] as OnboardingQuestion | undefined

  const change = (next: OnboardingQuestion): void => {
    setSaved(false)
    setQuestions((list) => list.map((x, i) => (i === at ? next : x)))
  }
  function addQuestion(): void {
    if (questions.length >= ONBOARDING_QUESTIONS_MAX) return
    const aid = newId()
    setQuestions((list) => [
      ...list,
      {
        id: newId(),
        title: '',
        multi: true,
        required: false,
        answers: [{ id: aid, emoji: '', label: '', description: '', roleIds: [], nebulaIds: [] }]
      }
    ])
    setAt(questions.length)
    setEditing(aid)
    setSaved(false)
  }
  async function save(): Promise<void> {
    const problem = questions.find((x) => !x.title.trim())
      ? 'Every question needs words.'
      : questions.some((x) => !x.answers.length || x.answers.some((a) => !a.label.trim()))
        ? 'Every answer needs a name.'
        : enabled && !questions.length
          ? 'Add a question before turning onboarding on.'
          : null
    if (problem) {
      onProblem(problem)
      return
    }
    setBusy(true)
    // Answers only show optional nebulas: drop any that went back to "Everyone sees".
    const clean = questions.map((x) => ({
      ...x,
      answers: x.answers.map((a) => ({
        ...a,
        nebulaIds: a.nebulaIds.filter((id) => optionalIds.has(id))
      }))
    }))
    const r = await api.saveOnboarding(c.id, {
      enabled,
      questions: clean,
      optionalNebulaIds: [...optionalIds]
    })
    setBusy(false)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    setQuestions(r.data.constellation.onboarding?.questions ?? clean)
    setSaved(true)
    onChanged(r.data.constellation)
  }

  return (
    <div className="ob-setup">
      <section className="ob-card">
        <div className="ob-card-head">
          <h2>Onboarding</h2>
          <Switch
            on={enabled}
            label="Onboarding on"
            onChange={(on) => {
              setEnabled(on)
              setSaved(false)
            }}
          />
        </div>
        <p className="ob-lead">
          New members answer a few questions right after the welcome screen. Their answers give
          roles and choose which nebulas they see, so a big constellation feels small on day one.
        </p>
        <h3 className="ob-sub">Everyone sees</h3>
        <div className="ob-chips">
          {everyoneSees.map((n) => (
            <span key={n.id} className="ob-chip ob-chip--nebula">
              {label(n)}
              <button
                type="button"
                className="ob-chip-x"
                aria-label={`Make ${label(n)} optional`}
                title="Make it optional: people see it once they pick it"
                onClick={() => {
                  setOptionalIds((s) => new Set([...s, n.id]))
                  setSaved(false)
                }}
              >
                ×
              </button>
            </span>
          ))}
          {canMakeOptional.length > 0 &&
            (adding ? (
              <select
                autoFocus
                className="ob-add-select"
                value=""
                onBlur={() => setAdding(false)}
                onChange={(e) => {
                  const id = e.target.value
                  setAdding(false)
                  setOptionalIds((s) => new Set([...s].filter((x) => x !== id)))
                  setSaved(false)
                }}
              >
                <option value="" disabled>
                  Add a nebula…
                </option>
                {canMakeOptional.map((n) => (
                  <option key={n.id} value={n.id}>
                    {label(n)}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="ob-link" onClick={() => setAdding(true)}>
                + Add
              </button>
            ))}
        </div>
        {canMakeOptional.length > 0 && (
          <p className="ob-muted ob-note-line">
            Optional: {canMakeOptional.map(label).join(', ')}. People see these once an answer or
            Browse nebulas picks them.
          </p>
        )}
        <h3 className="ob-sub">Questions</h3>
        <ol className="ob-questions">
          {questions.map((x, i) => (
            <li
              key={x.id}
              draggable
              onDragStart={() => (drag.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const from = drag.current
                drag.current = null
                if (from === null || from === i) return
                setQuestions((list) => {
                  const next = [...list]
                  const [moved] = next.splice(from, 1)
                  next.splice(i, 0, moved)
                  return next
                })
                setAt(i)
                setSaved(false)
              }}
            >
              <button
                type="button"
                className={i === at ? 'ob-question ob-question--on' : 'ob-question'}
                aria-current={i === at ? 'true' : undefined}
                onClick={() => {
                  setAt(i)
                  setEditing(null)
                }}
              >
                <span className="ob-grip" aria-hidden="true">
                  ⠿
                </span>
                <span>
                  <b>{x.title || 'New question'}</b>
                  <span>{onboardingQuestionLine(x)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {questions.length < ONBOARDING_QUESTIONS_MAX && (
          <button type="button" className="ob-link" onClick={addQuestion}>
            + Add a question
          </button>
        )}
        <div className="ob-card-foot">
          <button
            type="button"
            className="ob-link"
            disabled={!questions.length}
            onClick={() => setPreview(true)}
          >
            Preview as a new member
          </button>
          <span className="ob-saved" aria-live="polite">
            {saved ? 'Saved' : ''}
          </span>
          <button
            type="button"
            className="ix-btn ix-btn--gold ob-save"
            disabled={busy}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </section>

      {q && (
        <section className="ob-card ob-editor" aria-label="Question">
          <label className="ob-title-field">
            <span className="sr-only">Question</span>
            <input
              value={q.title}
              maxLength={ONBOARDING_TITLE_MAX}
              placeholder="Ask something, like “What do you play with us?”"
              onChange={(e) => change({ ...q, title: e.target.value })}
            />
          </label>
          <div className="ob-selects">
            <select
              value={q.multi ? 'any' : 'one'}
              aria-label="How many answers"
              onChange={(e) => change({ ...q, multi: e.target.value === 'any' })}
            >
              <option value="any">Pick any</option>
              <option value="one">Pick one</option>
            </select>
            <select
              value={q.required ? 'yes' : 'no'}
              aria-label="Required"
              onChange={(e) => change({ ...q, required: e.target.value === 'yes' })}
            >
              <option value="yes">Required</option>
              <option value="no">Optional</option>
            </select>
            <button
              type="button"
              className="ob-link ob-link--danger ob-remove-q"
              onClick={() => {
                setQuestions((list) => list.filter((_, i) => i !== at))
                setAt(Math.max(0, at - 1))
                setSaved(false)
              }}
            >
              Remove question
            </button>
          </div>
          {q.answers.map((a) =>
            editing === a.id ? (
              <AnswerEditor
                key={a.id}
                c={c}
                answer={a}
                optionalIds={optionalIds}
                onChange={(next) =>
                  change({ ...q, answers: q.answers.map((x) => (x.id === a.id ? next : x)) })
                }
                onRemove={() => {
                  change({ ...q, answers: q.answers.filter((x) => x.id !== a.id) })
                  setEditing(null)
                }}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div key={a.id} className="ob-answer">
                <span className="ob-answer-emoji" aria-hidden="true">
                  {a.emoji}
                </span>
                <div className="ob-answer-text">
                  <b>{a.label || 'New answer'}</b>
                  {a.description && <span>{a.description}</span>}
                  <span className="ob-chips ob-chips--small">
                    {a.roleIds.map((id) => {
                      const r = c.roles.find((x) => x.id === id)
                      return r ? (
                        <span key={id} className="ob-chip ob-chip--role">
                          gives {r.name}
                        </span>
                      ) : null
                    })}
                    {[
                      ...opensFor(c, a.roleIds),
                      ...c.nebulas.filter(
                        (n) => a.nebulaIds.includes(n.id) && optionalIds.has(n.id)
                      )
                    ].map((n) => (
                      <span key={n.id} className="ob-chip ob-chip--nebula">
                        shows {label(n)}
                      </span>
                    ))}
                  </span>
                </div>
                <button
                  type="button"
                  className="ob-edit"
                  aria-label={`Edit ${a.label}`}
                  onClick={() => setEditing(a.id)}
                >
                  ✎
                </button>
              </div>
            )
          )}
          {q.answers.length < ONBOARDING_ANSWERS_MAX && (
            <button
              type="button"
              className="ob-link"
              onClick={() => {
                const id = newId()
                change({
                  ...q,
                  answers: [
                    ...q.answers,
                    { id, emoji: '', label: '', description: '', roleIds: [], nebulaIds: [] }
                  ]
                })
                setEditing(id)
              }}
            >
              + Add an answer
            </button>
          )}
          <p className="ob-note">
            Answers can only give roles that members may pick themselves (labels, never
            permissions), and only show nebulas that are optional; nebulas limited to a role come
            with it. The FiveM answer pairs with the Glofly Whitelist: the role it gives can be the
            one your server checks.
          </p>
        </section>
      )}
      {preview && (
        <OnboardingFlow
          c={{ ...c, onboarding: { enabled: true, questions } }}
          preview
          onDone={() => setPreview(false)}
          onProblem={onProblem}
        />
      )}
    </div>
  )
}

// ───────────── The member's questions (board 26) ─────────────

function QuestionStep({
  c,
  q,
  index,
  total,
  picked,
  onPick,
  bars
}: {
  c: ConstellationDetail
  q: OnboardingQuestion
  index: number
  total: number
  picked: string[]
  onPick: (ids: string[]) => void
  bars: number
}): React.JSX.Element {
  return (
    <>
      {bars > 1 && (
        <div className="ob-bars" aria-hidden="true">
          {Array.from({ length: bars }, (_, i) => (
            <span key={i} className={i <= index ? 'ob-bar ob-bar--on' : 'ob-bar'} />
          ))}
        </div>
      )}
      <p className="ob-kicker">
        {c.name} · Question {index + 1} of {total}
      </p>
      <h2 className="ob-q-title" id="ob-q-title">
        {q.title}
      </h2>
      <p className="ob-q-sub">
        {q.multi ? 'Pick any.' : 'Pick one.'} {q.required ? '' : 'You can skip this. '}You can
        change this later from the constellation’s menu.
      </p>
      <div className="ob-grid" role={q.multi ? 'group' : 'radiogroup'} aria-labelledby="ob-q-title">
        {q.answers.map((a) => {
          const on = picked.includes(a.id)
          return (
            <button
              key={a.id}
              type="button"
              role={q.multi ? 'checkbox' : 'radio'}
              aria-checked={on}
              className={on ? 'ob-pickcard ob-pickcard--on' : 'ob-pickcard'}
              onClick={() =>
                onPick(
                  q.multi
                    ? on
                      ? picked.filter((x) => x !== a.id)
                      : [...picked, a.id]
                    : on && !q.required
                      ? []
                      : [a.id]
                )
              }
            >
              <span className="ob-pickcard-emoji" aria-hidden="true">
                {a.emoji}
              </span>
              <span className="ob-pickcard-text">
                <b>{a.label}</b>
                {a.description && <span>{a.description}</span>}
              </span>
              {on && (
                <span className="ob-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

export function OnboardingFlow({
  c,
  preview,
  onSaved,
  onDone,
  onProblem
}: {
  c: ConstellationDetail
  /** Settings' "Preview as a new member": nothing is saved */
  preview?: boolean
  /** The answers were saved (the summary shows next) */
  onSaved?: () => void
  /** Finished (the constellation as it is now, when it changed) */
  onDone: (next: ConstellationDetail | null) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const questions = c.onboarding?.questions ?? []
  const [at, setAt] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string[]>>(() =>
    preview ? {} : { ...(c.me.onboarding?.answers ?? {}) }
  )
  const [done, setDone] = useState<ConstellationDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const a = accentOf(c)
  const q = questions[at]
  const picked = q ? (answers[q.id] ?? []) : []
  const blocked = !!q?.required && !picked.length

  useEffect(() => {
    box.current?.focus()
  }, [at, done])

  // What the answers give (for the summary; the server's copy wins when saved).
  const chosen = useMemo(
    () => questions.flatMap((x) => x.answers.filter((y) => (answers[x.id] ?? []).includes(y.id))),
    [questions, answers]
  )
  async function finish(): Promise<void> {
    if (preview) {
      setDone(c)
      return
    }
    setBusy(true)
    const r = await api.answerOnboarding(c.id, answers, true)
    setBusy(false)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    onSaved?.()
    setDone(r.data.constellation)
  }
  function next(): void {
    if (blocked || busy) return
    if (at === questions.length - 1) void finish()
    else setAt(at + 1)
  }

  const shownC = done ?? c
  const roleNames = [...new Set(chosen.flatMap((x) => x.roleIds))]
    .map((id) => c.roles.find((r) => r.id === id)?.name)
    .filter((x): x is string => !!x)
  const fromAnswers = roleNames.length ? roleNames : chosen.map((x) => x.label)
  const previewNebulas = preview
    ? [
        ...forEveryone(c).filter((n) => !n.optional),
        ...opensFor(
          c,
          chosen.flatMap((x) => x.roleIds)
        ),
        ...c.nebulas.filter((n) => chosen.some((x) => x.nebulaIds.includes(n.id)))
      ]
    : shownC.nebulas
  const nebulaList = [
    ...new Map(previewNebulas.filter((n) => n.kind !== 'voice').map((n) => [n.id, n])).values()
  ]
  const more = preview
    ? Math.max(0, c.nebulas.filter((n) => n.kind !== 'voice').length - nebulaList.length)
    : (shownC.browse?.length ?? 0) + Object.values(shownC.unlocks ?? {}).flat().length

  return (
    <div className="cx-welcome-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={done ? `Your ${c.name}` : `${c.name} questions`}
        className="ob-flow"
        style={{
          ['--cxa' as string]: a.color,
          ['--cxa-rgb' as string]: a.rgb,
          ['--cxa-on' as string]: a.on
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && preview) onDone(null)
          if (e.key === 'Enter' && !done && (e.target as HTMLElement).tagName !== 'BUTTON') next()
        }}
      >
        {done ? (
          <>
            <p className="ob-kicker">All set</p>
            <h2 className="ob-q-title">Your {c.name}</h2>
            {fromAnswers.length > 0 && (
              <>
                <p className="ob-q-sub">From your answers:</p>
                <div className="ob-chips">
                  {fromAnswers.map((n) => (
                    <span key={n} className="ob-chip ob-chip--role">
                      {n}
                    </span>
                  ))}
                </div>
              </>
            )}
            <ul className="ob-summary">
              {nebulaList.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <span aria-hidden="true">✦</span> {n.name}
                </li>
              ))}
            </ul>
            <p className="ob-muted">
              {nebulaList.length} {nebulaList.length === 1 ? 'nebula' : 'nebulas'}
              {more > 0 ? ` · ${more} more you can open any time` : ''}
            </p>
            <button type="button" className="ob-open" onClick={() => onDone(preview ? null : done)}>
              {preview ? 'Close preview' : `Open ${c.name}`}
            </button>
          </>
        ) : q ? (
          <>
            <QuestionStep
              c={c}
              q={q}
              index={at}
              total={questions.length}
              bars={questions.length + 1}
              picked={picked}
              onPick={(ids) => setAnswers((x) => ({ ...x, [q.id]: ids }))}
            />
            <div className="ob-flow-foot">
              {at > 0 ? (
                <button type="button" className="ob-back" onClick={() => setAt(at - 1)}>
                  ← Back
                </button>
              ) : preview ? (
                <button type="button" className="ob-back" onClick={() => onDone(null)}>
                  Close preview
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="ob-next" disabled={blocked || busy} onClick={next}>
                {at === questions.length - 1 ? 'Finish' : 'Next'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

// ───────────── Your answers & nebulas (board 27) ─────────────

export function YourAnswersDialog({
  c,
  meId,
  onClose,
  onChanged,
  onProblem
}: {
  c: ConstellationDetail
  meId: string
  onClose: () => void
  onChanged: (next: ConstellationDetail) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'answers' | 'browse'>('answers')
  const [changing, setChanging] = useState<OnboardingQuestion | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const questions = c.onboarding?.questions ?? []
  const mine = c.me.onboarding?.answers ?? {}
  const myRoles = c.members.find((m) => m.user.id === meId)?.roleIds ?? []

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (changing) setChanging(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose, changing])

  async function run(task: () => ReturnType<typeof api.showNebula>): Promise<void> {
    setBusy(true)
    const r = await task()
    setBusy(false)
    if (!r.ok) onProblem(r.message)
    else onChanged(r.data.constellation)
  }

  // Browse: optional nebulas (shown or not), and role-only ones a role I can pick opens.
  const shownOptional = c.nebulas.filter((n) => n.optional)
  // unlocks: per role I can pick, the role-only nebulas it opens (whether I have it yet or not).
  const unlockRows = Object.entries(c.unlocks ?? {}).flatMap(([roleId, names]) =>
    names.map((name) => ({ roleId, name: name.replace(/^#/, ''), on: myRoles.includes(roleId) }))
  )
  const answerFor = (roleId: string): string | null => {
    for (const qq of questions)
      for (const an of qq.answers) if (an.roleIds.includes(roleId)) return an.label
    return null
  }

  return (
    <div className="ix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-yours-title"
        className="ix-sheet ob-yours"
      >
        <header className="nf-head">
          <h2 id="ob-yours-title" className="ob-yours-title">
            Your answers &amp; nebulas
          </h2>
          <button type="button" className="nf-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {!changing && (
          <>
            <div className="ob-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'answers'}
                className={tab === 'answers' ? 'ob-tab ob-tab--on' : 'ob-tab'}
                onClick={() => setTab('answers')}
              >
                Your answers
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'browse'}
                className={tab === 'browse' ? 'ob-tab ob-tab--on' : 'ob-tab'}
                onClick={() => setTab('browse')}
              >
                Browse nebulas
              </button>
            </div>
            {tab === 'answers' ? (
              questions.length ? (
                questions.map((qq) => {
                  const ids = mine[qq.id] ?? []
                  const words = qq.answers.filter((x) => ids.includes(x.id)).map((x) => x.label)
                  return (
                    <div key={qq.id} className="ob-yours-row">
                      <span>
                        <b>{qq.title}</b>
                        <span>{words.length ? words.join(', ') : 'Not now'}</span>
                      </span>
                      <button
                        type="button"
                        className="ob-link"
                        onClick={() => {
                          setChanging(qq)
                          setPicked(ids)
                        }}
                      >
                        Change
                      </button>
                    </div>
                  )
                })
              ) : (
                <p className="ob-muted">This constellation has no questions right now.</p>
              )
            ) : (
              <>
                <h3 className="ob-sub">Browse nebulas</h3>
                <ul className="ob-browse">
                  {unlockRows.map((u) => (
                    <li key={`${u.roleId}-${u.name}`}>
                      <span className="nf-mark" aria-hidden="true">
                        ✦
                      </span>
                      <span className="ob-browse-text">
                        <b>{u.name}</b>
                        <span>
                          {answerFor(u.roleId)
                            ? `Comes with the ${answerFor(u.roleId)} answer`
                            : `Comes with the ${c.roles.find((r) => r.id === u.roleId)?.name ?? ''} role`}
                        </span>
                      </span>
                      <Switch
                        on={u.on}
                        label={u.name}
                        disabled={busy}
                        onChange={(on) =>
                          void run(() =>
                            api.myRoles(
                              c.id,
                              on
                                ? [
                                    ...myRoles.filter(
                                      (id) => c.roles.find((r) => r.id === id)?.selfAssign
                                    ),
                                    u.roleId
                                  ]
                                : myRoles.filter(
                                    (id) =>
                                      id !== u.roleId &&
                                      c.roles.find((r) => r.id === id)?.selfAssign
                                  )
                            )
                          )
                        }
                      />
                    </li>
                  ))}
                  {[
                    ...shownOptional.map((n) => ({ n, on: true })),
                    ...(c.browse ?? []).map((n) => ({ n, on: false }))
                  ].map(({ n, on }) => (
                    <li key={n.id}>
                      <span className="nf-mark" aria-hidden="true">
                        ✦
                      </span>
                      <span className="ob-browse-text">
                        <b>{n.name}</b>
                        <span>Optional for everyone</span>
                      </span>
                      <Switch
                        on={on}
                        label={n.name}
                        disabled={busy}
                        onChange={(v) => void run(() => api.showNebula(c.id, n.id, v))}
                      />
                    </li>
                  ))}
                </ul>
                {!unlockRows.length && !shownOptional.length && !(c.browse ?? []).length && (
                  <p className="ob-muted">You see every nebula already.</p>
                )}
                <p className="ob-muted">
                  Hiding a nebula only hides it for you. Nebulas limited to roles (staff, tickets)
                  never show here.
                </p>
              </>
            )}
          </>
        )}
        {changing && (
          <div className="ob-change">
            <QuestionStep
              c={c}
              q={changing}
              index={questions.findIndex((x) => x.id === changing.id)}
              total={questions.length}
              bars={0}
              picked={picked}
              onPick={setPicked}
            />
            <div className="ob-flow-foot">
              <button type="button" className="ob-back" onClick={() => setChanging(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ob-next"
                disabled={busy || (changing.required && !picked.length)}
                onClick={async () => {
                  setBusy(true)
                  const r = await api.answerOnboarding(c.id, { [changing.id]: picked }, false)
                  setBusy(false)
                  if (!r.ok) return onProblem(r.message)
                  setChanging(null)
                  onChanged(r.data.constellation)
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
