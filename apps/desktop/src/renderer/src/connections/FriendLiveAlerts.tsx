import { useEffect, useRef, useState } from 'react'
import type { FriendStream, PublicUser } from '@glofly/shared'
import { siteName } from '@glofly/shared'
import Avatar from '../components/Avatar'
import { useCalls } from '../calls/callState'
import {
  clearFriendsLive,
  friendLive,
  isStreamPage,
  setLiveAlertsMuted,
  noteFriendLive,
  refreshFriendsLive,
  SITE_LOOK
} from '../lib/connections'
import { firstNameOf, notificationsAllowed, notify, shouldNotify } from '../lib/notify'
import { playSound } from '../lib/sounds'
import { headerUrl } from '../lib/media'
import './Connections.css'

// 0.9.3 (approved board 9): "Chip went live on Kick". A friend who linked Twitch or Kick and
// tells friends: a card here (Watch together, Open on Kick), a Windows notification with the same
// buttons, and the LIVE badges everywhere (lib/connections.ts keeps who's live).
//
// Watch together plays the stream for everyone in the call you're in (Watch Together); not in a
// call, the button opens the stream instead (there's nobody to watch with yet).

type Shown = { stream: FriendStream; person: PublicUser }

export default function FriendLiveAlerts({
  friends
}: {
  friends: PublicUser[]
}): React.JSX.Element | null {
  const calls = useCalls()
  const [shown, setShown] = useState<Shown | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const friendsRef = useRef(friends)
  const callRef = useRef(calls.current)
  useEffect(() => {
    friendsRef.current = friends
    callRef.current = calls.current
  })

  const inCall = (): string | null => {
    const c = callRef.current
    return c && c.phase === 'connected' && c.call ? c.call.id : null
  }

  const watchTogether = async (stream: FriendStream): Promise<void> => {
    if (!isStreamPage(stream.url)) return
    const callId = inCall()
    if (!callId) {
      window.open(stream.url, '_blank', 'noopener,noreferrer')
      return
    }
    const r = await window.glofly.watch.start(callId, stream.url, 'everyone')
    if (!r.ok) setProblem(r.message)
    else setShown(null)
  }
  const open = (stream: FriendStream): void => {
    if (isStreamPage(stream.url)) window.open(stream.url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    void refreshFriendsLive()
    const off = window.glofly.onEvent((e) => {
      if (e.type === 'connection' && e.connected) void refreshFriendsLive()
      if (e.type === 'session:expired') clearFriendsLive()
      if (e.type === 'friend:live') {
        noteFriendLive(e)
        if (!e.live || !e.alert) return
        const person = friendsRef.current.find((f) => f.id === e.userId)
        if (!person) return
        const stream = e.live
        const site = siteName(stream.source)
        if (!notificationsAllowed()) return
        playSound('friendOnline')
        setProblem(null)
        setShown({ stream, person })
        if (shouldNotify()) {
          const callId = inCall()
          void notify(
            {
              key: `live:${person.id}`,
              conversationId: null,
              title: `${person.displayName} went live on ${site}`,
              body:
                [stream.title, stream.game].filter(Boolean).join(' · ') ||
                `Watch ${firstNameOf(person)} on ${site}`,
              rich: {
                kind: 'live',
                attribution: `Glofly · ${site}`,
                hero: true,
                buttons: [
                  ...(callId
                    ? [{ id: 'watch' as const, label: 'Watch together', style: 'success' as const }]
                    : []),
                  { id: 'open' as const, label: `Open on ${site}` },
                  { id: 'mute-live' as const, label: `Mute ${firstNameOf(person)}'s live alerts` }
                ]
              }
            },
            person,
            // Their profile header as the picture across the top (Chip, Nov 8: when there's no game art).
            e.headerVersion ? headerUrl(person.id, e.headerVersion) : null
          )
        }
      }
      if (e.type === 'notification:action' && e.key.startsWith('live:')) {
        const userId = e.key.slice(5)
        if (e.action === 'mute-live') {
          void setLiveAlertsMuted(userId, true)
          return
        }
        const s = friendLive(userId)
        if (s && e.action === 'watch') void watchTogether(s)
        else if (s && e.action === 'open') open(s)
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The card goes after a while on its own.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(null), 20_000)
    return () => clearTimeout(t)
  }, [shown])

  if (!shown) return null
  const { stream, person } = shown
  const site = siteName(stream.source)
  return (
    <div className="live-toast" role="status" aria-live="polite">
      <span className="live-toast-face">
        <Avatar
          id={person.id}
          name={person.displayName}
          avatarVersion={person.avatarVersion}
          size={48}
        />
        <span className="live-toast-site" style={{ background: SITE_LOOK[stream.source].color }}>
          {SITE_LOOK[stream.source].badge}
        </span>
      </span>
      <span className="live-toast-text">
        <b>
          {person.displayName} went live on {site}
        </b>
        <span>
          {problem ??
            ([stream.title, stream.game].filter(Boolean).join(' · ') ||
              `Watch ${firstNameOf(person)} on ${site}`)}
        </span>
      </span>
      <button
        type="button"
        className="live-toast-btn live-toast-btn--main"
        onClick={() => void watchTogether(stream)}
        title={
          calls.current?.phase === 'connected'
            ? 'Play it for everyone in your call'
            : 'Not in a call: opens the stream'
        }
      >
        Watch together
      </button>
      <button type="button" className="live-toast-btn" onClick={() => open(stream)}>
        Open on {site}
      </button>
      <button
        type="button"
        className="live-toast-close"
        aria-label="Dismiss"
        onClick={() => setShown(null)}
      >
        ×
      </button>
    </div>
  )
}
