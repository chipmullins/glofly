import { useEffect, useState } from 'react'
import { cfxConnectUrl, cfxJoinPage } from '@glofly/shared/games'
import type { CfxServerCard } from '@glofly/shared/games'
import { api } from '../lib/constellations'
import '../constellations/InviteCard.css'

// Communities round (FiveM/RedM quick wins): a cfx.re/join/<code> link becomes a card. With the
// server lookup on (CFX_SERVER_LOOKUP on the Glofly server) it shows the server's name, players and
// game, and Join opens FiveM/RedM straight into it; otherwise it opens Cfx.re's own join page.

const cache = new Map<string, CfxServerCard>()

export default function CfxCard({ code }: { code: string }): React.JSX.Element {
  const [card, setCard] = useState<CfxServerCard | null>(cache.get(code) ?? null)
  useEffect(() => {
    if (cache.has(code)) return
    let live = true
    void api.cfxCard(code).then((r) => {
      const next: CfxServerCard = r.ok ? r.data : { code, lookup: false }
      cache.set(code, next)
      if (live) setCard(next)
    })
    return () => {
      live = false
    }
  }, [code])
  if (!card) return <div className="cx-ic-card cx-ic-card--loading" aria-hidden="true" />
  const game = card.game === 'redm' ? 'RedM' : 'FiveM'
  const open = (url: string): void => void window.open(url, '_blank', 'noopener')
  if (card.lookup && !card.found) {
    return (
      <div className="cx-ic-card cx-ic-card--dead" role="note">
        <span className="cx-ic-kicker">Cfx.re server</span>
        <span className="cx-ic-dead">This server isn&apos;t online right now.</span>
      </div>
    )
  }
  return (
    <div className="cx-ic">
      <div className="cx-ic-card cx-cfx-card">
        <div className="cx-ic-body">
          <span className={card.game === 'redm' ? 'cx-cfx-mark cx-cfx-mark--redm' : 'cx-cfx-mark'} aria-hidden="true">
            {card.lookup ? game.slice(0, 1) : 'Cfx'}
          </span>
          <div className="cx-ic-text">
            <span className="cx-ic-kicker">{card.lookup ? `${game} server` : 'FiveM / RedM server'}</span>
            <span className="cx-ic-name">{card.name ?? `cfx.re/join/${code}`}</span>
            {card.lookup && card.players !== undefined ? (
              <span className="cx-ic-counts">
                <span className="cx-ic-dot" aria-hidden="true" />
                {card.players}
                {card.maxPlayers !== undefined ? ` / ${card.maxPlayers}` : ''} playing
              </span>
            ) : (
              <span className="cx-ic-counts">Opens in FiveM or RedM</span>
            )}
          </div>
          <button
            type="button"
            className="cx-ic-join"
            onClick={() => open(card.lookup && card.game ? cfxConnectUrl(code, card.game) : cfxJoinPage(code))}
          >
            {card.lookup ? 'Join' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  )
}
