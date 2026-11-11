import { useCallback, useEffect, useState } from 'react'
import { isFullCharacter, type Character } from '@glofly/shared/campfire/types'
import { RULES_LABEL } from '@glofly/shared/campfire/rulesData'
import {
  statChips,
  type CampaignHub,
  type CampfireSession,
  type JournalEntry,
  type JournalKind,
  type LootItem,
  type PartyLoot,
  type Quest,
  type SessionRsvp
} from '@glofly/shared/campfire/hub'
import { levelUpPreview } from '@glofly/shared/campfire/builder'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { useCf } from './ctx'
import { campaignRules, loadHub, useBuilder } from './rulesApi'
import { HomebrewLibrary } from './Homebrew'
import { LevelUp } from './LevelUp'
import { FlameIcon } from './icons'
import './roundA.css'

// Round A: the campaign hub (approved board "Hub"): banner, name and pitch, the next session with
// RSVPs and reminders, party progress (milestone level-ups), the last recap (drafted from what the
// server counted, edited and posted by the GM), quests, party loot with an even split, the NPC and
// place journal, and the homebrew library. Players see what's posted and not hidden.

type HubTab = 'overview' | 'sessions' | 'quests' | 'loot' | 'journal' | 'homebrew'
const TABS: { id: HubTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'quests', label: 'Quests' },
  { id: 'loot', label: 'Party loot' },
  { id: 'journal', label: 'Journal' },
  { id: 'homebrew', label: 'Homebrew' }
]

