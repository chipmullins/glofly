import { useEffect, useRef, useState } from 'react'
import {
  BLOCKED_WORD_MAX,
  NEW_MEMBER_WAIT_CHOICES,
  SLOW_MODE_CHOICES,
  cleanBlockedWord,
  type AutoModSettings,
  type ConstellationDetail
} from '@glofly/shared'
import { community, type AutoModLogItem, type AutoModPageData } from '../lib/community'
import './Community.css'

// Constellation settings → AutoMod (0.8.0, approved Oct 20 board 14). The checks run on the
// server, so no app can skip them; everything AutoMod does lands in the log with an Undo.

function Switch({
  on,
  label,
  disabled,
  onChange
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'am-switch am-switch--on' : 'am-switch'}
      onClick={() => onChange(!on)}
    >
      <span className="am-knob" />
    </button>
  )
}

const ago = (iso: string): string => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'Yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function LogEntry({
  item,
  meId,
  busy,
  onUndo
}: {
  item: AutoModLogItem
  meId: string
  busy: boolean
  onUndo: () => void
}): React.JSX.Element {
  const d = item.details
  const who = item.target ? `@${item.target.username}` : 'someone'
  const name = item.target ? item.target.displayName.split(/\s+/)[0] : 'Someone'
  const head =
    item.action === 'automod_hidden'
      ? 'AutoMod hid a message'
      : item.action === 'automod_links'
        ? 'Link spam held for review'
        : 'New member waiting'
  const line =
    item.action === 'automod_hidden'
      ? `From ${who}${d.nebulaName ? ` in #${d.nebulaName}` : ''} · blocked word "${d.word ?? ''}"`
      : item.action === 'automod_links'
        ? `${d.rule === 'repeat' ? 'Same link in 3 nebulas' : 'Lots of links at once'} from ${who}${d.nebulaName ? ` in #${d.nebulaName}` : ''}`
        : `${name} can post ${d.until && Date.parse(d.until) > Date.now() ? `in ${Math.max(1, Math.ceil((Date.parse(d.until) - Date.now()) / 60_000))} minutes` : 'now'} (new members wait)`
  const undoneBy = item.undone
    ? item.undone.by?.id === meId
      ? 'you'
      : (item.undone.by?.displayName.split(/\s+/)[0] ?? 'a moderator')
    : null
  return (
    <div className="am-log-item">
      <div className="am-log-head">
        <span className={`am-log-icon am-log-icon--${item.action}`} aria-hidden="true">
          {item.action === 'automod_hidden' ? '⛨' : item.action === 'automod_links' ? '🔗' : '⏳'}
        </span>
        <b>{head}</b>
        <span className="am-log-when">{ago(item.createdAt)}</span>
      </div>
      <div className="am-log-line">{line}</div>
      {d.preview && item.action !== 'automod_wait' && <div className="am-log-quote">{d.preview}</div>}
      {undoneBy ? (
        <div className="am-log-done">
          {item.action === 'automod_wait' ? `Let in early by ${undoneBy}` : `Restored by ${undoneBy}`}
        </div>
      ) : (
        item.canUndo && (
          <button type="button" className="am-undo" disabled={busy} onClick={onUndo}>
            {item.action === 'automod_wait' ? 'Let them post now' : 'Undo'}
          </button>
        )
      )}
    </div>
  )
}

