import { useEffect, useState } from 'react'
import { accentOf } from '@glofly/shared/constellations'
import type { InvitePreview } from '@glofly/shared/constellations'
import { api } from '../lib/constellations'
import { ConstellationIcon } from './bits'
import { BannerArt } from './identity'
import './InviteCard.css'

// 0.7.5 Constellations polish, "Invite links that sell it" (the approved Invite board): a
// glofly.app/c/<code> link in a chat (DMs and groups too) becomes a card with the constellation's
// banner, icon, name and counts, and a Join button (Open once you're in it).

/** The invite code in a message (only real glofly.app/c/… links count). */
export function inviteCodeIn(text: string): string | null {
  const m = text.match(/(?:^|[\s(])(?:https?:\/\/)?(?:www\.)?glofly\.app\/c\/([A-Za-z0-9]{6,16})\b/)
  return m ? m[1] : null
}

type Looked = { ok: true; preview: InvitePreview } | { ok: false; hide: boolean }
/** Looked-up links, so a chat full of the same link asks once (kept a few minutes). */
const cache = new Map<string, { at: number; result: Promise<Looked> }>()

function lookUp(code: string, fresh = false): Promise<Looked> {
  const hit = cache.get(code)
  if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.result
  const result = api
    .linkPreview(code)
    .then((r): Looked =>
      r.ok
        ? { ok: true, preview: r.data }
        : // Only a dead link says so. Anything else (a family-managed account, which can't use
          // Constellations; no connection) shows no card, just the link.
          { ok: false, hide: r.error !== 'not_found' }
    )
  cache.set(code, { at: Date.now(), result })
  return result
}

/** "expires in 6 days", "expires today", or null for links that never run out. */
function expiresText(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `expires in ${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.max(1, Math.floor(ms / 3_600_000))
  return `expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export default function InviteCard({
  code,
  compact = false,
  onOpened,
  onProblem
}: {
  code: string
  /** Inside a dialog (no "Invite from" line under it) */
  compact?: boolean
  /** Joined or opened: show that constellation */
  onOpened?: (constellationId: string) => void
  onProblem?: (message: string) => void
}): React.JSX.Element | null {
  const [looked, setLooked] = useState<Looked | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void lookUp(code).then((r) => live && setLooked(r))
    return () => {
      live = false
    }
  }, [code])
  if (!looked) return <div className="cx-ic-card cx-ic-card--loading" aria-hidden="true" />
  if (!looked.ok) {
    if (looked.hide) return null
    return (
      <div className="cx-ic-card cx-ic-card--dead" role="note">
        <span className="cx-ic-kicker">Invite to a constellation</span>
        <span className="cx-ic-dead">This invite has expired or doesn&apos;t work any more.</span>
      </div>
    )
  }
  const { constellation: c, by, expiresAt } = looked.preview
  const a = accentOf(c)
  const open = (id: string): void => {
    window.dispatchEvent(new CustomEvent('glofly:cx-open', { detail: { constellationId: id } }))
    onOpened?.(id)
  }
  async function join(): Promise<void> {
    if (c.joined) {
      open(c.id)
      return
    }
    setBusy(true)
    const r = await api.joinLink(code)
    setBusy(false)
    if (!r.ok) {
      onProblem?.(r.message)
      void lookUp(code, true).then(setLooked)
      return
    }
    void lookUp(code, true)
    open(r.data.constellation.id)
  }
  const expires = expiresText(expiresAt)
  const from = by ? by.displayName.trim().split(/\s+/)[0] || by.username : null
  return (
    <div className="cx-ic">
      <div
        className="cx-ic-card"
        style={{ ['--cxa' as string]: a.color, ['--cxa-on' as string]: a.on, ['--cxa-rgb' as string]: a.rgb }}
      >
        <div className="cx-ic-banner">
          <BannerArt c={c} width={380} height={76} />
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            className="cx-ic-icon"
            style={c.iconVersion ? undefined : { background: '#120c0a', color: a.color }}
          />
        </div>
        <div className="cx-ic-body">
          <div className="cx-ic-text">
            <span className="cx-ic-kicker">Invite to a constellation</span>
            <span className="cx-ic-name">{c.name}</span>
            <span className="cx-ic-counts">
              <span className="cx-ic-dot" aria-hidden="true" />
              {c.onlineCount} online now · {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
            </span>
          </div>
          <button type="button" className="cx-ic-join" disabled={busy} onClick={() => void join()}>
            {c.joined ? 'Open' : busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
      {!compact && (from || expires) && (
        <div className="cx-ic-from">
          {[from && `Invite from ${from}`, expires].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  )
}
