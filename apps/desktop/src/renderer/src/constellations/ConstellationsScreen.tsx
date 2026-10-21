import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ConstellationCard,
  ConstellationDetail,
  ConstellationInvite,
  ConversationSummary,
  DirectoryEntry,
  Message,
  MyStatus,
  MyStatusChanges,
  Presence,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { api, usePinnedNebulas } from '../lib/constellations'
import { Swarm } from './sky'
import { makeStars, makeSwarm, prefersReducedMotion } from './skyData'
import { rememberPlace, viewingNebula, type CxPhase, type CxPlace } from './phase'
import { detailCache, rememberDetail } from './preload'
import Dashboard from './Dashboard'
import CreateJoin, { AskToJoin } from './CreateJoin'
import ConstellationView, { type SettingsPageName } from './ConstellationView'
import ConstellationSettings from './Settings'
import DmDock from './DmDock'
import { CxToast } from './bits'
import './Constellations.css'

// Constellations (Glofly 2.0), the whole night side: the starry swipe in, the dashboard, a
// constellation, and the firefly swarm home (Transition.dc.html, approved; timings from the
// mockup's Component: sweep → space at 1050 ms, return → home at 2100 ms).

type Props = {
  phase: CxPhase
  /** 0.7.1: a quick hop (you're in a constellation already) instead of the full swipe and swarm */
  quick?: boolean
  origin: { x: number; y: number }
  start: CxPlace
  me: SignedInUser
  myStatus: MyStatus
  onChangeStatus: (changes: MyStatusChanges) => Promise<boolean>
  presence: Record<string, Presence>
  friends: PublicUser[]
  conversations: ConversationSummary[]
  now: number
  cards: ConstellationCard[]
  invites: ConstellationInvite[]
  loaded: boolean
  reloadCards: () => void
  /** Back to Glofly (the swarm) */
  onHome: () => void
  /** Back to Glofly with this chat open */
  onOpenChat: (conversationId: string) => void
  /** Back to Glofly and call this chat */
  onCall: (conversation: ConversationSummary) => void
  /** Back to Glofly with a DM to this person */
  onMessage: (person: PublicUser) => void
  onRead: (conversationId: string) => void
  /** Opens (or finds) your DM with a friend, for a new message from the dock; its id or null */
  onStartDm: (person: PublicUser) => Promise<string | null>
  onViewProfile: (person: PublicUser) => void
  onReport: (message: Message, sender: PublicUser) => void
  onAppSettings: () => void
  onSessionExpired: () => void
}

type Dialog =
  | { kind: 'create'; tab: 'create' | 'join' }
  | { kind: 'ask'; entry: DirectoryEntry }
  | { kind: 'settings'; page: SettingsPageName }
  | null

const REMOVED_TEXT = {
  kicked: 'You were removed from that constellation.',
  banned: 'You were banned from that constellation.',
  taken_down: 'That constellation was taken down by the Glofly team.',
  deleted: 'That constellation was deleted.'
} as const

/** The night layer: rendered whenever the phase isn't "home". */
export default function ConstellationsScreen(props: Props): React.JSX.Element | null {
  const { phase, origin, quick } = props
  const stars = useMemo(() => makeStars(), [])
  const swarm = useMemo(() => makeSwarm(), [])
  if (phase === 'home') return null
  const inSpace = phase === 'space' || phase === 'return'
  const nightClass =
    phase === 'sweep' ? 'cx-night on' : phase === 'return' ? 'cx-night leave' : 'cx-night done'
  const style = { '--cx-ox': `${origin.x}px`, '--cx-oy': `${origin.y}px` } as React.CSSProperties
  return (
    <>
      <div
        className={`cx-root ${nightClass}${quick ? ' cx-quick' : ''}`}
        style={style}
        aria-hidden={phase === 'return' ? true : undefined}
      >
        <div className="cx-stars" aria-hidden="true">
          {stars.map((s, i) => (
            <span
              key={i}
              className={s.gold ? 'cx-star gold' : 'cx-star'}
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.size,
                height: s.size,
                animationDelay: `${s.delay}ms`
              }}
            />
          ))}
        </div>
        {inSpace && <Space {...props} />}
      </div>
      {phase === 'return' && !quick && <Swarm flies={swarm} />}
    </>
  )
}

