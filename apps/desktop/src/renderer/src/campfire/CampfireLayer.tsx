import { useEffect, useState } from 'react'
import type { SignedInUser } from '../../../preload/api-types'
import type {
  Campaign,
  CampaignCharacterCard,
  CampaignSummary
} from '@glofly/shared/campfire/types'
import { SRD_CREDIT } from '@glofly/shared/campfire/types'
import { dayLabel } from '../lib/time'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { closeCampfire, dismissLit, openCampfire, useCampfireOpen, useLitTables } from './store'
import Table from './Table'
import { FlameIcon } from './icons'
import './campfire.css'

// Campfire's own full layer over Glofly (above Constellations' night side): the Start board
// (pick a campaign or start one) and then the table. Plus the "Campfire is lit · Join" banner.

export default function CampfireLayer({ me }: { me: SignedInUser }): React.JSX.Element | null {
  const open = useCampfireOpen()
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  // Opened again (from a call, a header or the banner): start where that asks.
  const [openedFor, setOpenedFor] = useState(open)
  if (openedFor !== open) {
    setOpenedFor(open)
    setCampaignId(open?.campaignId ?? null)
  }
  // Escape closes the picker (the table has its own Leave button).
  useEffect(() => {
    if (!open || campaignId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeCampfire()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, campaignId])
  if (!open) return null
  return (
    <div className="cf-layer" role="dialog" aria-modal="true" aria-label="Campfire">
      {campaignId ? (
        <Table
          key={campaignId}
          campaignId={campaignId}
          me={me}
          callId={open.callId}
          placeName={open.placeName}
          setup={fresh === campaignId}
          onLeave={() => {
            if (open.campaignId) closeCampfire()
            else setCampaignId(null)
          }}
        />
      ) : open.home ? (
        <StartBoard
          onPick={(id, made) => {
            if (made) setFresh(id)
            setCampaignId(id)
          }}
        />
      ) : null}
    </div>
  )
}

function StartBoard({
  onPick
}: {
  onPick: (id: string, made?: boolean) => void
}): React.JSX.Element {
  const open = useCampfireOpen()!
  const [list, setList] = useState<CampaignSummary[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const home = open.home!

  useEffect(() => {
    void cf
      .get<{ campaigns: CampaignSummary[]; canCreate: boolean; why?: string | null }>(
        `/campfire/homes/${home.kind}/${home.id}/campaigns`
      )
      .then((r) => {
        if (!r.ok) return setError(r.message)
        setList(r.data.campaigns)
        setCanCreate(r.data.canCreate)
        setWhy(r.data.why ?? null)
      })
  }, [home.kind, home.id])

  const create = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    const r = await cf.post<Campaign>('/campfire/campaigns', { home, name: name.trim() })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    onPick(r.data.id, true)
  }

  return (
    <div className="cf-start">
      <section className="cf-start-card" aria-labelledby="cf-start-title">
        <div className="cf-start-head">
          <h1 id="cf-start-title">Start Campfire</h1>
          <button type="button" className="cf-x" aria-label="Close" onClick={closeCampfire}>
            ×
          </button>
        </div>
        <p className="cf-start-lead">
          Opens a shared table for everyone in this{' '}
          {home.kind === 'nebula' ? 'voice nebula' : 'group'}. Saved with the{' '}
          {home.kind === 'nebula' ? 'constellation' : 'group'}, so next week picks up where you left
          off.
        </p>
        {error && (
          <p className="cf-error" role="alert">
            {error}
          </p>
        )}
        {list === null && !error && <p className="cf-hint">Looking for campaigns…</p>}
        <ul className="cf-campaigns">
          {list?.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`cf-campaign${c.openInCallId ? ' cf-campaign--lit' : ''}`}
                onClick={() => onPick(c.id)}
              >
                <span className="cf-campaign-icon" aria-hidden="true">
                  {c.openInCallId ? <FlameIcon size={20} /> : <BookIcon />}
                </span>
                <span className="cf-campaign-text">
                  <strong>{c.name}</strong>
                  <span>
                    {c.openInCallId ? 'Lit now · ' : ''}Last played{' '}
                    {dayLabel(c.updatedAt).replace(/^(Today|Yesterday)$/, (s) => s.toLowerCase())} ·{' '}
                    {c.myRole === 'gm' ? 'you run it' : 'you play'}
                  </span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
        {canCreate &&
          (naming ? (
            <form
              className="cf-new-campaign"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <input
                autoFocus
                aria-label="Campaign name"
                placeholder="The Sunken Crypt"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="cf-primary" disabled={busy || !name.trim()}>
                Start it
              </button>
              <button type="button" className="cf-ghost" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="cf-campaign cf-campaign--new"
              onClick={() => setNaming(true)}
            >
              <span className="cf-campaign-icon" aria-hidden="true">
                +
              </span>
              <strong>New campaign</strong>
            </button>
          ))}
        {!canCreate && list && list.length === 0 && (
          <p className="cf-hint">{why ?? 'No campaigns here yet. A game master can start one.'}</p>
        )}
        {list && list.some((c) => c.myRole === 'player') && (
          <YourCharacters
            campaigns={list.filter((c) => c.myRole === 'player')}
            onChange={(id, card) =>
              setList((l) => l && l.map((c) => (c.id === id ? { ...c, myCharacter: card } : c)))
            }
            onPick={onPick}
            onError={setError}
          />
        )}
        <p className="cf-start-foot">
          {home.kind === 'nebula'
            ? 'Game masters: people with the "Run Campfire games" permission (or the Owner). '
            : 'Anyone in the group can start a campaign and run it. '}
          {SRD_CREDIT}
        </p>
      </section>
    </div>
  )
}

/** The Start board's "Your character": my character in each campaign I play, with its portrait. */
function YourCharacters({
  campaigns,
  onChange,
  onPick,
  onError
}: {
  campaigns: CampaignSummary[]
  onChange: (campaignId: string, card: CampaignCharacterCard) => void
  onPick: (id: string) => void
  onError: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const upload = async (c: CampaignSummary, card: CampaignCharacterCard): Promise<void> => {
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return
    setBusy(card.id)
    const up = await uploadFile(c.id, 'portrait', file)
    if (!up.ok) {
      setBusy(null)
      return onError(up.message)
    }
    const r = await cf.patch(`/campfire/characters/${card.id}`, { portraitFileId: up.data.id })
    setBusy(null)
    if (!r.ok) return onError(r.message)
    onChange(c.id, { ...card, portraitFileId: up.data.id })
  }
  return (
    <section className="cf-yours" aria-labelledby="cf-yours-title">
      <h3 id="cf-yours-title" className="cf-h3">
        Your character
      </h3>
      <ul className="cf-yours-list">
        {campaigns.map((c) => {
          const card = c.myCharacter
          return (
            <li key={c.id} className="cf-yours-row">
              {card ? (
                <>
                  <span className="cf-yours-face" aria-hidden="true">
                    {card.portraitFileId ? (
                      <img src={fileUrl(card.portraitFileId)} alt="" />
                    ) : (
                      (card.name.trim()[0] ?? '?').toUpperCase()
                    )}
                  </span>
                  <span className="cf-yours-text">
                    <strong>{card.name}</strong>
                    <span>
                      {card.line}
                      {campaigns.length > 1 ? ` · ${c.name}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="cf-ghost cf-small"
                    disabled={busy === card.id}
                    onClick={() => void upload(c, card)}
                  >
                    {busy === card.id
                      ? 'Uploading…'
                      : card.portraitFileId
                        ? 'Change portrait'
                        : 'Upload portrait'}
                  </button>
                </>
              ) : (
                <>
                  <span className="cf-yours-face cf-yours-face--empty" aria-hidden="true">
                    +
                  </span>
                  <span className="cf-yours-text">
                    <strong>No character yet</strong>
                    <span>
                      {campaigns.length > 1 ? `${c.name}: ` : ''}open the table and make one in the
                      Sheet tab.
                    </span>
                  </span>
                  <button type="button" className="cf-ghost cf-small" onClick={() => onPick(c.id)}>
                    Open the table
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BookIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="4" width="14" height="16" rx="3" />
      <path d="M5 12h14" />
    </svg>
  )
}

/** "Campfire is lit · Join" (Start board): a table was lit in a call I'm in. */
export function LitBanner(): React.JSX.Element | null {
  const lit = useLitTables()
  const open = useCampfireOpen()
  const shown = lit.filter((l) => open?.campaignId !== l.campaignId)
  if (!shown.length || open) return null
  const l = shown[shown.length - 1]
  return (
    <div className="cf-lit" role="status" aria-live="polite">
      <span className="cf-lit-icon" aria-hidden="true">
        <FlameIcon size={18} />
      </span>
      <span className="cf-lit-text">
        <strong>Campfire is lit</strong>
        <span>{l.name}</span>
      </span>
      <button
        type="button"
        className="cf-primary"
        onClick={() => openCampfire({ home: null, callId: l.callId, campaignId: l.campaignId })}
      >
        Join
      </button>
      <button
        type="button"
        className="cf-x"
        aria-label="Not now"
        onClick={() => dismissLit(l.campaignId)}
      >
        ×
      </button>
    </div>
  )
}
