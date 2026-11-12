import { useEffect, useRef, useState } from 'react'
import type { BuiltMap, MapLayer } from '@glofly/shared/campfire/types'
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
  onSave
}: {
  built: BuiltMap
  onSave: (built: BuiltMap) => void
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
  if (!layers.length && !pieces.length) return null

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
        className={total ? 'cf-ghost cf-ghost--warn' : 'cf-ghost'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="eyeOff" size={16} />
        {total ? `Hidden · ${total}` : 'Layers'}
      </button>
      {open && (
        <div className="cf-hidden-pop" role="dialog" aria-label="Hidden from players">
          <h3 className="cf-h3">Hidden from players</h3>
          {!total && <p className="cf-hint">Players see the whole map that isn’t under fog.</p>}
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
            Hidden pieces show faded with a dashed outline for you. Hide more in the Map builder
            (select, then H).
          </p>
        </div>
      )}
    </div>
  )
}
