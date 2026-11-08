import { useState } from 'react'
import { alertSiteName, type LinkPreview, type LiveCard } from '@glofly/shared'
import { previewImageUrl } from '../lib/attachments'
import EmojiText from '../components/EmojiText'
import './LiveAlertCard.css'
import {
  isCardUrl,
  useVoiceName,
  WATCH_TOGETHER_EVENT,
  type WatchTogetherDetail
} from './liveAlertBits'

// 0.9.3 a constellation's Live alert in a nebula (approved board 5): the site, the stream's
// picture with LIVE, its title, the game and viewers, "Watch together in <voice nebula>" and
// "Open on Twitch". The picture is the server's copy (the message's link preview); apps never
// load anything from Twitch, Kick or YouTube themselves.

const SITE_COLOR: Record<LiveCard['site'], string> = {
  twitch: '#6f3fd1',
  kick: '#1f7a3a',
  youtube: '#c4302b'
}
const SITE_SHORT: Record<LiveCard['site'], string> = { twitch: 'TW', kick: 'KI', youtube: 'YT' }

export default function LiveAlertCard({
  card,
  preview,
  conversationId,
  messageId
}: {
  card: LiveCard
  preview: LinkPreview | null | undefined
  conversationId: string
  messageId: string
}): React.JSX.Element {
  // The voice nebula's name for "Watch together in …" (null: it's gone, or none was set)
  const voiceName = useVoiceName(card.watchNebulaId)
  const [imageOk, setImageOk] = useState(true)
  const site = alertSiteName(card.site)
  const ok = isCardUrl(card)
  const facts = [
    card.game,
    card.viewers !== null ? `${card.viewers.toLocaleString()} watching` : null
  ]
    .filter(Boolean)
    .join(' · ')
  const watch = (): void => {
    if (!ok) return
    window.dispatchEvent(
      new CustomEvent<WatchTogetherDetail>(WATCH_TOGETHER_EVENT, {
        detail: { url: card.url, watchNebulaId: card.watchNebulaId }
      })
    )
  }
  return (
    <div className="lac">
      <div className="lac-head">
        <span className="lac-site" style={{ background: SITE_COLOR[card.site] }} aria-hidden="true">
          {SITE_SHORT[card.site]}
        </span>
        <span className="lac-channel">
          <EmojiText text={card.channelName} /> on {site}
        </span>
      </div>
      <div className="lac-picture">
        {preview?.image && imageOk ? (
          <img
            src={previewImageUrl(conversationId, messageId)}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setImageOk(false)}
          />
        ) : (
          <span
            className="lac-glow"
            style={{ background: `linear-gradient(135deg, ${SITE_COLOR[card.site]}, #1c1210)` }}
          />
        )}
        <span className="lac-tag">{card.kind === 'live' ? 'LIVE' : 'NEW VIDEO'}</span>
      </div>
      <div className="lac-body">
        <b className="lac-title">
          <EmojiText
            text={
              card.title || (card.kind === 'live' ? `${card.channelName} is live` : 'New video')
            }
          />
        </b>
        {facts && <span className="lac-facts">{facts}</span>}
        <div className="lac-buttons">
          {card.kind === 'live' && voiceName && ok && (
            <button type="button" className="lac-btn lac-btn--main" onClick={watch}>
              Watch together in {voiceName}
            </button>
          )}
          {card.kind === 'video' && ok && (
            <button
              type="button"
              className="lac-btn lac-btn--main"
              onClick={watch}
              title="Plays it for everyone in your call or voice nebula"
            >
              Watch together
            </button>
          )}
          {ok && (
            <a className="lac-btn" href={card.url} target="_blank" rel="noopener noreferrer">
              Open on {site}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