const dayTime = (iso: string): { day: string; time: string } => {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  }
}
const inDays = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'now'
  const h = Math.round(ms / 3_600_000)
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`
  if (h < 36) return `in ${h} h`
  return `in ${Math.round(h / 24)} days`
}
/** A datetime-local input's value for a date (and back). */
const localValue = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function Hub({
  onClose,
  onSettings
}: {
  onClose: () => void
  onSettings: () => void
}): React.JSX.Element {
  const { t, isGm, say, me, nameOf } = useCf()
  const [hub, setHub] = useState<CampaignHub | null>(null)
  const [tab, setTab] = useState<HubTab>('overview')
  const [leveling, setLeveling] = useState<Character | null>(null)
  const reload = useCallback(async () => {
    const h = await loadHub(t.campaign.id)
    if (h) setHub(h)
  }, [t.campaign.id])
  useEffect(() => {
    void loadHub(t.campaign.id).then((h) => h && setHub(h))
    const off = window.glofly.onEvent((e) => {
      if (
        e.type === 'campfire' &&
        e.data.campaignId === t.campaign.id &&
        (e.name === 'campfire:hub' || e.name === 'campfire:character')
      )
        void reload()
    })
    return off
  }, [reload, t.campaign.id])
  const rules = campaignRules(t.campaign.settings)
  const data = useBuilder(rules)
  // "Now" for the session list: when the hub opened (it's reopened often enough).
  const [now] = useState(Date.now)

  if (!hub)
    return (
      <div className="cfa-hub" role="dialog" aria-label="Campaign hub">
        <p className="cfa-pad cf-hint">Opening the campaign…</p>
      </div>
    )

  const next = hub.sessions
    .filter((s) => !s.before && s.startsAt && new Date(s.startsAt).getTime() > now - 4 * 3600_000)
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime())[0]
  const played = hub.sessions.filter(
    (s) => !s.before && (s.recapPostedAt || (s.startsAt && new Date(s.startsAt).getTime() < now))
  )
  const last = played.sort((a, b) => b.number - a.number)[0] ?? hub.sessions.find((s) => s.before)
  const mine = t.characters.find(
    (c) => c.ownerId === me.id && c.kind === 'pc' && isFullCharacter(c)
  ) as Character | undefined
  const myLevel = mine ? mine.sheet.classes.reduce((n, c) => n + c.level, 0) : 0
  const canLevel =
    !!mine && !!data && !!levelUpPreview(data, mine.sheet) && myLevel < hub.progress.level
  const sessionsPlayed =
    hub.progress.sessionsBefore +
    hub.sessions.filter((s) => !s.before && s.startsAt && new Date(s.startsAt).getTime() < now)
      .length
  const banner = hub.bannerFileId
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(20,15,13,0) 30%, var(--cf-bg) 100%), url("${fileUrl(hub.bannerFileId)}")`
      }
    : undefined

  return (
    <div className="cfa-hub" role="dialog" aria-label={`${t.campaign.name}: campaign hub`}>
      <header className="cfa-hub-banner" style={banner}>
        <div className="cfa-hub-banner-in">
          <div>
            <span className="cfa-hub-meta">
              <span className="cfa-pill">{RULES_LABEL[rules]}</span>
              Game master:{' '}
              {t.members
                .filter((m) => m.role === 'gm')
                .map((m) => m.user?.displayName ?? 'Someone')
                .join(', ')}
            </span>
            <h1>{t.campaign.name}</h1>
            {hub.pitch && <p>{hub.pitch}</p>}
          </div>
          {isGm && (
            <button type="button" className="cf-ghost" onClick={onSettings}>
              Campaign settings
            </button>
          )}
          <button type="button" className="cf-primary cfa-big" onClick={onClose}>
            <FlameIcon size={18} /> Back to the table
          </button>
        </div>
      </header>
      <nav className="cfa-hub-nav" role="tablist" aria-label="Campaign">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </nav>
      <div className="cfa-hub-body" role="tabpanel">
        {tab === 'overview' && (
          <div className="cfa-hub-grid">
            <div className="cfa-col">
              <NextSession
                hub={hub}
                next={next}
                isGm={isGm}
                me={me.id}
                nameOf={nameOf}
                onChanged={reload}
                say={say}
                campaignId={t.campaign.id}
              />
              <section className="cfa-panel" aria-labelledby="hub-progress">
                <div className="cfa-panel-head">
                  <h2 id="hub-progress">Party progress</h2>
                </div>
                <div className="cfa-tiles">
                  <div>
                    <b>Level {hub.progress.level}</b>
                    <span>
                      {t.campaign.settings.leveling === 'xp' ? 'Experience points' : 'Milestones'}
                    </span>
                  </div>
                  <div>
                    <b>{sessionsPlayed}</b>
                    <span>Sessions played</span>
                  </div>
                  <div>
                    <b>
                      {hub.quests.filter((q) => q.status === 'done').length} / {hub.quests.length}
                    </b>
                    <span>Quests done</span>
                  </div>
                </div>
                <div className="cfa-inline-row">
                  {isGm && t.campaign.settings.leveling !== 'xp' && hub.progress.level < 20 && (
                    <button
                      type="button"
                      className="cf-soft"
                      onClick={async () => {
                        const r = await cf.patch(`/campfire/campaigns/${t.campaign.id}/hub`, {
                          progress: { ...hub.progress, level: hub.progress.level + 1 }
                        })
                        if (!r.ok) return say(r.message)
                        say(
                          `The party reached level ${hub.progress.level + 1}. Everyone can level up from the hub.`
                        )
                        void reload()
                      }}
                    >
                      Level up the party
                    </button>
                  )}
                  {canLevel && mine && (
                    <button type="button" className="cf-primary" onClick={() => setLeveling(mine)}>
                      Level up {mine.name}
                    </button>
                  )}
                </div>
                <ul className="cfa-people" aria-label="The party">
                  {hub.party.map((p) => (
                    <li key={p.characterId}>
                      <span className="cfa-dot">
                        {p.portraitFileId ? (
                          <img src={fileUrl(p.portraitFileId)} alt="" />
                        ) : (
                          p.name[0]
                        )}
                      </span>
                      {p.name} · {p.level}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <RecapPanel
              last={last}
              earlier={played.filter((s) => s.id !== last?.id).slice(0, 4)}
              isGm={isGm}
              onChanged={reload}
              say={say}
              onAll={() => setTab('sessions')}
            />
            <div className="cfa-col">
              <section className="cfa-panel" aria-labelledby="hub-quests">
                <div className="cfa-panel-head">
                  <h2 id="hub-quests">Quests</h2>
                  <button type="button" className="cf-link" onClick={() => setTab('quests')}>
                    All {hub.quests.length}
                  </button>
                </div>
                {hub.quests
                  .filter((q) => q.status === 'open')
                  .slice(0, 3)
                  .map((q, i) => (
                    <div key={q.id} className={`cfa-quest${i === 0 ? ' cfa-quest--open' : ''}`}>
                      <b>
                        {q.title} {q.hidden && <span className="cfa-hidden-tag">Hidden</span>}
                      </b>
                      {(q.detail || q.giver) && (
                        <span>
                          {[q.detail, q.giver && `from ${q.giver}`].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  ))}
                {!hub.quests.some((q) => q.status === 'open') && (
                  <p className="cf-sub">No open quests.</p>
                )}
              </section>
              <LootSummary
                loot={hub.loot}
                isGm={isGm}
                partySize={hub.party.length}
                campaignId={t.campaign.id}
                onChanged={reload}
                say={say}
                onAll={() => setTab('loot')}
              />
              <section className="cfa-panel" aria-labelledby="hub-journal">
                <div className="cfa-panel-head">
                  <h2 id="hub-journal">Journal</h2>
                  <button type="button" className="cf-link" onClick={() => setTab('journal')}>
                    Open
                  </button>
                </div>
                <div className="cfa-chips">
                  {hub.journal.slice(0, 8).map((j) => (
                    <span key={j.id} className="cf-chip">
                      {j.name} · {j.kind === 'npc' ? 'NPC' : j.kind}
                    </span>
                  ))}
                  {!hub.journal.length && <span className="cf-sub">Nothing written yet.</span>}
                </div>
              </section>
            </div>
          </div>
        )}
        {tab === 'sessions' && (
          <SessionsTab
            hub={hub}
            isGm={isGm}
            campaignId={t.campaign.id}
            onChanged={reload}
            say={say}
          />
        )}
        {tab === 'quests' && (
          <QuestsTab
            quests={hub.quests}
            isGm={isGm}
            campaignId={t.campaign.id}
            onChanged={reload}
            say={say}
          />
        )}
        {tab === 'loot' && (
          <LootTab hub={hub} isGm={isGm} campaignId={t.campaign.id} onChanged={reload} say={say} />
        )}
        {tab === 'journal' && (
          <JournalTab
            entries={hub.journal}
            isGm={isGm}
            campaignId={t.campaign.id}
            onChanged={reload}
            say={say}
          />
        )}
        {tab === 'homebrew' && <HomebrewLibrary />}
      </div>
      {leveling && <LevelUp ch={leveling} onClose={() => setLeveling(null)} />}
    </div>
  )
}

type Common = { isGm: boolean; onChanged: () => void; say: (m: string) => void }

function NextSession({
  hub,
  next,
  me,
  nameOf,
  campaignId,
  isGm,
  onChanged,
  say
}: Common & {
  hub: CampaignHub
  next: CampfireSession | undefined
  me: string
  nameOf: (id: string | null) => string
  campaignId: string
}): React.JSX.Element {
  const [planning, setPlanning] = useState(false)
  const [when, setWhen] = useState('')
  const answer = next?.rsvps.find((r) => r.userId === me)?.answer
  const rsvp = async (a: SessionRsvp): Promise<void> => {
    if (!next) return
    const r = await cf.put(`/campfire/sessions/${next.id}/rsvp`, { answer: a })
    if (!r.ok) return say(r.message)
    onChanged()
  }
  const plan = async (): Promise<void> => {
    if (!when) return
    const r = await cf.post(`/campfire/campaigns/${campaignId}/sessions`, {
      startsAt: new Date(when).toISOString()
    })
    if (!r.ok) return say(r.message)
    setPlanning(false)
    onChanged()
  }
  return (
    <section className="cfa-panel cfa-panel--hot" aria-labelledby="hub-next">
      <div className="cfa-panel-head">
        <h2 id="hub-next">Next session</h2>
        {next?.startsAt && <span className="cf-sub">{inDays(next.startsAt)}</span>}
      </div>
      {next?.startsAt ? (
        <>
          <div className="cfa-when">
            <b>{dayTime(next.startsAt).day}</b>
            <span>
              {dayTime(next.startsAt).time} · {next.title || `Session ${next.number}`}
            </span>
          </div>
          <div className="cfa-inline-row cfa-rsvp" role="group" aria-label="Are you going?">
            <span className="cf-sub">You’re going?</span>
            {(['yes', 'maybe', 'no'] as const).map((a) => (
              <button
                key={a}
                type="button"
                data-answer={a}
                aria-pressed={answer === a}
                onClick={() => void rsvp(a)}
              >
                {a === 'yes' ? 'Yes' : a === 'maybe' ? 'Maybe' : "Can't"}
              </button>
            ))}
          </div>
          <ul className="cfa-people" aria-label="Who's coming">
            {hub.party.map((p) => {
              const a = next.rsvps.find((r) => r.userId === p.ownerId)?.answer
              return (
                <li key={p.characterId}>
                  <span className={`cfa-dot${a ? ` cfa-dot--${a}` : ''}`}>
                    {p.portraitFileId ? <img src={fileUrl(p.portraitFileId)} alt="" /> : p.name[0]}
                  </span>
                  {p.name} ·{' '}
                  {a === 'yes' ? 'yes' : a === 'maybe' ? 'maybe' : a === 'no' ? "can't" : 'not yet'}
                </li>
              )
            })}
            {next.rsvps
              .filter((r) => !hub.party.some((p) => p.ownerId === r.userId))
              .map((r) => (
                <li key={r.userId}>
                  <span className={`cfa-dot cfa-dot--${r.answer}`}>{nameOf(r.userId)[0]}</span>
                  {nameOf(r.userId)} · {r.answer === 'no' ? "can't" : r.answer}
                </li>
              ))}
          </ul>
          <span className="cf-sub">
            Glofly reminds everyone the day before and 30 minutes ahead.
          </span>
        </>
      ) : (
        <p className="cf-sub">
          {isGm
            ? 'Pick a day and time; everyone can say if they can make it.'
            : 'The game master hasn’t planned the next session yet.'}
        </p>
      )}
      {isGm &&
        (planning ? (
          <div className="cfa-inline-row">
            <input
              type="datetime-local"
              aria-label="When"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <button
              type="button"
              className="cf-primary"
              disabled={!when}
              onClick={() => void plan()}
            >
              Plan it
            </button>
            <button type="button" className="cf-ghost" onClick={() => setPlanning(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="cf-soft" onClick={() => setPlanning(true)}>
            {next ? 'Plan another session' : 'Plan the next session'}
          </button>
        ))}
    </section>
  )
}

function RecapPanel({
  last,
  earlier,
  isGm,
  onChanged,
  say,
  onAll
}: Common & {
  last: CampfireSession | undefined
  earlier: CampfireSession[]
  onAll: () => void
}): React.JSX.Element {
  return (
    <section className="cfa-panel" aria-labelledby="hub-recap">
      <div className="cfa-panel-head">
        <h2 id="hub-recap">
          {last
            ? last.before
              ? 'The story so far'
              : `Last time · Session ${last.number}`
            : 'Recaps'}
        </h2>
        {last?.startsAt && <span className="cf-sub">{dayTime(last.startsAt).day}</span>}
      </div>
      {last ? (
        <RecapBody s={last} isGm={isGm} onChanged={onChanged} say={say} />
      ) : (
        <p className="cf-sub">After a session, a recap shows here.</p>
      )}
      {earlier.length > 0 && (
        <>
          <h3 className="cf-h3">Earlier</h3>
          <ul className="cfa-rows">
            {earlier.map((s) => (
              <li key={s.id}>
                <b>{s.before ? '·' : s.number}</b>
                <span>{s.title || (s.before ? 'Before Campfire' : `Session ${s.number}`)}</span>
                <span>{s.startsAt ? dayTime(s.startsAt).day : ''}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="cf-link" onClick={onAll}>
            All sessions
          </button>
        </>
      )}
    </section>
  )
}

function RecapBody({
  s,
  isGm,
  onChanged,
  say
}: Common & { s: CampfireSession }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(s.recap)
  const [seen, setSeen] = useState(s.recap)
  if (seen !== s.recap) {
    setSeen(s.recap)
    setText(s.recap)
  }
  const save = async (post: boolean): Promise<void> => {
    const r = await cf.patch(`/campfire/sessions/${s.id}`, {
      recap: text,
      ...(post ? { post: true } : {})
    })
    if (!r.ok) return say(r.message)
    setEditing(false)
    onChanged()
  }
  const draft = async (): Promise<void> => {
    const r = await cf.post<{ draft: string }>(`/campfire/sessions/${s.id}/draft`)
    if (!r.ok) return say(r.message)
    setText((x) => (x.trim() ? `${x.trim()}\n\n${r.data.draft}` : r.data.draft))
  }
  const chips = statChips(s.stats)
  if (editing && isGm)
    return (
      <div className="cfa-edit">
        <textarea aria-label="Recap" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="cfa-inline-row">
          <button type="button" className="cf-ghost" onClick={() => void draft()}>
            Draft from the session
          </button>
          <button type="button" className="cf-ghost" onClick={() => void save(false)}>
            Save
          </button>
          <button type="button" className="cf-primary cfa-push" onClick={() => void save(true)}>
            {s.recapPostedAt ? 'Save' : 'Post for players'}
          </button>
        </div>
      </div>
    )
  return (
    <>
      {s.recap ? (
        <p className="cfa-recap">{s.recap}</p>
      ) : (
        <p className="cf-sub">
          {isGm ? 'No recap yet.' : 'The game master hasn’t posted the recap yet.'}
        </p>
      )}
      {chips.length > 0 && (
        <div className="cfa-chips">
          {chips.map((c) => (
            <span key={c} className="cf-chip">
              {c}
            </span>
          ))}
        </div>
      )}
      {isGm && (
        <div className="cfa-note">
          <span>
            {s.recapPostedAt
              ? 'Posted: players see it.'
              : 'Not posted yet: only game masters see it.'}{' '}
            {s.before
              ? 'From your setup: the story before Campfire.'
              : 'Drafted from the session’s fights and rolls, then edited by you.'}
          </span>
          <button type="button" className="cf-ghost cf-small" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      )}
    </>
  )
}

function LootSummary({
  loot,
  isGm,
  partySize,
  campaignId,
  onChanged,
  say,
  onAll
}: Common & {
  loot: PartyLoot
  partySize: number
  campaignId: string
  onAll?: () => void
}): React.JSX.Element {
  const per = (n: number): number => Math.floor(n / Math.max(1, partySize))
  const split = async (): Promise<void> => {
    const r = await cf.post<{ each: PartyLoot['coins'] }>(
      `/campfire/campaigns/${campaignId}/loot/split`,
      {}
    )
    if (!r.ok) return say(r.message)
    say(`Everyone got ${r.data.each.gp} gp${r.data.each.sp ? `, ${r.data.each.sp} sp` : ''}.`)
    onChanged()
  }
  const any = Object.values(loot.coins).some((v) => v > 0)
  return (
    <section className="cfa-panel" aria-labelledby="hub-loot">
      <div className="cfa-panel-head">
        <h2 id="hub-loot">{onAll ? 'Party loot' : 'Split the coins'}</h2>
        {onAll && (
          <button type="button" className="cf-link" onClick={onAll}>
            Open
          </button>
        )}
      </div>
      <div className="cfa-coins">
        <span>
          <b>{loot.coins.gp}</b> gp
        </span>
        {loot.coins.sp > 0 && (
          <span>
            <b>{loot.coins.sp}</b> sp
          </span>
        )}
        {loot.coins.pp > 0 && (
          <span>
            <b>{loot.coins.pp}</b> pp
          </span>
        )}
        <span>
          <b>{loot.items.length}</b> {loot.items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      {loot.items.length > 0 && (
        <span className="cf-sub">
          {loot.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(' · ')}
        </span>
      )}
      {isGm && any && partySize > 0 && (
        <button type="button" className="cf-primary" onClick={() => void split()}>
          Split evenly ({per(loot.coins.gp)} gp{loot.coins.sp ? `, ${per(loot.coins.sp)} sp` : ''}{' '}
          each)
        </button>
      )}
    </section>
  )
}

function SessionsTab({
  hub,
  isGm,
  campaignId,
  onChanged,
  say
}: Common & { hub: CampaignHub; campaignId: string }): React.JSX.Element {
  const list = [...hub.sessions].sort((a, b) => b.number - a.number)
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null)
  const add = async (): Promise<void> => {
    const r = await cf.post(`/campfire/campaigns/${campaignId}/sessions`, {})
    if (!r.ok) return say(r.message)
    onChanged()
  }
  return (
    <div className="cfa-col" style={{ maxWidth: 860 }}>
      {isGm && (
        <button
          type="button"
          className="cf-soft"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void add()}
        >
          + New session
        </button>
      )}
      {list.map((s) => (
        <section key={s.id} className="cfa-panel">
          <button
            type="button"
            className="cfa-panel-head cf-plain"
            aria-expanded={open === s.id}
            onClick={() => setOpen(open === s.id ? null : s.id)}
          >
            <h2>
              {s.before
                ? 'Before Campfire'
                : `Session ${s.number}${s.title ? ` · ${s.title}` : ''}`}
            </h2>
            <span className="cf-sub">
              {s.startsAt ? `${dayTime(s.startsAt).day} ${dayTime(s.startsAt).time}` : 'No date'}
            </span>
          </button>
          {open === s.id && (
            <>
              {isGm && !s.before && <SessionEdit s={s} onChanged={onChanged} say={say} />}
              <RecapBody s={s} isGm={isGm} onChanged={onChanged} say={say} />
            </>
          )}
        </section>
      ))}
      {!list.length && <p className="cf-sub">No sessions yet.</p>}
    </div>
  )
}

function SessionEdit({
  s,
  onChanged,
  say
}: {
  s: CampfireSession
  onChanged: () => void
  say: (m: string) => void
}): React.JSX.Element {
  const [title, setTitle] = useState(s.title)
  const [when, setWhen] = useState(localValue(s.startsAt))
  const save = async (): Promise<void> => {
    const r = await cf.patch(`/campfire/sessions/${s.id}`, {
      title,
      startsAt: when ? new Date(when).toISOString() : null
    })
    if (!r.ok) return say(r.message)
    onChanged()
  }
  return (
    <div className="cfa-inline-row">
      <input
        aria-label="Session title"
        placeholder="Title (optional)"
        value={title}
        maxLength={100}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="datetime-local"
        aria-label="When"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />
      <button type="button" className="cf-ghost" onClick={() => void save()}>
        Save
      </button>
      <button
        type="button"
        className="cf-ghost cf-danger-text"
        onClick={async () => {
          if (!window.confirm('Delete this session and its recap?')) return
          const r = await cf.del(`/campfire/sessions/${s.id}`)
          if (!r.ok) return say(r.message)
          onChanged()
        }}
      >
        Delete
      </button>
    </div>
  )
}

function QuestsTab({
  quests,
  isGm,
  campaignId,
  onChanged,
  say
}: Common & { quests: Quest[]; campaignId: string }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [giver, setGiver] = useState('')
  const [hidden, setHidden] = useState(false)
  const add = async (): Promise<void> => {
    if (!title.trim()) return
    const r = await cf.post(`/campfire/campaigns/${campaignId}/quests`, {
      title,
      giver,
      hidden,
      sort: quests.length
    })
    if (!r.ok) return say(r.message)
    setTitle('')
    setGiver('')
    onChanged()
  }
  const patch = async (q: Quest, body: Partial<Quest>): Promise<void> => {
    const r = await cf.patch(`/campfire/quests/${q.id}`, body)
    if (!r.ok) return say(r.message)
    onChanged()
  }
  return (
    <div className="cfa-col" style={{ maxWidth: 860 }}>
      {isGm && (
        <form
          className="cfa-panel"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <div className="cfa-inline-row">
            <input
              aria-label="Quest"
              placeholder="New quest"
              className="cfa-grow"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              aria-label="Who gave it"
              placeholder="Who gave it (optional)"
              value={giver}
              maxLength={80}
              onChange={(e) => setGiver(e.target.value)}
            />
            <label className="cf-check">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
              />{' '}
              Hidden from players
            </label>
            <button type="submit" className="cf-primary" disabled={!title.trim()}>
              Add
            </button>
          </div>
        </form>
      )}
      {quests.map((q) => (
        <div
          key={q.id}
          className={`cfa-quest${q.status === 'open' ? ' cfa-quest--open' : ' cfa-quest--done'}`}
        >
          <div className="cfa-inline-row">
            <b>{q.title}</b>
            {q.hidden && <span className="cfa-hidden-tag">Hidden</span>}
            <span className="cf-sub">
              {q.status === 'done' ? 'Done' : q.status === 'failed' ? 'Failed' : 'Open'}
            </span>
            {isGm && (
              <span className="cfa-push cfa-inline-row">
                <select
                  aria-label={`${q.title}: status`}
                  value={q.status}
                  onChange={(e) => void patch(q, { status: e.target.value as Quest['status'] })}
                >
                  <option value="open">Open</option>
                  <option value="done">Done</option>
                  <option value="failed">Failed</option>
                </select>
                <button
                  type="button"
                  className="cf-ghost cf-small"
                  onClick={() => void patch(q, { hidden: !q.hidden })}
                >
                  {q.hidden ? 'Show players' : 'Hide'}
                </button>
                <button
                  type="button"
                  className="cf-ghost cf-small"
                  onClick={async () => {
                    const r = await cf.del(`/campfire/quests/${q.id}`)
                    if (!r.ok) return say(r.message)
                    onChanged()
                  }}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
          {(q.detail || q.giver) && (
            <span>{[q.detail, q.giver && `from ${q.giver}`].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      ))}
      {!quests.length && <p className="cf-sub">No quests yet.</p>}
    </div>
  )
}

function LootTab({
  hub,
  isGm,
  campaignId,
  onChanged,
  say
}: Common & { hub: CampaignHub; campaignId: string }): React.JSX.Element {
  const [loot, setLoot] = useState<PartyLoot>(hub.loot)
  const [item, setItem] = useState('')
  const [seen, setSeen] = useState(hub.loot)
  if (seen !== hub.loot) {
    setSeen(hub.loot)
    setLoot(hub.loot)
  }
  const save = async (next: PartyLoot): Promise<void> => {
    setLoot(next)
    const r = await cf.put(`/campfire/campaigns/${campaignId}/loot`, { loot: next })
    if (!r.ok) say(r.message)
    onChanged()
  }
  const give = async (it: LootItem, characterId: string): Promise<void> => {
    const r = await cf.post(`/campfire/campaigns/${campaignId}/loot/give`, {
      itemId: it.id,
      characterId
    })
    if (!r.ok) return say(r.message)
    onChanged()
  }
  return (
    <div className="cfa-col" style={{ maxWidth: 860 }}>
      <section className="cfa-panel">
        <h2 className="cf-h3">Coins</h2>
        <div
          className="cfa-scores cfa-scores--edit"
          style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
        >
          {(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map((k) => (
            <label key={k}>
              <span>{k.toUpperCase()}</span>
              {isGm ? (
                <input
                  type="number"
                  min={0}
                  value={loot.coins[k]}
                  onChange={(e) =>
                    setLoot({
                      ...loot,
                      coins: { ...loot.coins, [k]: Math.max(0, Number(e.target.value) || 0) }
                    })
                  }
                  onBlur={() => void save(loot)}
                />
              ) : (
                <b>{loot.coins[k]}</b>
              )}
            </label>
          ))}
        </div>
      </section>
      <LootSummary
        loot={loot}
        isGm={isGm}
        partySize={hub.party.length}
        campaignId={campaignId}
        onChanged={onChanged}
        say={say}
      />
      <section className="cfa-panel">
        <h2 className="cf-h3">Items</h2>
        <ul className="cfa-list">
          {loot.items.map((it) => (
            <li key={it.id}>
              <span>
                <b>
                  {it.qty > 1 ? `${it.qty} × ` : ''}
                  {it.name}
                </b>
                {it.notes && <span className="cf-sub">{it.notes}</span>}
              </span>
              {isGm && (
                <>
                  <select
                    aria-label={`Give ${it.name} to`}
                    value=""
                    onChange={(e) => e.target.value && void give(it, e.target.value)}
                  >
                    <option value="">Give to…</option>
                    {hub.party.map((p) => (
                      <option key={p.characterId} value={p.characterId}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cf-ghost cf-small"
                    onClick={() =>
                      void save({ ...loot, items: loot.items.filter((x) => x.id !== it.id) })
                    }
                  >
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {isGm && (
          <form
            className="cfa-inline-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (!item.trim()) return
              void save({
                ...loot,
                items: [
                  ...loot.items,
                  { id: `l${Date.now().toString(36)}`, name: item.trim(), qty: 1, notes: '' }
                ]
              })
              setItem('')
            }}
          >
            <input
              aria-label="New item"
              placeholder="Add an item (Potion of healing)"
              className="cfa-grow"
              value={item}
              maxLength={80}
              onChange={(e) => setItem(e.target.value)}
            />
            <button type="submit" className="cf-ghost" disabled={!item.trim()}>
              Add
            </button>
          </form>
        )}
      </section>
    </div>
  )
}

function JournalTab({
  entries,
  isGm,
  campaignId,
  onChanged,
  say
}: Common & { entries: JournalEntry[]; campaignId: string }): React.JSX.Element {
  const [sel, setSel] = useState<string | 'new' | null>(entries[0]?.id ?? null)
  const cur = sel === 'new' ? null : (entries.find((e) => e.id === sel) ?? null)
  const [draft, setDraft] = useState<{
    kind: JournalKind
    name: string
    text: string
    hidden: boolean
    gmNotes: string
    pictureFileId: string | null
  }>({ kind: 'npc', name: '', text: '', hidden: false, gmNotes: '', pictureFileId: null })
  // The draft follows the picked entry (and its saved copy after a reload).
  const [shown, setShown] = useState<JournalEntry | string | null | undefined>(undefined)
  const showing = cur ?? sel
  if (shown !== showing) {
    setShown(showing)
    if (cur)
      setDraft({
        kind: cur.kind,
        name: cur.name,
        text: cur.text,
        hidden: cur.hidden,
        gmNotes: cur.gmNotes ?? '',
        pictureFileId: cur.pictureFileId
      })
    else if (sel === 'new')
      setDraft({ kind: 'npc', name: '', text: '', hidden: false, gmNotes: '', pictureFileId: null })
  }
  const save = async (): Promise<void> => {
    const r =
      sel === 'new'
        ? await cf.post<JournalEntry>(`/campfire/campaigns/${campaignId}/journal`, draft)
        : await cf.patch<JournalEntry>(`/campfire/journal/${sel}`, draft)
    if (!r.ok) return say(r.message)
    setSel(r.data.id)
    onChanged()
  }
  return (
    <div className="cfa-hub-grid" style={{ gridTemplateColumns: '300px 1fr' }}>
      <div className="cfa-col">
        {isGm && (
          <button type="button" className="cf-soft" onClick={() => setSel('new')}>
            + New entry
          </button>
        )}
        {entries.map((e) => (
          <button
            key={e.id}
            type="button"
            className="cfa-brew-item"
            aria-pressed={sel === e.id}
            onClick={() => setSel(e.id)}
          >
            <span>
              <b>{e.name}</b>
              {e.hidden && <span className="cfa-hidden-tag">Hidden</span>}
            </span>
            <span>
              {e.kind === 'npc'
                ? 'NPC'
                : e.kind === 'place'
                  ? 'Place'
                  : e.kind === 'item'
                    ? 'Item'
                    : 'Lore'}
            </span>
          </button>
        ))}
        {!entries.length && <p className="cf-sub">Nothing written yet.</p>}
      </div>
      {(cur || sel === 'new') &&
        (isGm ? (
          <section className="cfa-panel">
            <div className="cfa-inline-row">
              <input
                aria-label="Name"
                className="cfa-grow"
                value={draft.name}
                maxLength={100}
                placeholder="Abbess Mara"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <select
                aria-label="Kind"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as JournalKind })}
              >
                <option value="npc">NPC</option>
                <option value="place">Place</option>
                <option value="item">Item</option>
                <option value="lore">Lore</option>
              </select>
              <label className="cf-check">
                <input
                  type="checkbox"
                  checked={draft.hidden}
                  onChange={(e) => setDraft({ ...draft, hidden: e.target.checked })}
                />{' '}
                Hidden from players
              </label>
            </div>
            <div className="cfa-inline-row">
              <button
                type="button"
                className="cfa-banner-pick"
                style={{
                  width: 160,
                  height: 120,
                  ...(draft.pictureFileId
                    ? { backgroundImage: `url("${fileUrl(draft.pictureFileId)}")` }
                    : {})
                }}
                onClick={async () => {
                  const file = await pickFile(IMAGE_ACCEPT)
                  if (!file) return
                  const up = await uploadFile(campaignId, 'handout', file)
                  if (!up.ok) return say(up.message)
                  setDraft({ ...draft, pictureFileId: up.data.id })
                }}
              >
                {draft.pictureFileId ? '' : 'Add a picture'}
              </button>
              <textarea
                aria-label="What players know"
                className="cfa-grow"
                rows={5}
                placeholder="What players know"
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </div>
            <label className="cf-field">
              <span>Game master notes (never shown to players)</span>
              <textarea
                rows={3}
                value={draft.gmNotes}
                onChange={(e) => setDraft({ ...draft, gmNotes: e.target.value })}
              />
            </label>
            <div className="cfa-inline-row">
              {cur && (
                <button
                  type="button"
                  className="cf-ghost cf-danger-text"
                  onClick={async () => {
                    const r = await cf.del(`/campfire/journal/${cur.id}`)
                    if (!r.ok) return say(r.message)
                    setSel(null)
                    onChanged()
                  }}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                className="cf-primary cfa-push"
                disabled={!draft.name.trim()}
                onClick={() => void save()}
              >
                Save
              </button>
            </div>
          </section>
        ) : (
          cur && (
            <section className="cfa-panel">
              <h2 className="cf-h2">{cur.name}</h2>
              {cur.pictureFileId && (
                <img
                  src={fileUrl(cur.pictureFileId)}
                  alt=""
                  style={{ maxWidth: 320, borderRadius: 14 }}
                />
              )}
              <p className="cfa-recap">{cur.text || 'Nothing written yet.'}</p>
            </section>
          )
        ))}
    </div>
  )
}
