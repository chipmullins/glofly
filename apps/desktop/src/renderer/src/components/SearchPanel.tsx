import { useEffect, useRef, useState } from 'react'
import type {
  ConversationSummary,
  Message,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { chatTitle } from '../lib/groups'
import { dayLabel, clockTime } from '../lib/time'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { CloseIcon, SearchIcon } from './icons'
import './SearchPanel.css'

/** The part of a long message around the match, with the match marked. */
function snippet(text: string, query: string): { before: string; match: string; after: string } {
  const flat = text.replace(/\s+/g, ' ')
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase())
  if (at < 0) return { before: flat.slice(0, 140), match: '', after: '' }
  const start = Math.max(0, at - 50)
  const end = Math.min(flat.length, at + query.trim().length + 90)
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, at + query.trim().length),
    after: flat.slice(at + query.trim().length, end) + (end < flat.length ? '…' : '')
  }
}

/**
 * Search messages: in the chat you're in (header button or Ctrl+F) or in all your chats
 * (from the sidebar search). Newest first; clicking a result opens the chat at that message.
 */
export default function SearchPanel({
  me,
  conversations,
  chatId,
  initialQuery,
  onOpen,
  onClose
}: {
  me: SignedInUser
  conversations: ConversationSummary[]
  /** Search only this chat, or null for all chats */
  chatId: string | null
  initialQuery: string
  onOpen: (conversationId: string, messageId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [scope, setScope] = useState<string | null>(chatId)
  const [results, setResults] = useState<Message[]>([])
  const [people, setPeople] = useState<Record<string, PublicUser>>({})
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const searchId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [scope])

  // A new chat to search (header button in another chat) switches the panel to it.
  const [scopeFor, setScopeFor] = useState(chatId)
  if (scopeFor !== chatId) {
    setScopeFor(chatId)
    setScope(chatId)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const remember = (list: PublicUser[]): void =>
    setPeople((map) => ({ ...map, ...Object.fromEntries(list.map((p) => [p.id, p])) }))

  // Search as you type (after a short pause).
  useEffect(() => {
    const q = query.trim()
    const id = ++searchId.current
    if (q.length < 2) {
      const reset = setTimeout(() => {
        setResults([])
        setHasMore(false)
        setState('idle')
      }, 0)
      return () => clearTimeout(reset)
    }
    const timer = setTimeout(async () => {
      setState('searching')
      const result = await window.glofly.conversations.search(q, scope ?? undefined)
      if (id !== searchId.current) return // a newer search started
      if (!result.ok) {
        setState('error')
        setError(result.message || "Couldn't search right now.")
        return
      }
      remember(result.data.people)
      setResults(result.data.results)
      setHasMore(result.data.hasMore)
      setState('done')
    }, 300)
    return () => clearTimeout(timer)
  }, [query, scope])

  async function more(): Promise<void> {
    const last = results.at(-1)
    if (!last) return
    const id = searchId.current
    const result = await window.glofly.conversations.search(
      query.trim(),
      scope ?? undefined,
      last.id
    )
    if (id !== searchId.current || !result.ok) return
    remember(result.data.people)
    setResults((list) => [
      ...list,
      ...result.data.results.filter((m) => !list.some((x) => x.id === m.id))
    ])
    setHasMore(result.data.hasMore)
  }

  const chatOf = (id: string): ConversationSummary | undefined =>
    conversations.find((c) => c.id === id)
  const scopeChat = chatId ? chatOf(chatId) : undefined
  const nameOf = (id: string): string =>
    id === me.id ? 'You' : (people[id]?.displayName ?? 'Someone')

  return (
    <aside className="search-panel" aria-label="Search messages">
      <div className="search-panel-head">
        <h2>Search messages</h2>
        <button
          type="button"
          className="search-panel-close"
          aria-label="Close search"
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </button>
      </div>

      <div className="search-panel-box">
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          id="message-search"
          type="search"
          value={query}
          placeholder={
            scope ? `Search ${scopeChat ? chatTitle(scopeChat) : 'this chat'}` : 'Search all chats'
          }
          aria-label="Search messages"
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {scopeChat && (
        <div className="search-panel-scope" role="radiogroup" aria-label="Where to search">
          <button
            type="button"
            role="radio"
            aria-checked={scope === chatId}
            className={scope === chatId ? 'search-scope search-scope--on' : 'search-scope'}
            onClick={() => setScope(chatId)}
          >
            This chat
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === null}
            className={scope === null ? 'search-scope search-scope--on' : 'search-scope'}
            onClick={() => setScope(null)}
          >
            All chats
          </button>
        </div>
      )}

      <div className="search-panel-results" aria-live="polite">
        {state === 'idle' && (
          <p className="search-panel-note">
            Type at least 2 characters. Search finds words anywhere in a message.
          </p>
        )}
        {state === 'searching' && results.length === 0 && (
          <p className="search-panel-note">Searching…</p>
        )}
        {state === 'error' && <p className="search-panel-note search-panel-note--error">{error}</p>}
        {state === 'done' && results.length === 0 && (
          <p className="search-panel-note">No messages found for “{query.trim()}”.</p>
        )}
        {results.map((m) => {
          const chat = chatOf(m.conversationId)
          const sender = people[m.senderId]
          const part = snippet(m.body, query)
          return (
            <button
              key={m.id}
              type="button"
              className="search-result"
              onClick={() => onOpen(m.conversationId, m.id)}
            >
              {sender ? (
                <Avatar
                  id={sender.id}
                  name={sender.displayName}
                  avatarVersion={sender.avatarVersion}
                  size={32}
                />
              ) : (
                <span className="search-result-avatar" aria-hidden="true" />
              )}
              <span className="search-result-text">
                <span className="search-result-meta">
                  <strong>{nameOf(m.senderId)}</strong>
                  {!scope && chat && (
                    <span className="search-result-chat">
                      in <EmojiText text={chatTitle(chat)} />
                    </span>
                  )}
                  <span className="search-result-time">
                    {dayLabel(m.createdAt)} · {clockTime(m.createdAt)}
                  </span>
                </span>
                <span className="search-result-body">
                  <EmojiText text={part.before} />
                  {part.match && (
                    <mark>
                      <EmojiText text={part.match} />
                    </mark>
                  )}
                  <EmojiText text={part.after} />
                </span>
              </span>
            </button>
          )
        })}
        {hasMore && (
          <button
            type="button"
            className="small-button small-button--quiet search-more"
            onClick={() => void more()}
          >
            Show more
          </button>
        )}
      </div>
    </aside>
  )
}