/** What's on the night side once the swipe is done. */
function Space(props: Props): React.JSX.Element {
  const { me, cards, reloadCards, phase } = props
  // Nebulas pinned to the dock on Glofly home (right-click a nebula → Pin to Glofly dock)
  const pinned = usePinnedNebulas(true)
  const pinnedIds = useMemo(() => new Set(pinned.pins.map((p) => p.nebula.id)), [pinned.pins])
  const [place, setPlace] = useState<CxPlace>(props.start)
  // Asked to go somewhere while already here (a notification): go.
  const [startSeen, setStartSeen] = useState(props.start)
  if (startSeen !== props.start) {
    setStartSeen(props.start)
    if (props.start) setPlace(props.start)
  }
  // 0.7.1: the last look at each constellation, so flying back in shows it straight away (no
  // "Flying in…" flash) while the fresh copy loads.
  const [loadedDetail, setDetailState] = useState<ConstellationDetail | null>(() =>
    props.start ? (detailCache.get(props.start.constellationId) ?? null) : null
  )
  const setDetail = useCallback((d: React.SetStateAction<ConstellationDetail | null>) => {
    setDetailState((old) => {
      const next = typeof d === 'function' ? d(old) : d
      if (next) rememberDetail(next)
      return next
    })
  }, [])
  // Remembered for the Constellations button: it brings you back here next time.
  useEffect(() => {
    rememberPlace(me.id, place)
  }, [me.id, place])
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const placeRef = useRef(place)
  useLayoutEffect(() => {
    placeRef.current = place
  }, [place])
  const leaving = phase === 'return'

  const say = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  const openId = place?.constellationId ?? null
  // The loaded one, while it's still the one that's open
  const detail =
    loadedDetail && loadedDetail.id === openId
      ? loadedDetail
      : openId
        ? (detailCache.get(openId) ?? null)
        : null
  const load = useCallback(
    (id: string): void => {
      void api.get(id).then((r) => {
        if (placeRef.current?.constellationId !== id) return
        if (r.ok) {
          setDetail(r.data.constellation)
          setLoadProblem(null)
        } else if (r.error === 'unauthorized') props.onSessionExpired()
        else if (r.error === 'not_found' || r.error === 'forbidden') {
          setPlace(null)
          setDetail(null)
          say(r.message || "That constellation isn't available.")
          reloadCards()
        } else setLoadProblem(r.message)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, reloadCards]
  )

  // Load the open constellation (and when you switch).
  useEffect(() => {
    if (openId) load(openId)
  }, [openId, load])

  // Live: reload it when it changes; a moment later when its nebulas are busy.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const later = (id: string): void => {
      if (reloadTimer.current) return
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null
        load(id)
      }, 500)
    }
    const stop = window.glofly.onEvent((event) => {
      const here = placeRef.current?.constellationId
      if (event.type === 'constellation:updated' && event.constellationId === here) load(here)
      else if (event.type === 'constellation:activity' && event.constellationId === here)
        later(here)
      else if (event.type === 'constellation:voice' && event.constellationId === here) {
        setDetail((d) => {
          if (!d || d.id !== event.constellationId) return d
          const others = d.voice.filter((v) => v.nebulaId !== event.voice.nebulaId)
          return { ...d, voice: event.voice.userIds.length > 0 ? [...others, event.voice] : others }
        })
      } else if (event.type === 'constellation:removed') {
        if (event.constellationId === here) {
          setPlace(null)
          setDetail(null)
          setDialog(null)
          say(REMOVED_TEXT[event.reason] ?? 'That constellation is gone.')
        }
      } else if (event.type === 'connection' && event.connected && here) load(here)
    })
    return () => {
      stop()
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
      reloadTimer.current = null
    }
  }, [load, say, setDetail])

  // Escape on the dashboard (nothing else open) goes home, like the "Back to Glofly" pill.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || dialog || placeRef.current) return
      if (document.querySelector('.dialog-backdrop, .cx-dialog-backdrop, .mini-chat')) return
      props.onHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, props])

  const open = useCallback(
    (constellationId: string, nebulaId: string | null = null) => {
      setPlace({ constellationId, nebulaId })
      reloadCards()
    },
    [reloadCards]
  )
  // Which nebula's chat is on screen (Glofly doesn't ding for the one you're looking at).
  const onScreen =
    detail?.nebulas.find((n) => n.id === place?.nebulaId) ??
    detail?.nebulas.find((n) => n.kind === 'text')
  const onScreenChat = !leaving && onScreen ? onScreen.conversationId : null
  useEffect(() => {
    viewingNebula.conversationId = onScreenChat
    return () => {
      viewingNebula.conversationId = null
    }
  }, [onScreenChat])
  const friendIds = useMemo(() => new Set(props.friends.map((f) => f.id)), [props.friends])
  const night = !place

  return (
    <div
      className={
        leaving
          ? 'cx-content cx-content--still'
          : prefersReducedMotion()
            ? 'cx-content cx-content--still'
            : 'cx-content'
      }
    >
      {!place ? (
        <Dashboard
          me={me}
          myStatus={props.myStatus}
          cards={cards}
          invites={props.invites}
          loaded={props.loaded}
          onBack={props.onHome}
          onOpen={(id) => open(id)}
          onCreate={(tab) => setDialog({ kind: 'create', tab })}
          onJoined={(id) => open(id)}
          onReorder={(ids) => {
            void api.order(ids).then((r) => {
              if (!r.ok) say(r.message)
              reloadCards()
            })
          }}
          onProblem={say}
          onAskToJoin={(entry) => setDialog({ kind: 'ask', entry })}
        />
      ) : detail ? (
        <ConstellationView
          me={me}
          myStatus={props.myStatus}
          onChangeStatus={props.onChangeStatus}
          presence={props.presence}
          friendIds={friendIds}
          detail={detail}
          cards={cards}
          nebulaId={place.nebulaId}
          now={props.now}
          onSelectNebula={(nebulaId) => setPlace({ constellationId: detail.id, nebulaId })}
          onHome={props.onHome}
          onDashboard={() => {
            setPlace(null)
            reloadCards()
          }}
          onOpenConstellation={(id) => open(id)}
          onOpenPlace={(id, nebulaId) => open(id, nebulaId)}
          onCreate={() => setDialog({ kind: 'create', tab: 'create' })}
          onSettings={(page) => setDialog({ kind: 'settings', page })}
          onAppSettings={props.onAppSettings}
          onViewProfile={props.onViewProfile}
          onMessage={props.onMessage}
          onReport={props.onReport}
          onInvite={() => setDialog({ kind: 'settings', page: 'invites' })}
          onProblem={say}
          onSessionExpired={props.onSessionExpired}
          onChanged={(d) => setDetail(d)}
          onReload={() => {
            load(detail.id)
            reloadCards()
          }}
          pinnedIds={pinnedIds}
          onTogglePin={(n) => {
            const on = pinnedIds.has(n.id)
            void (on ? api.unpin(detail.id, n.id) : api.pin(detail.id, n.id)).then((r) => {
              if (!r.ok) say(r.message)
              else {
                pinned.setPins(r.data.pins)
                say(
                  on
                    ? `Unpinned #${n.name} from your Glofly dock.`
                    : `Pinned #${n.name} to your Glofly dock.`
                )
              }
            })
          }}
          onLeft={() => {
            setPlace(null)
            setDetail(null)
            reloadCards()
            say(`You left ${detail.name}.`)
          }}
        />
      ) : (
        <div className="cx-loading" role="status">
          {loadProblem ? (
            <>
              <p>{loadProblem}</p>
              <button type="button" className="cx-pill" onClick={() => openId && load(openId)}>
                Try again
              </button>
              <button type="button" className="cx-pill" onClick={() => setPlace(null)}>
                Your constellations
              </button>
            </>
          ) : (
            <p>Flying in…</p>
          )}
        </div>
      )}

      {dialog?.kind === 'create' && (
        <CreateJoin
          initialTab={dialog.tab}
          onClose={() => setDialog(null)}
          onDone={(id) => {
            setDialog(null)
            open(id)
          }}
        />
      )}
      {dialog?.kind === 'ask' && (
        <AskToJoin
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onSent={() => {
            setDialog(null)
            say(`Request sent. A moderator of ${dialog.entry.name} will let you in.`)
          }}
        />
      )}
      {dialog?.kind === 'settings' && detail && (
        <ConstellationSettings
          me={me}
          detail={detail}
          initialPage={dialog.page}
          friends={props.friends}
          onClose={() => setDialog(null)}
          onChanged={(d) => {
            setDetail(d)
            reloadCards()
          }}
          onDeleted={() => {
            setDialog(null)
            setPlace(null)
            setDetail(null)
            reloadCards()
            say(`${detail.name} was deleted.`)
          }}
          onProblem={say}
        />
      )}

      {!leaving && (
        <DmDock
          me={me}
          conversations={props.conversations}
          presence={props.presence}
          night={night}
          onHome={props.onHome}
          onOpenFull={props.onOpenChat}
          onCall={props.onCall}
          onRead={props.onRead}
          friends={props.friends}
          onStartDm={props.onStartDm}
        />
      )}
      <CxToast text={toast} />
    </div>
  )
}