export default function AutoModPage({
  c,
  meId,
  onProblem
}: {
  c: ConstellationDetail
  meId: string
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [data, setData] = useState<AutoModPageData | null>(null)
  const [adding, setAdding] = useState(false)
  const [word, setWord] = useState('')
  const [wordProblem, setWordProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const addRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void community.automod(c.id).then((r) => {
      if (r.ok) setData(r.data)
      else onProblem(r.message)
    })
  }, [c.id, onProblem])
  useEffect(() => {
    if (adding) addRef.current?.focus()
  }, [adding])
  if (!data) return <div className="cx-settings-body"><p className="cx-settings-text">Loading…</p></div>
  const s = data.settings
  const edit = data.canEdit && !busy
  async function change(changes: Partial<AutoModSettings>): Promise<boolean> {
    setBusy(true)
    // Shown at once; the server's answer replaces it.
    setData((d) => (d ? { ...d, settings: { ...d.settings, ...changes } } : d))
    const r = await community.setAutomod(c.id, changes)
    setBusy(false)
    if (r.ok) {
      setData(r.data)
      return true
    }
    onProblem(r.message)
    void community.automod(c.id).then((x) => x.ok && setData(x.data))
    return false
  }
  async function addWord(): Promise<void> {
    const w = cleanBlockedWord(word)
    if (!w) {
      setWordProblem('At least 2 letters, up to 40 characters. Use * for any letters.')
      return
    }
    if (s.words.includes(w)) {
      setWord('')
      return
    }
    if (await change({ words: [...s.words, w], wordsOn: true })) {
      setWord('')
      setWordProblem(null)
    }
  }
  async function undo(item: AutoModLogItem): Promise<void> {
    setBusy(true)
    const r =
      item.action === 'automod_wait'
        ? item.target
          ? await community.waiveWait(c.id, item.target.id)
          : null
        : item.details.heldId
          ? await community.releaseHeld(c.id, item.details.heldId)
          : null
    setBusy(false)
    if (r?.ok) setData(r.data)
    else if (r) onProblem(r.message)
  }
  const textNebulas = data.nebulas
  return (
    <div className="cx-settings-body am">
      <div className="am-cols">
        <div className="am-left">
          {!data.canEdit && (
            <p className="cx-settings-text">Only people who can edit constellation settings can change AutoMod. You can see what it did and undo it.</p>
          )}
          <section className="am-card">
            <div className="am-card-head">
              <div>
                <h3>Blocked words</h3>
                <p>Messages with these are hidden before anyone sees them.</p>
              </div>
              <Switch on={s.wordsOn} label="Blocked words" disabled={!edit} onChange={(on) => void change({ wordsOn: on })} />
            </div>
            <div className="am-words">
              {s.words.map((w) => (
                <span key={w} className="am-word">
                  {w}
                  {data.canEdit && (
                    <button type="button" aria-label={`Remove ${w}`} disabled={!edit} onClick={() => void change({ words: s.words.filter((x) => x !== w) })}>
                      ×
                    </button>
                  )}
                </span>
              ))}
              {data.canEdit &&
                (adding ? (
                  <form
                    className="am-add-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void addWord()
                    }}
                  >
                    <input
                      ref={addRef}
                      value={word}
                      maxLength={BLOCKED_WORD_MAX}
                      aria-label="A word or phrase to block"
                      placeholder="word or phrase"
                      onChange={(e) => {
                        setWord(e.target.value)
                        setWordProblem(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setAdding(false)
                          setWord('')
                        }
                      }}
                      onBlur={() => !word.trim() && setAdding(false)}
                    />
                    <button type="submit" disabled={!edit || !word.trim()}>
                      Add
                    </button>
                  </form>
                ) : (
                  <button type="button" className="am-add" disabled={!edit} onClick={() => setAdding(true)}>
                    + Add a word
                  </button>
                ))}
            </div>
            {wordProblem && <p className="cx-error">{wordProblem}</p>}
            <p className="am-note">
              When found: <b>Hide the message and tell moderators</b> · catches l33t spellings too
            </p>
          </section>

          <section className="am-card">
            <div className="am-card-head">
              <div>
                <h3>Link-spam guard</h3>
                <p>More than 3 links in 10 seconds, or the same link in 3 nebulas, is held for a moderator.</p>
              </div>
              <Switch on={s.linkGuardOn} label="Link-spam guard" disabled={!edit} onChange={(on) => void change({ linkGuardOn: on })} />
            </div>
          </section>

          <section className="am-card">
            <div className="am-card-head">
              <div>
                <h3>Slow mode</h3>
                <p>How long people wait between messages, per nebula.</p>
              </div>
              <Switch on={s.slowModeOn} label="Slow mode" disabled={!edit} onChange={(on) => void change({ slowModeOn: on })} />
            </div>
            {s.slowModeOn && (
              <div className="am-slow">
                {textNebulas.map((n) => {
                  const now = s.slowMode[n.id] ?? 0
                  return (
                    <div key={n.id} className="am-slow-row">
                      <span className="am-slow-name">
                        <span aria-hidden="true" className="am-spark">✦</span>
                        {n.name}
                      </span>
                      <span className="am-seg" role="radiogroup" aria-label={`Slow mode in ${n.name}`}>
                        {SLOW_MODE_CHOICES.map((choice) => (
                          <button
                            key={choice.seconds}
                            type="button"
                            role="radio"
                            aria-checked={now === choice.seconds}
                            className={now === choice.seconds ? 'am-seg-on' : undefined}
                            disabled={!edit}
                            onClick={() => {
                              const next = { ...s.slowMode }
                              if (choice.seconds) next[n.id] = choice.seconds
                              else delete next[n.id]
                              void change({ slowMode: next })
                            }}
                          >
                            {choice.name}
                          </button>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="am-card">
            <div className="am-card-head">
              <div>
                <h3>New members wait</h3>
                <p>
                  People who just joined can read right away and post after{' '}
                  {data.canEdit ? (
                    <select
                      className="am-wait"
                      aria-label="How long new members wait"
                      value={s.newMemberWaitMinutes || 10}
                      disabled={!edit}
                      onChange={(e) => void change({ newMemberWaitMinutes: Number(e.target.value) })}
                    >
                      {NEW_MEMBER_WAIT_CHOICES.map((m) => (
                        <option key={m} value={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  ) : (
                    <b>{s.newMemberWaitMinutes || 10} minutes</b>
                  )}
                  .
                </p>
              </div>
              <Switch
                on={s.newMemberWaitMinutes > 0}
                label="New members wait"
                disabled={!edit}
                onChange={(on) => void change({ newMemberWaitMinutes: on ? 10 : 0 })}
              />
            </div>
          </section>
          <p className="am-foot">Moderators and higher are never slowed down or filtered.</p>
        </div>

        <div className="am-right">
          <div className="am-log-title">
            <h3>Moderation log</h3>
            <span>Everything AutoMod does lands here</span>
          </div>
          {data.log.length === 0 && <p className="cx-settings-text">Nothing yet. When AutoMod holds a message, it shows up here.</p>}
          {data.log.map((item) => (
            <LogEntry key={item.id} item={item} meId={meId} busy={busy} onUndo={() => void undo(item)} />
          ))}
        </div>
      </div>
    </div>
  )
}
