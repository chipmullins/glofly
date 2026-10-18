import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { attachmentSummary } from '@glofly/shared/attachments'
import { shortBody } from '@glofly/shared/gifs'
import type {
  ConversationSummary,
  FriendEntry,
  Message,
  MessagePage,
  OverlayInfo,
  OverlayState,
  OverlayToast,
  OverlayVoice,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import Avatar from '../components/Avatar'
import EmojiText from '../components/EmojiText'
import { chatTitle } from '../lib/groups'
import './Overlay.css'

// 0.7.0 Game overlay (Windows): this page is the overlay window (src/main/overlay.ts), the same
// app page as Glofly's main window opened with #overlay. Drawn from the approved "Glofly Game
// Overlay" canvas: while closed, a voice widget, pop-ups and a pinned chat over the game (the
// window takes no clicks then); open (Shift + `), the game dims behind voice, a chat and your
// chats. The call itself runs in the main window: its buttons are sent there as commands.

const TOAST_MS = 6000
const CALL_TOAST_MS = 45_000
const HINT_MS = 8000

/** "Shift+`" → ["Shift", "`"] for the key caps. */
const keyCaps = (accelerator: string): string[] =>
  accelerator.split('+').map((k) => (k === 'Ctrl' ? 'Ctrl' : k))

const preview = (m: Message): string =>
  m.deleted
    ? 'This message was deleted.'
    : m.gif || m.poll || m.game
      ? shortBody(m.body)
      : m.body || attachmentSummary(m.attachments)

/** Your chats, newest first (null if they couldn't be loaded). */
async function fetchChats(): Promise<ConversationSummary[] | null> {
  const r = await window.glofly.conversations.list()
  return r.ok ? [...r.data].sort((a, b) => b.activityAt.localeCompare(a.activityAt)) : null
}

async function fetchMessages(id: string): Promise<MessagePage | null> {
  const r = await window.glofly.conversations.messages(id)
  return r.ok ? r.data : null
}

const firstName = (u: { displayName: string; username?: string }): string =>
  u.displayName.trim().split(/\s+/)[0] || u.username || 'Someone'

function Icon({ name, size = 18 }: { name: string; size?: number }): React.JSX.Element {
  const paths: Record<string, React.JSX.Element> = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    micOff: (
      <>
        <path d="M2 2l20 20" />
        <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.8" />
        <path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3" />
      </>
    ),
    screen: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
    leave: <path d="M3 15c5-5 13-5 18 0l-2 3-4-2v-3a10 10 0 0 0-6 0v3l-4 2z" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    pin: <path d="M12 17v5M9 3h6l-1 7 4 3H6l4-3z" />,
    send: <path d="M5 12h14M13 6l6 6-6 6" />,
    voice: (
      <>
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" />
      </>
    )
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function Firefly({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="var(--ov-accent)" opacity="0.25" />
      <circle cx="12" cy="12" r="5" fill="var(--ov-accent)" />
    </svg>
  )
}

function Keys({ accelerator }: { accelerator: string }): React.JSX.Element {
  const caps = keyCaps(accelerator)
  return (
    <span className="ov-keys">
      {caps.map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="ov-keys-plus">+</span>}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  )
}

export default function OverlayApp(): React.JSX.Element {
  const api = window.glofly.overlay
  const [info, setInfo] = useState<OverlayInfo | null>(null)
  const [state, setState] = useState<OverlayState>({
    visible: false,
    open: false,
    preview: false,
    game: null
  })
  const [voice, setVoice] = useState<OverlayVoice | null>(null)
  const [toasts, setToasts] = useState<OverlayToast[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [me, setMe] = useState<SignedInUser | null>(null)

  const [chats, setChats] = useState<ConversationSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [people, setPeople] = useState<Record<string, PublicUser>>({})
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const settings = info?.settings
  const pinned = settings?.pinnedChat ?? null

  // ---- what the main process says ----
  useEffect(() => {
    if (!api) return
    void api.info().then((i) => i && setInfo(i))
    void window.glofly.auth.me().then(setMe)
    const offs = [
      api.onSettings(setInfo),
      api.onState(setState),
      api.onVoice(setVoice),
      api.onToast((t) =>
        setToasts((list) => [t, ...list.filter((x) => x.key !== t.key)].slice(0, 4))
      ),
      api.onClearToast((key) => setToasts((list) => list.filter((x) => x.key !== key))),
      api.onProblem((m) => setProblem(m))
    ]
    return () => offs.forEach((off) => off())
  }, [api])

  // Pop-ups go by themselves (a ringing call stays longer).
  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) =>
      setTimeout(
        () => setToasts((list) => list.filter((x) => x !== t)),
        t.kind === 'call' ? CALL_TOAST_MS : TOAST_MS
      )
    )
    return () => timers.forEach(clearTimeout)
  }, [toasts])
  useEffect(() => {
    if (!problem) return
    const t = setTimeout(() => setProblem(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [problem])

  // "Press Shift + ` to open it", each time a game (or Try it) starts.
  const lastShown = useRef<string | null>(null)
  useEffect(() => {
    const id = state.visible ? (state.preview ? '(preview)' : (state.game ?? '')) : null
    if (id && id !== lastShown.current) {
      setHint(true)
      const t = setTimeout(() => setHint(false), HINT_MS)
      lastShown.current = id
      return () => clearTimeout(t)
    }
    if (!id) lastShown.current = null
    return undefined
  }, [state.visible, state.preview, state.game])

  // ---- chats ----
  const showChats = useCallback((list: ConversationSummary[] | null) => {
    if (!list) return
    setChats(list)
    setSelected((s) => s ?? list.find((c) => c.unreadCount > 0)?.id ?? list[0]?.id ?? null)
  }, [])
  const showMessages = useCallback((id: string, page: MessagePage | null) => {
    if (!page) return
    setMessages((m) => ({ ...m, [id]: page.messages }))
    setPeople((p) => ({ ...p, ...Object.fromEntries(page.people.map((x) => [x.id, x])) }))
  }, [])

  useEffect(() => {
    if (!state.open) return
    void fetchChats().then(showChats)
    void window.glofly.friends.list().then((r) => r.ok && setFriends(r.data.friends))
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [state.open, showChats])
  useEffect(() => {
    if (!state.open || !selected) return
    void fetchMessages(selected).then((page) => showMessages(selected, page))
    void window.glofly.conversations.markRead(selected)
  }, [state.open, selected, showMessages])
  useEffect(() => {
    if (pinned && state.visible)
      void fetchMessages(pinned).then((page) => showMessages(pinned, page))
  }, [pinned, state.visible, showMessages])
  useEffect(() => {
    if (pinned && chats.length === 0) void fetchChats().then(showChats)
  }, [pinned, chats.length, showChats])

  const stateRef = useRef(state)
  const selectedRef = useRef(selected)
  const meRef = useRef(me)
  useEffect(() => {
    stateRef.current = state
    selectedRef.current = selected
    meRef.current = me
  })
  // New messages as they arrive.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      if (event.type !== 'message:new' || event.nebula) return
      const m = event.message
      if (event.people) {
        setPeople((p) => ({ ...p, ...Object.fromEntries(event.people!.map((x) => [x.id, x])) }))
      }
      setMessages((all) => {
        const list = all[m.conversationId]
        if (!list || list.some((x) => x.id === m.id)) return all
        return { ...all, [m.conversationId]: [...list, m] }
      })
      setChats((list) => {
        const c = list.find((x) => x.id === m.conversationId)
        if (!c) return list
        const reading = stateRef.current.open && selectedRef.current === c.id
        const mine = m.senderId === meRef.current?.id
        const next = {
          ...c,
          lastMessage: m,
          activityAt: m.createdAt,
          unreadCount: reading || mine ? 0 : c.unreadCount + 1
        }
        return [next, ...list.filter((x) => x.id !== c.id)]
      })
      if (stateRef.current.open && selectedRef.current === m.conversationId) {
        void window.glofly.conversations.markRead(m.conversationId)
      }
    })
  }, [])

  // Keep the newest message in view.
  const shown = selected ? messages[selected] : undefined
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown?.length, selected, state.open])

  // Esc goes back to the game.
  useEffect(() => {
    if (!state.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') api?.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.open, api])

  const send = async (): Promise<void> => {
    const body = draft.trim()
    if (!body || !selected || sending) return
    setSending(true)
    const r = await window.glofly.conversations.send(selected, body)
    setSending(false)
    if (!r.ok) {
      setProblem(r.message || "Couldn't send that.")
      return
    }
    setDraft('')
    setMessages((all) => {
      const list = all[selected] ?? []
      return list.some((x) => x.id === r.data.id) ? all : { ...all, [selected]: [...list, r.data] }
    })
  }

  const chat = chats.find((c) => c.id === selected) ?? null
  const pinnedChat = chats.find((c) => c.id === pinned) ?? null
  const nameOf = (id: string): string => {
    if (id === me?.id) return 'You'
    const p = people[id] ?? chats.flatMap((c) => c.members).find((x) => x.id === id)
    return p ? firstName(p) : 'Someone'
  }
  const playingNow = useMemo(
    () => friends.filter((f) => f.presence?.activity && f.presence.status !== 'offline'),
    [friends]
  )

  if (!api || !settings || !state.visible) return <div className="ov-root" />

  const solid = settings.opacity / 100
  const corner = settings.corner
  const toastSide = corner.endsWith('left') ? 'right' : 'left'
  const talking = voice?.people.filter((p) => p.speaking && !p.muted) ?? []
  const iAmMuted = !!voice?.connected && !voice.micOn
  const openKey = settings.openKey
  const voiceShown =
    voice && settings.voice !== 'off'
      ? settings.voice === 'talking'
        ? voice.people.filter((p) => p.speaking && !p.muted)
        : voice.people
      : []

  const toastList = (
    <div className={`ov-toasts ov-toasts--${toastSide}`} aria-live="polite">
      {problem && (
        <div className="ov-toast ov-toast--problem" role="alert">
          {problem}
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.key} className={`ov-toast ov-toast--${t.kind}`}>
          {t.icon ? (
            <img className="ov-toast-face" src={t.icon} alt="" />
          ) : (
            <span className="ov-toast-face ov-toast-face--icon">
              <Firefly size={26} />
            </span>
          )}
          <div className="ov-toast-text">
            <span className="ov-toast-title">{t.title}</span>
            <span className="ov-toast-body">
              <EmojiText text={t.body} />
            </span>
            {t.kind === 'call' ? (
              state.open ? (
                <span className="ov-toast-actions">
                  <button
                    type="button"
                    className="ov-btn ov-btn--answer"
                    onClick={() => {
                      api.command({ cmd: 'answer' })
                      setToasts((l) => l.filter((x) => x !== t))
                    }}
                  >
                    Answer
                  </button>
                  <button
                    type="button"
                    className="ov-btn ov-btn--leave"
                    onClick={() => {
                      api.command({ cmd: 'decline' })
                      setToasts((l) => l.filter((x) => x !== t))
                    }}
                  >
                    Decline
                  </button>
                </span>
              ) : (
                <span className="ov-toast-hint">
                  <Keys accelerator={openKey} /> to answer
                </span>
              )
            ) : (
              !state.open &&
              t.kind === 'message' && (
                <span className="ov-toast-hint">
                  <Keys accelerator={openKey} /> to reply
                </span>
              )
            )}
            {state.open && t.kind === 'message' && t.conversationId && (
              <button
                type="button"
                className="ov-link"
                onClick={() => {
                  setSelected(t.conversationId)
                  setToasts((l) => l.filter((x) => x !== t))
                }}
              >
                Open chat
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  // ---- closed: on top of the game, never in its way ----
  if (!state.open) {
    const pinnedList = pinned ? (messages[pinned] ?? []).filter((m) => !m.event).slice(-4) : []
    return (
      <div className="ov-root" style={{ '--ov-solid': solid } as React.CSSProperties}>
        <div className={`ov-corner ov-corner--${corner}`}>
          {voice && voiceShown.length > 0 && (
            <div className={`ov-voice ov-voice--${settings.voice}`}>
              {settings.voice === 'full' && (
                <div className="ov-voice-head">
                  <Icon name="voice" size={14} />
                  <span>{voice.title}</span>
                </div>
              )}
              {voiceShown.map((p) => (
                <div key={p.id} className="ov-voice-person">
                  <span className={p.speaking && !p.muted ? 'ov-face ov-face--talking' : 'ov-face'}>
                    <Avatar
                      id={p.id}
                      name={p.displayName}
                      avatarVersion={p.avatarVersion}
                      size={settings.voice === 'full' ? 28 : 30}
                      mine={p.me}
                    />
                  </span>
                  {settings.voice !== 'photos' && (
                    <span
                      className={p.muted ? 'ov-voice-name ov-voice-name--muted' : 'ov-voice-name'}
                    >
                      {p.me ? 'You' : firstName(p)}
                    </span>
                  )}
                  {settings.voice === 'full' && p.muted && (
                    <span className="ov-muted-icon" role="img" aria-label="Muted">
                      <Icon name="micOff" size={14} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {iAmMuted && (
            <div className="ov-muted-pill">
              <Icon name="micOff" size={15} />
              You&apos;re muted
              {settings.muteKey && (
                <>
                  {' · '}
                  <Keys accelerator={settings.muteKey} />
                </>
              )}
            </div>
          )}
          {pinned && pinnedList.length > 0 && (
            <div className="ov-pinned">
              <div className="ov-pinned-head">
                <Icon name="pin" size={13} />
                <span>{pinnedChat ? chatTitle(pinnedChat) : 'Pinned chat'}</span>
              </div>
              {pinnedList.map((m) => (
                <div key={m.id} className="ov-pinned-line">
                  <b>{nameOf(m.senderId)}</b> <EmojiText text={preview(m)} />
                </div>
              ))}
            </div>
          )}
        </div>
        {toastList}
        {hint && (
          <div className="ov-hint">
            <Firefly />
            <span>
              {state.preview ? 'This is the Glofly overlay. Press' : 'Glofly overlay is on. Press'}
            </span>
            <Keys accelerator={openKey} />
            <span>to open it</span>
          </div>
        )}
        {/* Who's talking, read out for screen readers */}
        <span className="ov-sr" aria-live="polite">
          {talking.map((p) => p.displayName).join(', ')}
        </span>
      </div>
    )
  }

  // ---- open: the game dims behind Glofly ----
  return (
    <div className="ov-root ov-root--open" style={{ '--ov-solid': solid } as React.CSSProperties}>
      <div className="ov-dim" onMouseDown={(e) => e.target === e.currentTarget && api.close()} />
      <header className="ov-top">
        <span className="ov-brand">
          <Firefly size={30} />
          Glofly
        </span>
        {state.game && (
          <span className="ov-playing">
            <span className="ov-dot" />
            Playing {state.game}
          </span>
        )}
        {state.preview && <span className="ov-playing">Trying the overlay</span>}
        <span className="ov-spacer" />
        <span className="ov-back">
          <Keys accelerator={openKey} /> or Esc to go back
          {state.preview ? '' : ' to the game'}
        </span>
        <button
          type="button"
          className="ov-round"
          aria-label="Close overlay"
          title="Close"
          onClick={() => api.close()}
        >
          <Icon name="close" />
        </button>
      </header>

      <div className="ov-columns">
        <section className="ov-panel ov-panel--voice" aria-label="Voice">
          {voice ? (
            <>
              <div className="ov-panel-head">
                <span className="ov-panel-title">{voice.title}</span>
                <span className="ov-panel-sub">
                  {voice.kind === 'nebula'
                    ? 'Voice nebula'
                    : voice.kind === 'group'
                      ? 'Group call'
                      : 'Call'}
                </span>
              </div>
              <div className="ov-voice-list">
                {voice.people.map((p) => (
                  <div key={p.id} className="ov-voice-row">
                    <span
                      className={p.speaking && !p.muted ? 'ov-face ov-face--talking' : 'ov-face'}
                    >
                      <Avatar
                        id={p.id}
                        name={p.displayName}
                        avatarVersion={p.avatarVersion}
                        size={36}
                        mine={p.me}
                      />
                    </span>
                    <span className="ov-voice-row-text">
                      <span>{p.me ? `${p.displayName} (you)` : p.displayName}</span>
                      <span className="ov-voice-row-sub">
                        {p.muted
                          ? 'Muted'
                          : p.speaking
                            ? 'Talking'
                            : voice.connected
                              ? 'In call'
                              : 'Ringing…'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="ov-voice-buttons">
                <button
                  type="button"
                  className={voice.micOn ? 'ov-btn' : 'ov-btn ov-btn--off'}
                  aria-label={voice.micOn ? 'Mute' : 'Unmute'}
                  title={voice.micOn ? 'Mute' : 'Unmute'}
                  aria-pressed={!voice.micOn}
                  disabled={!voice.connected}
                  onClick={() => api.command({ cmd: 'mute' })}
                >
                  <Icon name={voice.micOn ? 'mic' : 'micOff'} size={20} />
                </button>
                <button
                  type="button"
                  className="ov-btn"
                  aria-label="Share this game"
                  title={state.game ? `Share ${state.game}` : 'Start a game to share it'}
                  disabled={!voice.connected || !state.game || voice.sharing}
                  onClick={() => api.command({ cmd: 'share-game' })}
                >
                  <Icon name="screen" size={20} />
                </button>
                <button
                  type="button"
                  className="ov-btn ov-btn--leave"
                  aria-label="Leave call"
                  title="Leave call"
                  onClick={() => api.command({ cmd: 'leave' })}
                >
                  <Icon name="leave" size={20} />
                </button>
              </div>
              {voice.sharing && <p className="ov-note">You&apos;re sharing your screen.</p>}
            </>
          ) : (
            <div className="ov-empty">
              <Icon name="voice" size={26} />
              <p>You&apos;re not in a call. Calls you join show here while you play.</p>
            </div>
          )}
        </section>

        <section
          className="ov-panel ov-panel--chat"
          aria-label={chat ? `Chat: ${chatTitle(chat)}` : 'Chat'}
        >
          {chat ? (
            <>
              <div className="ov-chat-head">
                <Avatar
                  id={chat.kind === 'dm' ? chat.partner.id : chat.id}
                  name={chatTitle(chat)}
                  avatarVersion={chat.kind === 'dm' ? chat.partner.avatarVersion : null}
                  size={38}
                />
                <span className="ov-panel-title">{chatTitle(chat)}</span>
                <span className="ov-spacer" />
                <button
                  type="button"
                  className={pinned === chat.id ? 'ov-square ov-square--on' : 'ov-square'}
                  aria-pressed={pinned === chat.id}
                  aria-label={pinned === chat.id ? 'Unpin from the game' : 'Keep on screen in game'}
                  title={
                    pinned === chat.id
                      ? 'Pinned: stays on screen in game'
                      : 'Keep on screen in game'
                  }
                  onClick={() =>
                    void api
                      .set({ pinnedChat: pinned === chat.id ? null : chat.id })
                      .then((i) => i && setInfo(i))
                  }
                >
                  <Icon name="pin" size={16} />
                </button>
              </div>
              <div className="ov-messages" ref={listRef}>
                {!shown && <p className="ov-note">Loading…</p>}
                {shown?.length === 0 && <p className="ov-note">Say hello!</p>}
                {shown
                  ?.filter((m) => !m.event)
                  .map((m, i, list) => {
                    const mine = m.senderId === me?.id
                    const showName =
                      chat.kind === 'group' && !mine && list[i - 1]?.senderId !== m.senderId
                    return (
                      <div key={m.id} className={mine ? 'ov-msg ov-msg--mine' : 'ov-msg'}>
                        {showName && <span className="ov-msg-name">{nameOf(m.senderId)}</span>}
                        <span className={m.deleted ? 'ov-bubble ov-bubble--deleted' : 'ov-bubble'}>
                          <EmojiText text={preview(m)} />
                        </span>
                      </div>
                    )
                  })}
              </div>
              <form
                className="ov-compose"
                onSubmit={(e) => {
                  e.preventDefault()
                  void send()
                }}
              >
                <label htmlFor="ov-draft" className="ov-sr">
                  Message {chatTitle(chat)}
                </label>
                <input
                  id="ov-draft"
                  ref={inputRef}
                  value={draft}
                  maxLength={4000}
                  autoComplete="off"
                  disabled={!chat.canMessage}
                  placeholder={
                    chat.canMessage ? `Message ${chatTitle(chat)}` : "You can't message this chat"
                  }
                  onChange={(e) => {
                    setDraft(e.target.value)
                    if (selected) window.glofly.conversations.typing(selected)
                  }}
                />
                <button
                  type="submit"
                  className="ov-send"
                  aria-label="Send"
                  disabled={!draft.trim() || sending || !chat.canMessage}
                >
                  <Icon name="send" />
                </button>
              </form>
            </>
          ) : (
            <div className="ov-empty">
              <p>{chats.length ? 'Pick a chat.' : 'Loading your chats…'}</p>
            </div>
          )}
        </section>

        <section className="ov-panel ov-panel--list" aria-label="Your chats">
          <h2 className="ov-label">Chats</h2>
          <div className="ov-chat-list">
            {chats.slice(0, 12).map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === selected ? 'ov-chat ov-chat--on' : 'ov-chat'}
                aria-current={c.id === selected ? 'true' : undefined}
                onClick={() => setSelected(c.id)}
              >
                <Avatar
                  id={c.kind === 'dm' ? c.partner.id : c.id}
                  name={chatTitle(c)}
                  avatarVersion={c.kind === 'dm' ? c.partner.avatarVersion : null}
                  size={34}
                />
                <span className="ov-chat-text">
                  <span className="ov-chat-name">{chatTitle(c)}</span>
                  <span className="ov-chat-last">
                    {c.lastMessage ? (
                      <EmojiText text={preview(c.lastMessage)} />
                    ) : (
                      'No messages yet'
                    )}
                  </span>
                </span>
                {c.unreadCount > 0 && c.id !== selected && (
                  <span className="ov-badge">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          {playingNow.length > 0 && (
            <>
              <h2 className="ov-label">Friends playing now</h2>
              {playingNow.slice(0, 6).map((f) => (
                <div key={f.id} className="ov-friend">
                  <Avatar
                    id={f.id}
                    name={f.displayName}
                    avatarVersion={f.avatarVersion}
                    size={34}
                  />
                  <span className="ov-chat-text">
                    <span className="ov-chat-name">{f.displayName}</span>
                    <span className="ov-friend-game">Playing {f.presence?.activity?.name}</span>
                  </span>
                  <button
                    type="button"
                    className="ov-small"
                    onClick={() =>
                      void window.glofly.conversations.openDm(f.id).then((r) => {
                        if (!r.ok) return
                        const summary = r.data
                        setChats((l) => (l.some((x) => x.id === summary.id) ? l : [summary, ...l]))
                        setSelected(summary.id)
                      })
                    }
                  >
                    Message
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
      {toastList}
    </div>
  )
}
