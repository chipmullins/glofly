import { useEffect, useRef, useState } from 'react'
import type { BuiltMap, MapLayer, Token } from '@glofly/shared/campfire/types'
import { pieceHidden } from '@glofly/shared/campfire/map'
import { MATERIALS, OBJECTS } from './geometry'
import { Icon } from './icons'
import { describe, listOf, mapPieces, omit, PIECE_KINDS, type PieceRef } from './pieces'

// 0.11.2 (game masters, at the table): what the map builder hid from players, and one click to
// show it when the party gets there: a whole layer, one piece, or everything. Players never
// receive hidden pieces (the server leaves them out), so showing one sends it to them.

const label = (k: string): string =>
  OBJECTS.find((o) => o.kind === k)?.label ?? MATERIALS.find((m) => m.id === k)?.label ?? k

export default function HiddenMenu({
  built,
  onSave,
  tokens = [],
  onShowTokens,
  onHideToken,
  isParty
}: {
  built: BuiltMap
  onSave: (built: BuiltMap) => void
  /** 0.11.3: tokens on this scene (hidden ones are listed; "Hide" for the selected one) */
  tokens?: Token[]
  onShowTokens?: (ids: string[]) => void
  onHideToken?: (id: string) => void
  /** Player characters aren't offered under "Hide a creature" */
  isParty?: (t: Token) => boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  const layers: MapLayer[] = built.layers ?? []
  // Pieces hidden on their own (a hidden layer's pieces are listed under the layer).
  const pieces: (PieceRef & { name: string })[] = PIECE_KINDS.filter((k) => k !== 'notes').flatMap(
    (k) =>
      listOf(built, k)
        .filter((p) => p.hidden)
        .map((p) => ({ kind: k, id: p.id, name: describe(p, k, label) }))
  )
  const hiddenLayers = layers.filter((l) => l.hidden)
  const total = PIECE_KINDS.filter((k) => k !== 'notes').reduce(
    (n, k) => n + listOf(built, k).filter((p) => pieceHidden(p, layers)).length,
    0
  )
  // 0.11.3 (Chip: "hiding and unhiding monsters… easier to find"): creatures on the GM layer.
  const hiddenTokens = tokens.filter((x) => x.layer === 'gm')
  const shownTokens = tokens.filter((x) => x.layer === 'tokens' && !isParty?.(x))
  const count = total + hiddenTokens.length

  const setLayer = (id: string, hidden: boolean): void =>
    onSave({
      ...built,
      layers: layers.map((l) => {
        if (l.id !== id) return l
        const rest = omit(l, 'hidden')
        return hidden ? { ...rest, hidden: true } : rest
      })
    })
  const reveal = (refs: PieceRef[]): void =>
    onSave(
      mapPieces(built, refs, (p) => {
        const rest = omit(p, 'hidden')
        return rest
      })
    )
  const revealAll = (): void => {
    const shown = mapPieces(built, pieces, (p) => {
      const rest = omit(p, 'hidden')
      return rest
    })
    onSave({ ...shown, ...(layers.length ? { layers: layers.map((l) => omit(l, 'hidden')) } : {}) })
  }

  return (
    <div className="cf-hidden-menu" ref={box}>
      <button
        type="button"
        className={count ? 'cf-ghost cf-ghost--warn' : 'cf-ghost'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="eyeOff" size={16} />
        {count ? `Hidden · ${count}` : 'Hide & show'}
      </button>
      {open && (
        <div className="cf-hidden-pop" role="dialog" aria-label="Hidden from players">
          <h3 className="cf-h3">Hidden from players</h3>
          {!count && (
            <p className="cf-hint">
              Players see every creature and the whole map that isn’t under fog.
            </p>
          )}
          <h4 className="cf-hidden-sub">Creatures</h4>
          {hiddenTokens.length > 0 ? (
            <ul className="cf-hidden-list" aria-label="Hidden creatures">
              {hiddenTokens.slice(0, 60).map((x) => (
                <li key={x.id}>
                  <span className="cf-hidden-name">
                    <strong>{x.name || 'Token'}</strong>
                    <span className="cf-sub">Hidden</span>
                  </span>
                  <button
                    type="button"
                    className="cf-primary cf-small"
                    onClick={() => onShowTokens?.([x.id])}
                  >
                    Show
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cf-hint">No hidden creatures.</p>
          )}
          {hiddenTokens.length > 1 && (
            <button
              type="button"
              className="cf-ghost cf-small cf-hidden-all"
              onClick={() => onShowTokens?.(hiddenTokens.map((x) => x.id))}
            >
              Show all creatures
            </button>
          )}
          {shownTokens.length > 0 && onHideToken && (
            <details className="cf-hidden-more">
              <summary>Hide a creature</summary>
              <ul className="cf-hidden-list">
                {shownTokens.slice(0, 60).map((x) => (
                  <li key={x.id}>
                    <span className="cf-hidden-name">
                      <strong>{x.name || 'Token'}</strong>
                    </span>
                    <button
                      type="button"
                      className="cf-ghost cf-small"
                      onClick={() => onHideToken(x.id)}
                    >
                      Hide
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {(layers.length > 0 || pieces.length > 0) && <h4 className="cf-hidden-sub">Map</h4>}
          {layers.length > 0 && (
            <ul className="cf-hidden-list" aria-label="Layers">
              {layers.map((l) => (
                <li key={l.id}>
                  <span className="cf-hidden-name">
                    <strong>{l.name}</strong>
                    <span className="cf-sub">Layer</span>
                  </span>
                  <button
                    type="button"
                    className={l.hidden ? 'cf-primary cf-small' : 'cf-ghost cf-small'}
                    onClick={() => setLayer(l.id, !l.hidden)}
                  >
                    {l.hidden ? 'Show to players' : 'Hide'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pieces.length > 0 && (
            <ul className="cf-hidden-list" aria-label="Hidden pieces">
              {pieces.slice(0, 60).map((p) => (
                <li key={`${p.kind}:${p.id}`}>
                  <span className="cf-hidden-name">
                    <strong>{p.name}</strong>
                  </span>
                  <button type="button" className="cf-primary cf-small" onClick={() => reveal([p])}>
                    Show
                  </button>
                </li>
              ))}
              {pieces.length > 60 && (
                <li className="cf-sub">
                  and {pieces.length - 60} more (Map builder lists them all)
                </li>
              )}
            </ul>
          )}
          {(pieces.length > 0 || hiddenLayers.length > 0) && (
            <button type="button" className="cf-ghost cf-small cf-hidden-all" onClick={revealAll}>
              Show everything
            </button>
          )}
          <p className="cf-hint cf-hidden-foot">
            Hidden things show faded for you. To hide a creature: its card’s eye button, or select
            it and press H. Map pieces: Map builder (select, then H).
          </p>
        </div>
      )}
    </div>
  )
}
