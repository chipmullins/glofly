import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BuiltMap,
  BuiltObject,
  DoorState,
  GridSettings,
  MapLayer,
  MapTheme,
  Point,
  Scene,
  Token
} from '@glofly/shared/campfire/types'
import { CAMPFIRE_LIMITS, MAP_THEMES } from '@glofly/shared/campfire/types'
import { pieceHidden, shownToPlayers } from '@glofly/shared/campfire/map'
import {
  boxOf,
  copyPieces,
  existing,
  findPiece,
  hasRef,
  mapPieces,
  moveDelta,
  omit,
  pastePieces,
  piecesIn,
  resizedBox,
  resizePiece,
  translate,
  type Box,
  type Handle,
  type PieceRef
} from './pieces'
import BuiltLayer, { BuiltDefs, ObjectShape, type BuiltLayers } from './BuiltLayer'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, pieceId, uploadFile } from './api'
import { useCf } from './ctx'
import { hexPattern, MATERIALS, OBJECTS, Pinch, snapCorner, THEMES, usePanZoom } from './geometry'
import { Icon } from './icons'
import { usePlaceHidden } from './place'

// The map builder (Builder board, GMs only): rooms (drag corner to corner, or Shift for a free
// shape) with floor materials, walls with doors, objects dragged from the palette, GM notes,
// layers, undo/redo, grid settings, preview as a player, scenes, start fogged, a map picture.

type BTool = 'select' | 'room' | 'wall' | 'paint' | 'terrain' | 'note' | 'erase'
type Sel = PieceRef | null

type Draft = {
  name: string
  grid: GridSettings
  theme: MapTheme
  widthPx: number
  heightPx: number
  backgroundFileId: string | null
  musicTrackId: string | null
  built: BuiltMap
}

const draftOf = (s: Scene): Draft => ({
  name: s.name,
  grid: s.grid,
  theme: s.theme,
  widthPx: s.widthPx,
  heightPx: s.heightPx,
  backgroundFileId: s.backgroundFileId,
  musicTrackId: s.musicTrackId,
  built: s.built
})

export default function Builder({
  sceneId,
  onClose
}: {
  sceneId: string | null
  onClose: () => void
}): React.JSX.Element {
  const { t, say, ctl, message } = useCf()
  const [editing, setEditing] = useState<string | null>(
    sceneId ?? t.scene?.id ?? t.scenes[0]?.id ?? null
  )
  const [scene, setScene] = useState<Scene | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [past, setPast] = useState<BuiltMap[]>([])
  const [future, setFuture] = useState<BuiltMap[]>([])
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<BTool>('room')
  const [material, setMaterial] = useState('stone')
  const [wallKind, setWallKind] = useState<'wall' | DoorState>('wall')
  const [terrainKind, setTerrainKind] = useState<'difficult' | 'water'>('difficult')
  const [layers, setLayers] = useState<BuiltLayers & { tokens: boolean }>({
    floor: true,
    walls: true,
    objects: true,
    notes: true,
    tokens: true
  })
  // 0.11.2: several pieces can be selected (Shift-click, or Shift-drag a box)
  const [sels, setSels] = useState<PieceRef[]>([])
  const sel: Sel = sels.length === 1 ? sels[0] : null
  const setSel = (s: Sel): void => setSels(s ? [s] : [])
  // 0.11.2: the map layer new pieces go on ('' = the base map)
  const [drawLayer, setDrawLayer] = useState('')
  const [preview, setPreview] = useState(false)
  const [startFogged, setStartFogged] = useState(false)
  const [hiddenMonsters, setHiddenMonsters] = usePlaceHidden()
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (id: string) => {
      const r = await cf.get<{ scene: Scene; tokens: Token[] }>(`/campfire/scenes/${id}`)
      if (!r.ok) return say(r.message)
      setScene(r.data.scene)
      setTokens(r.data.tokens)
      setDraft(draftOf(r.data.scene))
      setStartFogged(r.data.scene.fog.enabled)
      setPast([])
      setFuture([])
      setDirty(false)
      setSels([])
      setDrawLayer('')
    },
    [say]
  )

  useEffect(() => {
    // Loads the scene being edited (its answer sets the state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (editing) void load(editing)
  }, [editing, load])

  const newScene = async (): Promise<void> => {
    if (dirty && !window.confirm('Leave this scene without saving?')) return
    const r = await cf.post<Scene>(`/campfire/campaigns/${t.campaign.id}/scenes`, {
      name: `Scene ${t.scenes.length + 1}`,
      widthPx: 1400,
      heightPx: 980
    })
    if (!r.ok) return say(r.message)
    setEditing(r.data.id)
  }

  // ───── Changes, undo and redo ─────
  const change = (built: BuiltMap): void => {
    if (!draft) return
    setPast((p) => [...p.slice(-80), draft.built])
    setFuture([])
    setDraft({ ...draft, built })
    setDirty(true)
  }
  const setD = (patch: Partial<Draft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setDirty(true)
  }
  const undo = (): void => {
    if (!draft || !past.length) return
    setFuture((f) => [draft.built, ...f])
    setDraft({ ...draft, built: past[past.length - 1] })
    setPast((p) => p.slice(0, -1))
    setDirty(true)
  }
  const redo = (): void => {
    if (!draft || !future.length) return
    setPast((p) => [...p, draft.built])
    setDraft({ ...draft, built: future[0] })
    setFuture((f) => f.slice(1))
    setDirty(true)
  }
  const removeSel = (): void => {
    if (!draft || !sels.length) return
    change(mapPieces(draft.built, sels, () => null))
    setSels([])
  }
  // 0.11.2: copy, cut, paste and duplicate (Ctrl+C / X / V / D)
  const copySel = (): void => {
    if (!draft || !sels.length) return
    const n = copyPieces(draft.built, sels)
    say(n === 1 ? 'Copied. Ctrl+V pastes it.' : `Copied ${n} pieces. Ctrl+V pastes them.`)
  }
  const paste = (): void => {
    if (!draft) return
    const r = pastePieces(draft.built, draft.grid)
    if (!r) return say('Copy something first (select it, then Ctrl+C).')
    change(r.built)
    setSels(r.added)
  }
  // 0.11.2: hide from players / show to players (H)
  const setHidden = (hide: boolean): void => {
    if (!draft || !sels.length) return
    change(
      mapPieces(draft.built, sels, (p) => {
        const rest = omit(p, 'hidden')
        return hide ? { ...rest, hidden: true } : rest
      })
    )
  }
  const allHidden =
    !!draft && sels.length > 0 && sels.every((r) => !!findPiece(draft.built, r)?.hidden)
  const setLayerOf = (layer: string): void => {
    if (!draft || !sels.length) return
    change(
      mapPieces(draft.built, sels, (p) => {
        const rest = omit(p, 'layer')
        return layer ? { ...rest, layer } : rest
      })
    )
  }
  const mapLayers: MapLayer[] = draft?.built.layers ?? []
  const commonLayer = (() => {
    if (!draft || !sels.length) return ''
    const ls = new Set(sels.map((r) => findPiece(draft.built, r)?.layer ?? ''))
    return ls.size === 1 ? [...ls][0] : null
  })()
  const setMapLayers = (next: MapLayer[], built = draft?.built): void => {
    if (!built) return
    const rest = omit(built, 'layers')
    change(next.length ? { ...rest, layers: next } : (rest as BuiltMap))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if (typing) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (
        mod &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sels.length) {
        e.preventDefault()
        removeSel()
      } else if (mod && e.key.toLowerCase() === 'c' && sels.length) {
        e.preventDefault()
        copySel()
      } else if (mod && e.key.toLowerCase() === 'x' && sels.length) {
        e.preventDefault()
        copySel()
        removeSel()
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        paste()
      } else if (mod && e.key.toLowerCase() === 'd' && sels.length) {
        e.preventDefault()
        copySel()
        paste()
      } else if (mod && e.key.toLowerCase() === 'a' && draft) {
        e.preventDefault()
        setTool('select')
        setSels(piecesIn(draft.built, [-1e6, -1e6], [1e6, 1e6], layers.notes))
      } else if (!mod && e.key.toLowerCase() === 'h' && sels.length) {
        e.preventDefault()
        setHidden(!allHidden)
      } else if (e.key === 'Escape') {
        setSels([])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const save = async (): Promise<void> => {
    if (!draft || !scene) return
    setSaving(true)
    const r = await cf.patch<Scene>(`/campfire/scenes/${scene.id}`, {
      name: draft.name.trim() || scene.name,
      grid: draft.grid,
      theme: draft.theme,
      widthPx: draft.widthPx,
      heightPx: draft.heightPx,
      built: draft.built,
      backgroundFileId: draft.backgroundFileId,
      musicTrackId: draft.musicTrackId,
      ...(startFogged !== scene.fog.enabled
        ? { fog: startFogged ? { enabled: true, revealed: [] } : { enabled: false, revealed: [] } }
        : {})
    })
    setSaving(false)
    if (!r.ok) return say(r.message)
    setScene(r.data)
    setDirty(false)
    say('Scene saved.')
    if (t.scene?.id === r.data.id) ctl.update((s) => ({ ...s, scene: r.data }))
  }

  const close = (): void => {
    if (dirty && !window.confirm('Close the map builder without saving?')) return
    onClose()
  }

  const tools: { id: BTool; label: string; icon: string }[] = [
    { id: 'select', label: 'Select', icon: 'select' },
    { id: 'room', label: 'Draw a room', icon: 'room' },
    { id: 'wall', label: 'Draw walls', icon: 'wall' },
    { id: 'paint', label: 'Paint floor', icon: 'pen' },
    { id: 'terrain', label: 'Difficult terrain and water', icon: 'fog' },
    { id: 'note', label: 'GM note', icon: 'note' },
    { id: 'erase', label: 'Erase', icon: 'erase' }
  ]
  const hint: Record<BTool, string> = {
    select:
      'Selecting: click a piece and drag it; corner handles resize. Shift-click or Shift-drag picks several',
    room: 'Drawing a room: drag from corner to corner',
    wall: 'Drawing walls: drag along a wall (pick Door to draw a door)',
    paint: 'Painting floors: click a room to give it the material',
    terrain: 'Terrain: drag a box. Moving through it costs double (players see a soft hatch)',
    note: 'GM notes: click to pin a note only game masters see',
    erase: 'Erasing: click a piece to remove it'
  }

  const selObj =
    sel && draft ? (draft.built[sel.kind] as { id: string }[]).find((x) => x.id === sel.id) : null

  return (
    <div className="cf-table cf-builder">
      <header className="cf-head">
        <span className="cf-head-mark" aria-hidden="true">
          <Icon name="draw" size={20} />
        </span>
        <div className="cf-head-title">
          <h1>Map builder</h1>
          <span>
            {t.campaign.name} · Scene: {draft?.name ?? '…'} · only you can see this until you start
            the session
          </span>
        </div>
        <span className="cf-spacer" />
        <button
          type="button"
          className="cf-ghost"
          onClick={async () => {
            const file = await pickFile(IMAGE_ACCEPT)
            if (!file) return
            say('Uploading the map…')
            const up = await uploadFile(t.campaign.id, 'map', file)
            if (!up.ok) return say(up.message)
            setD({
              backgroundFileId: up.data.id,
              widthPx: Math.max(100, up.data.width ?? draft?.widthPx ?? 1400),
              heightPx: Math.max(100, up.data.height ?? draft?.heightPx ?? 1000)
            })
            say('Map picture added. Save the scene to keep it.')
          }}
        >
          Upload a map image
        </button>
        <button
          type="button"
          className={preview ? 'cf-ghost cf-ghost--on' : 'cf-ghost'}
          aria-pressed={preview}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? 'Back to editing' : 'Preview as a player'}
        </button>
        <button
          type="button"
          className="cf-primary"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : dirty ? 'Save scene' : 'Saved'}
        </button>
        <button type="button" className="cf-leave" onClick={close}>
          Back to the table
        </button>
      </header>
      <div className="cf-body">
        <aside className="cf-left cf-palette" aria-label="Builder tools">
          <div className="cf-btools" role="toolbar" aria-label="Builder tools">
            {tools.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-label={x.label}
                title={x.label}
                aria-pressed={tool === x.id}
                className={tool === x.id ? 'cf-rail-button cf-rail-button--on' : 'cf-rail-button'}
                onClick={() => setTool(x.id)}
              >
                <Icon name={x.icon} size={20} />
              </button>
            ))}
            <button
              type="button"
              className="cf-rail-button"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!past.length}
              onClick={undo}
            >
              <Icon name="undo" size={20} />
            </button>
            <button
              type="button"
              className="cf-rail-button"
              aria-label="Redo"
              title="Redo (Ctrl+Y)"
              disabled={!future.length}
              onClick={redo}
            >
              <Icon name="redo" size={20} />
            </button>
          </div>
          {tool === 'terrain' && (
            <div className="cf-seg" role="radiogroup" aria-label="Kind of terrain">
              {(
                [
                  ['difficult', 'Difficult terrain'],
                  ['water', 'Water']
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={terrainKind === v}
                  className={terrainKind === v ? 'cf-chip cf-chip--on' : 'cf-chip'}
                  onClick={() => setTerrainKind(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {tool === 'terrain' && (
            <p className="cf-hint">
              Moving through it costs 2 ft for every foot; tokens’ paths and rings count it.
            </p>
          )}
          {tool === 'wall' && (
            <div className="cf-seg" role="radiogroup" aria-label="Wall or door">
              {(
                [
                  ['wall', 'Wall'],
                  ['closed', 'Door'],
                  ['locked', 'Locked door'],
                  ['open', 'Open door']
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={wallKind === v}
                  className={wallKind === v ? 'cf-chip cf-chip--on' : 'cf-chip'}
                  onClick={() => setWallKind(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <h2 className="cf-h3">Floors</h2>
          <div className="cf-swatches" role="radiogroup" aria-label="Floor material">
            {MATERIALS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={material === m.id}
                className={
                  material === m.id ? 'cf-swatch-button cf-swatch-button--on' : 'cf-swatch-button'
                }
                onClick={() => {
                  setMaterial(m.id)
                  if (tool !== 'room' && tool !== 'paint') setTool('room')
                }}
              >
                <span style={{ background: m.fill }} />
                {m.label}
              </button>
            ))}
          </div>
          <h2 className="cf-h3">
            Objects <span className="cf-sub">drag onto the map</span>
          </h2>
          <div className="cf-objects">
            {OBJECTS.map((o) => (
              <button
                key={o.kind}
                type="button"
                className="cf-object-button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-campfire-object', o.kind)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => placeObject(o.kind, null)}
                title={`Drag ${o.label} onto the map (or click to put it in the middle)`}
              >
                <svg width="40" height="32" viewBox="-4 -4 48 40" aria-hidden="true">
                  <ObjectShape
                    o={{
                      id: 'p',
                      kind: o.kind,
                      x: 20 - (o.w * 20) / 2,
                      y: 16 - (o.h * 20) / 2,
                      w: o.w * 20,
                      h: o.h * 20,
                      rotation: 0
                    }}
                    grid={draft?.grid ?? ({ size: 20 } as GridSettings)}
                  />
                </svg>
                {o.label}
              </button>
            ))}
          </div>
        </aside>

        <main className="cf-main">
          <div className="cf-topbar">
            <span className="cf-turn-pill">{hint[tool]}</span>
            <span className="cf-sub">
              Snaps to the grid (hold Shift or Alt to place freely) · Ctrl+C / Ctrl+V copy · Ctrl+Z
              undo
            </span>
          </div>
          {message && (
            <div className="cf-builder-toast" role="status">
              {message}
            </div>
          )}
          {draft && scene ? (
            <BuilderMap
              draft={draft}
              tokens={layers.tokens ? tokens.filter((x) => !(preview && x.layer === 'gm')) : []}
              layers={layers}
              tool={preview ? 'select' : tool}
              material={material}
              wallKind={wallKind}
              terrainKind={terrainKind}
              sels={sels}
              setSels={setSels}
              drawLayer={drawLayer}
              change={change}
              preview={preview}
              fogged={startFogged}
              onDropObject={(kind, at) => placeObject(kind, at)}
            />
          ) : (
            <div className="cf-map cf-map--empty">
              {t.scenes.length === 0 ? (
                <button type="button" className="cf-primary" onClick={() => void newScene()}>
                  Make the first scene
                </button>
              ) : (
                <p className="cf-hint">Loading the scene…</p>
              )}
            </div>
          )}
        </main>

        <aside className="cf-side cf-builder-side" aria-label="Scene settings">
          <div className="cf-side-body">
            {draft && (
              <section className="cf-panel">
                <label className="cf-field">
                  <span>Scene name</span>
                  <input
                    value={draft.name}
                    maxLength={60}
                    onChange={(e) => setD({ name: e.target.value })}
                  />
                </label>
                {sels.length > 1 && (
                  <div className="cf-inspector">
                    <h3 className="cf-h3">{sels.length} pieces selected</h3>
                    <PieceActions
                      hidden={allHidden}
                      layer={commonLayer}
                      layers={mapLayers}
                      onHidden={setHidden}
                      onLayer={setLayerOf}
                      onCopy={copySel}
                      onDuplicate={() => {
                        copySel()
                        paste()
                      }}
                    />
                    <button type="button" className="cf-danger-ghost cf-small" onClick={removeSel}>
                      Remove {sels.length} pieces
                    </button>
                  </div>
                )}
                {sel && selObj && (
                  <div className="cf-inspector">
                    <h3 className="cf-h3">
                      Selected{' '}
                      {sel.kind === 'floors'
                        ? 'room'
                        : sel.kind === 'walls'
                          ? 'wall'
                          : sel.kind === 'notes'
                            ? 'note'
                            : sel.kind === 'terrain'
                              ? 'terrain'
                              : 'object'}
                    </h3>
                    <PieceActions
                      hidden={allHidden}
                      layer={commonLayer}
                      layers={mapLayers}
                      onHidden={setHidden}
                      onLayer={setLayerOf}
                      onCopy={copySel}
                      onDuplicate={() => {
                        copySel()
                        paste()
                      }}
                    />
                    {sel.kind === 'walls' && (
                      <label className="cf-field">
                        <span>Door</span>
                        <select
                          value={(selObj as BuiltMap['walls'][number]).door?.state ?? 'none'}
                          onChange={(e) =>
                            change({
                              ...draft.built,
                              walls: draft.built.walls.map((w) =>
                                w.id === sel.id
                                  ? e.target.value === 'none'
                                    ? { id: w.id, points: w.points }
                                    : { ...w, door: { state: e.target.value as DoorState } }
                                  : w
                              )
                            })
                          }
                        >
                          <option value="none">No door (a wall)</option>
                          <option value="closed">Closed door</option>
                          <option value="open">Open door</option>
                          <option value="locked">Locked door</option>
                        </select>
                      </label>
                    )}
                    {sel.kind === 'floors' && (
                      <label className="cf-field">
                        <span>Floor</span>
                        <select
                          value={(selObj as BuiltMap['floors'][number]).material}
                          onChange={(e) =>
                            change({
                              ...draft.built,
                              floors: draft.built.floors.map((f) =>
                                f.id === sel.id ? { ...f, material: e.target.value } : f
                              )
                            })
                          }
                        >
                          {MATERIALS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {sel.kind === 'objects' && (
                      <button
                        type="button"
                        className="cf-ghost cf-small"
                        onClick={() =>
                          change({
                            ...draft.built,
                            objects: draft.built.objects.map((o) =>
                              o.id === sel.id ? { ...o, rotation: (o.rotation + 90) % 360 } : o
                            )
                          })
                        }
                      >
                        Turn 90°
                      </button>
                    )}
                    {sel.kind === 'notes' && (
                      <label className="cf-field">
                        <span>Note (only game masters see it)</span>
                        <textarea
                          className="cf-text"
                          maxLength={1000}
                          value={(selObj as BuiltMap['notes'][number]).text}
                          onChange={(e) => {
                            setDraft({
                              ...draft,
                              built: {
                                ...draft.built,
                                notes: draft.built.notes.map((n) =>
                                  n.id === sel.id ? { ...n, text: e.target.value } : n
                                )
                              }
                            })
                            setDirty(true)
                          }}
                        />
                      </label>
                    )}
                    <button type="button" className="cf-danger-ghost cf-small" onClick={removeSel}>
                      Remove
                    </button>
                  </div>
                )}
                <MapLayers
                  layers={mapLayers}
                  built={draft.built}
                  drawLayer={drawLayer}
                  onDraw={setDrawLayer}
                  onChange={(next) => setMapLayers(next)}
                  onDelete={(id) => {
                    // Its pieces go back on the base map (they keep their own hidden marks).
                    const moved = mapPieces(
                      draft.built,
                      (['floors', 'walls', 'objects', 'notes', 'terrain'] as const).flatMap((k) =>
                        ((draft.built[k] ?? []) as { id: string; layer?: string }[])
                          .filter((x) => x.layer === id)
                          .map((x) => ({ kind: k, id: x.id }))
                      ),
                      (p) => {
                        const rest = omit(p, 'layer')
                        return rest
                      }
                    )
                    setMapLayers(
                      mapLayers.filter((l) => l.id !== id),
                      moved
                    )
                    if (drawLayer === id) setDrawLayer('')
                  }}
                  onPick={(id) => {
                    setTool('select')
                    setSels(
                      (['floors', 'walls', 'objects', 'notes', 'terrain'] as const).flatMap((k) =>
                        ((draft.built[k] ?? []) as { id: string; layer?: string }[])
                          .filter((x) => (x.layer ?? '') === id)
                          .map((x) => ({ kind: k, id: x.id }))
                      )
                    )
                  }}
                />
                <h3 className="cf-h3">Show while building</h3>
                <ul className="cf-layers">
                  {(
                    [
                      ['notes', 'GM notes'],
                      ['tokens', 'Tokens'],
                      ['objects', 'Objects'],
                      ['walls', 'Walls and doors'],
                      ['floor', 'Floor']
                    ] as const
                  ).map(([k, label]) => (
                    <li
                      key={k}
                      className={
                        (tool === 'room' || tool === 'paint'
                          ? 'floor'
                          : tool === 'wall'
                            ? 'walls'
                            : tool === 'note'
                              ? 'notes'
                              : '') === k
                          ? 'cf-lyr cf-lyr--on'
                          : 'cf-lyr'
                      }
                    >
                      <button
                        type="button"
                        aria-label={`Show or hide ${label}`}
                        aria-pressed={layers[k]}
                        onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
                      >
                        <Icon name={layers[k] ? 'eye' : 'eyeOff'} size={16} />
                      </button>
                      <span>{label}</span>
                      {k === 'notes' && <span className="cf-badge">Only you</span>}
                    </li>
                  ))}
                </ul>
                <h3 className="cf-h3">Grid and size</h3>
                <div className="cf-field-grid">
                  <label className="cf-field">
                    <span>Grid</span>
                    <select
                      value={draft.grid.type}
                      onChange={(e) =>
                        setD({ grid: { ...draft.grid, type: e.target.value as 'square' | 'hex' } })
                      }
                    >
                      <option value="square">Squares</option>
                      <option value="hex">Hexes</option>
                    </select>
                  </label>
                  <label className="cf-field">
                    <span>Feet per cell</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={draft.grid.feet}
                      onChange={(e) =>
                        setD({
                          grid: { ...draft.grid, feet: Math.max(1, Number(e.target.value) || 5) }
                        })
                      }
                    />
                  </label>
                  <label className="cf-field">
                    <span>Cell size (px)</span>
                    <input
                      type="number"
                      min={10}
                      max={500}
                      value={draft.grid.size}
                      onChange={(e) =>
                        setD({
                          grid: {
                            ...draft.grid,
                            size: Math.max(10, Math.min(500, Number(e.target.value) || 70))
                          }
                        })
                      }
                    />
                  </label>
                  <label className="cf-field">
                    <span>Grid lines</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draft.grid.opacity}
                      onChange={(e) =>
                        setD({ grid: { ...draft.grid, opacity: Number(e.target.value) } })
                      }
                    />
                  </label>
                  <label className="cf-field">
                    <span>Width (cells)</span>
                    <input
                      type="number"
                      min={2}
                      max={200}
                      value={Math.round(draft.widthPx / draft.grid.size)}
                      onChange={(e) =>
                        setD({
                          widthPx: Math.max(
                            100,
                            Math.min(
                              20000,
                              Math.round(Number(e.target.value) || 20) * draft.grid.size
                            )
                          )
                        })
                      }
                    />
                  </label>
                  <label className="cf-field">
                    <span>Height (cells)</span>
                    <input
                      type="number"
                      min={2}
                      max={200}
                      value={Math.round(draft.heightPx / draft.grid.size)}
                      onChange={(e) =>
                        setD({
                          heightPx: Math.max(
                            100,
                            Math.min(
                              20000,
                              Math.round(Number(e.target.value) || 14) * draft.grid.size
                            )
                          )
                        })
                      }
                    />
                  </label>
                  <label className="cf-field">
                    <span>Map theme</span>
                    <select
                      value={draft.theme}
                      onChange={(e) => setD({ theme: e.target.value as MapTheme })}
                    >
                      {MAP_THEMES.map((m) => (
                        <option key={m} value={m}>
                          {THEMES[m].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.backgroundFileId && (
                    <button
                      type="button"
                      className="cf-ghost cf-small"
                      onClick={() => setD({ backgroundFileId: null })}
                    >
                      Remove the map picture
                    </button>
                  )}
                </div>
                <h3 className="cf-h3">Ready for game night</h3>
                <label className="cf-check">
                  <input
                    type="checkbox"
                    checked={startFogged}
                    onChange={(e) => {
                      setStartFogged(e.target.checked)
                      setDirty(true)
                    }}
                  />
                  Start with everything fogged
                </label>
                <label className="cf-check">
                  <input
                    type="checkbox"
                    checked={hiddenMonsters}
                    onChange={(e) => setHiddenMonsters(e.target.checked)}
                  />
                  Place monsters hidden
                </label>
                <label className="cf-field">
                  <span>Music when this scene opens</span>
                  <select
                    value={draft.musicTrackId ?? ''}
                    onChange={(e) => setD({ musicTrackId: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {t.tracks.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.title}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            )}
            <section className="cf-panel">
              <h3 className="cf-h3">Scenes in this campaign</h3>
              <ol className="cf-scenes">
                {t.scenes.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={s.id === editing ? 'cf-scene cf-scene--on' : 'cf-scene'}
                      onClick={() => {
                        if (s.id === editing) return
                        if (dirty && !window.confirm('Leave this scene without saving?')) return
                        setEditing(s.id)
                      }}
                    >
                      {i + 1} · {s.name}
                      {s.id === editing && <span className="cf-sub"> · editing</span>}
                      {s.active && <span className="cf-badge">Players see this</span>}
                    </button>
                  </li>
                ))}
              </ol>
              <button type="button" className="cf-dashed" onClick={() => void newScene()}>
                + New scene
              </button>
              {scene && !t.scenes.find((s) => s.id === scene.id)?.active && (
                <button
                  type="button"
                  className="cf-ghost cf-small"
                  onClick={async () => {
                    if (dirty) await save()
                    const r = await cf.post(
                      `/campfire/campaigns/${t.campaign.id}/scenes/${scene.id}/activate`
                    )
                    if (!r.ok) say(r.message)
                    else say('Everyone is on this scene now.')
                  }}
                >
                  Move everyone to this scene
                </button>
              )}
              {scene && (
                <button
                  type="button"
                  className="cf-danger-ghost cf-small"
                  onClick={async () => {
                    if (!window.confirm(`Delete the scene "${scene.name}" and its tokens?`)) return
                    const r = await cf.del(`/campfire/scenes/${scene.id}`)
                    if (!r.ok) return say(r.message)
                    const next = t.scenes.find((s) => s.id !== scene.id)
                    setScene(null)
                    setDraft(null)
                    setEditing(next?.id ?? null)
                  }}
                >
                  Delete this scene
                </button>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  )

  function placeObject(kind: string, at: Point | null): void {
    if (!draft) return
    const def = OBJECTS.find((o) => o.kind === kind)
    if (!def) return
    const g = draft.grid
    const w = Math.round(def.w * g.size)
    const h = Math.round(def.h * g.size)
    const c = at ?? [draft.widthPx / 2, draft.heightPx / 2]
    const [x, y] = snapCorner(c[0] - w / 2, c[1] - h / 2, g)
    const o: BuiltObject = { id: pieceId('o'), kind, x, y, w, h, rotation: 0 }
    change({ ...draft.built, objects: [...draft.built.objects, o] })
    setSel({ kind: 'objects', id: o.id })
  }
}

// ───────────── The builder's map ─────────────

function BuilderMap({
  draft,
  tokens,
  layers,
  tool,
  material,
  wallKind,
  terrainKind,
  sels,
  setSels,
  drawLayer,
  change,
  preview,
  fogged,
  onDropObject
}: {
  draft: Draft
  tokens: Token[]
  layers: BuiltLayers & { tokens: boolean }
  tool: BTool
  material: string
  wallKind: 'wall' | DoorState
  terrainKind: 'difficult' | 'water'
  sels: PieceRef[]
  setSels: (s: PieceRef[]) => void
  drawLayer: string
  change: (b: BuiltMap) => void
  preview: boolean
  fogged: boolean
  onDropObject: (kind: string, at: Point) => void
}): React.JSX.Element {
  const g = draft.grid
  const { box, fit, panBy, toWorld, view, zoomAt } = usePanZoom(
    draft.widthPx,
    draft.heightPx,
    `${draft.widthPx}x${draft.heightPx}`
  )
  const pinch = useRef(new Pinch())
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null)
  const [poly, setPoly] = useState<Point[] | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  // 0.11.2: any selected pieces move together (floors, walls and terrain too)
  const [moving, setMoving] = useState<{
    refs: PieceRef[]
    from: Point
    moved: boolean
    start: BuiltMap
  } | null>(null)
  // 0.11.2: a corner handle being dragged
  const [sizing, setSizing] = useState<{
    ref: PieceRef
    handle: Handle
    box: Box
    start: BuiltMap
    moved: boolean
  } | null>(null)
  const [selBox, setSelBox] = useState<{ a: Point; b: Point } | null>(null)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const built = draft.built
  // New pieces go on the layer being drawn on.
  const onLayer = drawLayer ? { layer: drawLayer } : {}
  const sel: Sel = sels.length === 1 ? sels[0] : null
  const setSel = (r: Sel): void => setSels(r ? [r] : [])

  const pieceAt = (target: EventTarget | null): Sel => {
    const el = (target as Element | null)?.closest?.('[data-piece]')
    const v = el?.getAttribute('data-piece')
    if (!v) return null
    const [kind, id] = v.split(':')
    return { kind: kind as NonNullable<Sel>['kind'], id }
  }

  const finishPoly = (): void => {
    if (poly && poly.length >= 3)
      change({
        ...built,
        floors: [...built.floors, { id: pieceId('f'), points: poly, material, ...onLayer }]
      })
    setPoly(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!poly) return
      if (e.key === 'Enter') finishPoly()
      if (e.key === 'Escape') setPoly(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const down = (e: React.PointerEvent<SVGSVGElement>): void => {
    pinch.current.down(e)
    if (pinch.current.active) return
    if (e.button === 1 || preview) {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setPan({ x: e.clientX, y: e.clientY })
      return
    }
    if (e.button !== 0) return
    const raw = toWorld(e.clientX, e.clientY)
    // 0.11.2: Shift or Alt places freely (off the grid)
    const free = e.altKey || e.shiftKey
    const at = snapCorner(raw[0], raw[1], g, free)
    const piece = pieceAt(e.target)
    if (tool === 'room') {
      if (e.shiftKey || poly) {
        setPoly([...(poly ?? []), at])
        return
      }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setDrawing({ a: at, b: at })
    } else if (tool === 'wall' || tool === 'terrain') {
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setDrawing({ a: at, b: at })
    } else if (tool === 'paint') {
      if (piece?.kind === 'floors')
        change({
          ...built,
          floors: built.floors.map((f) => (f.id === piece.id ? { ...f, material } : f))
        })
    } else if (tool === 'erase') {
      if (piece)
        change({
          ...built,
          [piece.kind]: ((built[piece.kind] ?? []) as { id: string }[]).filter(
            (x) => x.id !== piece.id
          )
        } as BuiltMap)
    } else if (tool === 'note') {
      const n = {
        id: pieceId('n'),
        x: Math.round(raw[0]),
        y: Math.round(raw[1]),
        text: 'Note',
        ...onLayer
      }
      change({ ...built, notes: [...built.notes, n] })
      setSel({ kind: 'notes', id: n.id })
    } else {
      // Select. A corner handle resizes the one selected piece.
      const handle = (e.target as Element | null)
        ?.closest?.('[data-handle]')
        ?.getAttribute('data-handle') as Handle | null
      if (handle && sel) {
        const p = findPiece(built, sel)
        if (p) {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          setSizing({ ref: sel, handle, box: boxOf(p, sel.kind), start: built, moved: false })
        }
        return
      }
      // Shift (or Ctrl) and a piece: add it to the selection or take it out.
      if (piece && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        setSels(
          hasRef(sels, piece)
            ? sels.filter((r) => !(r.kind === piece.kind && r.id === piece.id))
            : [...sels, piece]
        )
        return
      }
      // Shift on empty map: drag a box around pieces.
      if (!piece && e.shiftKey) {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setSelBox({ a: raw, b: raw })
        return
      }
      if (piece) {
        const refs = hasRef(sels, piece) ? sels : [piece]
        if (!hasRef(sels, piece)) setSels([piece])
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setMoving({ refs, from: raw, moved: false, start: built })
      } else {
        setSels([])
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setPan({ x: e.clientX, y: e.clientY })
      }
    }
  }

  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
    // 0.11.2: the button is up but the release never arrived: let go instead of staying held.
    if (
      e.pointerType !== 'touch' &&
      e.buttons === 0 &&
      (moving || sizing || selBox || drawing || pan)
    ) {
      up(e)
      return
    }
    const pm = pinch.current.move(e)
    if (pm) {
      const r = box.current?.getBoundingClientRect()
      panBy(pm.dx, pm.dy)
      zoomAt(pm.factor, pm.c[0] - (r?.left ?? 0), pm.c[1] - (r?.top ?? 0))
      return
    }
    if (pan) {
      panBy(e.clientX - pan.x, e.clientY - pan.y)
      setPan({ x: e.clientX, y: e.clientY })
      return
    }
    const raw = toWorld(e.clientX, e.clientY)
    const free = e.altKey || e.shiftKey
    const at = snapCorner(raw[0], raw[1], g, free)
    if (poly) setHover(at)
    if (drawing) setDrawing({ ...drawing, b: at })
    if (selBox) setSelBox({ ...selBox, b: raw })
    if (moving) {
      const dx = raw[0] - moving.from[0]
      const dy = raw[1] - moving.from[1]
      // A click that hardly moves is a click, not a nudge.
      if (!moving.moved && Math.hypot(dx, dy) * view.z < 3) return
      const notesOnly = moving.refs.every((r) => r.kind === 'notes')
      const [mx, my] = moveDelta(moving.start, moving.refs, dx, dy, g, free || notesOnly)
      // Moved live without an undo step each time; one step is kept on release.
      draftLive(mapPieces(moving.start, moving.refs, (p) => translate(p, mx, my)))
      if (!moving.moved) setMoving({ ...moving, moved: true })
    }
    if (sizing) {
      const box = resizedBox(sizing.box, sizing.handle, raw, g, free)
      draftLive(mapPieces(sizing.start, [sizing.ref], (p) => resizePiece(p, sizing.box, box)))
      if (!sizing.moved) setSizing({ ...sizing, moved: true })
    }
  }

  // A drag's in-between positions: shown without adding to undo history.
  const [live, setLive] = useState<BuiltMap | null>(null)
  const draftLive = (b: BuiltMap): void => setLive(b)

  const lastUp = useRef(0)
  const up = (e: React.PointerEvent<SVGSVGElement>): void => {
    lastUp.current = performance.now()
    pinch.current.up(e)
    if (pan) setPan(null)
    if (moving) {
      if (moving.moved && live) change(live)
      setLive(null)
      setMoving(null)
    }
    if (sizing) {
      if (sizing.moved && live) change(live)
      setLive(null)
      setSizing(null)
    }
    if (selBox) {
      const picked = piecesIn(built, selBox.a, selBox.b, layers.notes)
      setSels([...sels, ...picked.filter((r) => !hasRef(sels, r))])
      setSelBox(null)
    }
    if (!drawing) return
    const { a, b } = drawing
    setDrawing(null)
    if (tool === 'room') {
      if (Math.abs(a[0] - b[0]) < 4 || Math.abs(a[1] - b[1]) < 4) return
      const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
      const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
      change({
        ...built,
        floors: [
          ...built.floors,
          {
            id: pieceId('f'),
            points: [
              [x1, y1],
              [x2, y1],
              [x2, y2],
              [x1, y2]
            ],
            material,
            ...onLayer
          }
        ]
      })
    } else if (tool === 'terrain') {
      if (Math.abs(a[0] - b[0]) < 4 || Math.abs(a[1] - b[1]) < 4) return
      const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
      const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
      change({
        ...built,
        terrain: [
          ...(built.terrain ?? []),
          {
            id: pieceId('t'),
            kind: terrainKind,
            points: [
              [x1, y1],
              [x2, y1],
              [x2, y2],
              [x1, y2]
            ],
            ...onLayer
          }
        ]
      })
    } else if (tool === 'wall') {
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 4) return
      change({
        ...built,
        walls: [
          ...built.walls,
          {
            id: pieceId('w'),
            points: [a, b],
            ...(wallKind !== 'wall' ? { door: { state: wallKind } } : {}),
            ...onLayer
          }
        ]
      })
    }
  }

  const live0 = live ?? built
  // Preview as a player: nothing the game master hid.
  const shown = preview ? shownToPlayers(live0) : live0
  const hex = g.type === 'hex' ? hexPattern(g.size) : null
  const selPieces = preview ? [] : existing(live0, sels)

  return (
    <div
      className={`cf-map cf-map--builder cf-map--b-${tool}`}
      ref={box}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-campfire-object')) e.preventDefault()
      }}
      onDrop={(e) => {
        const kind = e.dataTransfer.getData('application/x-campfire-object')
        if (!kind) return
        e.preventDefault()
        onDropObject(kind, toWorld(e.clientX, e.clientY))
      }}
    >
      <svg
        className="cf-map-svg"
        role="application"
        aria-label="Map builder canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={(e) => {
          // Losing capture right after a release is normal; only a lost release finishes here.
          if (performance.now() - lastUp.current < 250) return
          if (moving || sizing || selBox || drawing || pan) up(e)
        }}
        onDoubleClick={() => poly && finishPoly()}
      >
        <defs>
          <clipPath id="cf-bround" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
          <BuiltDefs grid={g} />
          <pattern
            id="cf-bmud"
            width={12}
            height={12}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={12} height={12} fill="rgba(110,74,47,0.45)" />
            <line x1={0} y1={0} x2={0} y2={12} stroke="rgba(255,208,138,0.35)" strokeWidth={3} />
          </pattern>
          {hex ? (
            <pattern
              id="cf-bgrid"
              width={hex.w}
              height={hex.h}
              patternUnits="userSpaceOnUse"
              x={g.offsetX}
              y={g.offsetY}
            >
              <path
                d={hex.d}
                fill="none"
                stroke={g.color}
                strokeOpacity={Math.max(0.15, g.opacity)}
                strokeWidth={1}
              />
            </pattern>
          ) : (
            <pattern
              id="cf-bgrid"
              width={g.size}
              height={g.size}
              patternUnits="userSpaceOnUse"
              x={g.offsetX}
              y={g.offsetY}
            >
              <path
                d={`M0 0H${g.size}M0 0V${g.size}`}
                fill="none"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={1}
              />
            </pattern>
          )}
        </defs>
        <rect
          x={-100000}
          y={-100000}
          width={200000}
          height={200000}
          fill={THEMES[draft.theme].bg}
        />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          <rect
            width={draft.widthPx}
            height={draft.heightPx}
            fill="rgba(255,255,255,0.02)"
            stroke="rgba(255,255,255,0.12)"
            strokeDasharray="8 6"
          />
          {draft.backgroundFileId && (
            <image
              href={fileUrl(draft.backgroundFileId)}
              width={draft.widthPx}
              height={draft.heightPx}
              preserveAspectRatio="none"
            />
          )}
          <BuiltLayer
            built={shown}
            grid={g}
            theme={draft.theme}
            layers={layers}
            showNotes={!preview}
            gmMarks={!preview}
            only={drawLayer || (built.layers?.length ? '' : null)}
          />
          {layers.floor &&
            shown.terrain?.map((tr) => (
              <polygon
                key={tr.id}
                data-piece={`terrain:${tr.id}`}
                opacity={!preview && pieceHidden(tr, shown.layers) ? 0.38 : undefined}
                points={tr.points.map((q) => q.join(',')).join(' ')}
                fill={tr.kind === 'water' ? 'rgba(70,130,190,0.42)' : 'url(#cf-bmud)'}
                stroke={
                  hasRef(sels, { kind: 'terrain', id: tr.id })
                    ? '#ffb347'
                    : tr.kind === 'water'
                      ? 'rgba(111,156,255,0.7)'
                      : 'rgba(255,179,71,0.6)'
                }
                strokeWidth={2}
                strokeDasharray={tr.kind === 'water' ? undefined : '6 4'}
              />
            ))}
          <rect
            width={draft.widthPx}
            height={draft.heightPx}
            fill="url(#cf-bgrid)"
            pointerEvents="none"
          />
          {tokens.map((tk) => (
            <g
              key={tk.id}
              transform={`translate(${tk.x} ${tk.y})`}
              opacity={tk.layer === 'gm' ? 0.55 : 1}
              pointerEvents="none"
            >
              <circle
                cx={(tk.w * g.size) / 2}
                cy={(tk.h * g.size) / 2}
                r={(Math.min(tk.w, tk.h) * g.size) / 2 - 3}
                fill="#7a2a22"
                stroke="#ef5a4a"
                strokeWidth={3}
              />
              {tk.imageFileId && (
                <image
                  href={fileUrl(tk.imageFileId)}
                  x={3}
                  y={3}
                  width={tk.w * g.size - 6}
                  height={tk.h * g.size - 6}
                  clipPath="url(#cf-bround)"
                  preserveAspectRatio="xMidYMid slice"
                />
              )}
              <text
                x={(tk.w * g.size) / 2}
                y={tk.h * g.size + 14}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill="#fff"
              >
                {tk.name}
              </text>
            </g>
          ))}
          {preview && fogged && (
            <rect
              width={draft.widthPx}
              height={draft.heightPx}
              fill="#000"
              opacity={0.92}
              pointerEvents="none"
            />
          )}
          {selPieces.map((r) => {
            const p = findPiece(live0, r)
            return p ? (
              <SelectionBox
                key={`${r.kind}:${r.id}`}
                box={boxOf(p, r.kind)}
                handles={selPieces.length === 1 && r.kind !== 'notes'}
                z={view.z}
              />
            ) : null
          })}
          {selBox && (
            <rect
              x={Math.min(selBox.a[0], selBox.b[0])}
              y={Math.min(selBox.a[1], selBox.b[1])}
              width={Math.abs(selBox.b[0] - selBox.a[0])}
              height={Math.abs(selBox.b[1] - selBox.a[1])}
              fill="rgba(255,179,71,0.08)"
              stroke="#ffb347"
              strokeWidth={1.5 / view.z}
              strokeDasharray={`${6 / view.z} ${4 / view.z}`}
              pointerEvents="none"
            />
          )}
          {drawing && tool === 'terrain' && (
            <rect
              x={Math.min(drawing.a[0], drawing.b[0])}
              y={Math.min(drawing.a[1], drawing.b[1])}
              width={Math.abs(drawing.b[0] - drawing.a[0])}
              height={Math.abs(drawing.b[1] - drawing.a[1])}
              fill={terrainKind === 'water' ? 'rgba(70,130,190,0.42)' : 'url(#cf-bmud)'}
              stroke="#ffb347"
              strokeWidth={2}
              strokeDasharray="8 6"
            />
          )}
          {drawing && tool === 'room' && (
            <rect
              x={Math.min(drawing.a[0], drawing.b[0])}
              y={Math.min(drawing.a[1], drawing.b[1])}
              width={Math.abs(drawing.b[0] - drawing.a[0])}
              height={Math.abs(drawing.b[1] - drawing.a[1])}
              fill={`url(#cf-mat-${material})`}
              stroke="#ffb347"
              strokeWidth={2}
              strokeDasharray="8 6"
            />
          )}
          {drawing && tool === 'wall' && (
            <line
              x1={drawing.a[0]}
              y1={drawing.a[1]}
              x2={drawing.b[0]}
              y2={drawing.b[1]}
              stroke={wallKind === 'wall' ? '#ffb347' : '#8a5d3b'}
              strokeWidth={8}
              strokeLinecap="square"
            />
          )}
          {poly && (
            <polyline
              points={[...poly, ...(hover ? [hover] : [])].map((p) => p.join(',')).join(' ')}
              fill="rgba(255,179,71,0.12)"
              stroke="#ffb347"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
        </g>
      </svg>
      {poly && (
        <div className="cf-toast" role="status">
          Click to add corners · double-click or Enter to finish · Esc to cancel
        </div>
      )}
      {preview && (
        <div className="cf-toast" role="status">
          Preview: what players see
          {fogged ? ' (everything starts fogged; reveal areas at the table)' : ''}. GM notes and
          hidden tokens are left out.
        </div>
      )}
      <div className="cf-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          −
        </button>
        <button type="button" className="cf-zoom-pct" aria-label="Fit the map" onClick={fit}>
          {Math.round(view.z * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25)}>
          +
        </button>
      </div>
    </div>
  )
}

function SelectionBox({
  box,
  handles,
  z
}: {
  box: Box
  handles: boolean
  z: number
}): React.JSX.Element {
  const pad = 6
  const r = 7 / z
  const corners: [Handle, number, number][] = [
    ['nw', box.x, box.y],
    ['ne', box.x + box.w, box.y],
    ['se', box.x + box.w, box.y + box.h],
    ['sw', box.x, box.y + box.h]
  ]
  return (
    <g>
      <rect
        x={box.x - pad}
        y={box.y - pad}
        width={box.w + pad * 2}
        height={box.h + pad * 2}
        fill="none"
        stroke="#ffb347"
        strokeWidth={2}
        strokeDasharray="6 4"
        pointerEvents="none"
      />
      {handles &&
        corners.map(([h, x, y]) => (
          <rect
            key={h}
            data-handle={h}
            className={`cf-handle cf-handle--${h}`}
            x={x - r}
            y={y - r}
            width={r * 2}
            height={r * 2}
            rx={2 / z}
            fill="#ffb347"
            stroke="#2a1406"
            strokeWidth={1.5 / z}
          >
            <title>Drag to resize</title>
          </rect>
        ))}
    </g>
  )
}

/** 0.11.2: hide from players, the layer, copy and duplicate (one piece or several). */
function PieceActions({
  hidden,
  layer,
  layers,
  onHidden,
  onLayer,
  onCopy,
  onDuplicate
}: {
  hidden: boolean
  /** null: the pieces are on different layers */
  layer: string | null
  layers: MapLayer[]
  onHidden: (hide: boolean) => void
  onLayer: (id: string) => void
  onCopy: () => void
  onDuplicate: () => void
}): React.JSX.Element {
  return (
    <>
      <label className="cf-check cf-hide-check">
        <input type="checkbox" checked={hidden} onChange={(e) => onHidden(e.target.checked)} />
        Hidden from players <span className="cf-sub">(H)</span>
      </label>
      {layers.length > 0 && (
        <label className="cf-field">
          <span>Layer</span>
          <select value={layer ?? '*'} onChange={(e) => onLayer(e.target.value)}>
            {layer === null && (
              <option value="*" disabled>
                Several layers
              </option>
            )}
            <option value="">Base map</option>
            {layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.hidden ? ' (hidden)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="cf-row-buttons">
        <button type="button" className="cf-ghost cf-small" onClick={onCopy} title="Ctrl+C">
          Copy
        </button>
        <button type="button" className="cf-ghost cf-small" onClick={onDuplicate} title="Ctrl+D">
          Duplicate
        </button>
      </div>
    </>
  )
}

/**
 * 0.11.2: map layers. Build a part of the map on its own layer ("Upstairs", "Secret vault"), hide
 * the layer from players, and show it when they find it. New pieces go on the layer you draw on.
 */
function MapLayers({
  layers,
  built,
  drawLayer,
  onDraw,
  onChange,
  onDelete,
  onPick
}: {
  layers: MapLayer[]
  built: BuiltMap
  drawLayer: string
  onDraw: (id: string) => void
  onChange: (next: MapLayer[]) => void
  onDelete: (id: string) => void
  onPick: (id: string) => void
}): React.JSX.Element {
  const count = (id: string): number =>
    (['floors', 'walls', 'objects', 'notes', 'terrain'] as const).reduce(
      (n, k) =>
        n + ((built[k] ?? []) as { layer?: string }[]).filter((x) => (x.layer ?? '') === id).length,
      0
    )
  const rows: { id: string; name: string; hidden?: true }[] = [
    { id: '', name: 'Base map' },
    ...layers
  ]
  return (
    <>
      <h3 className="cf-h3">Layers</h3>
      <p className="cf-hint cf-maplayers-hint">
        Build parts of the map on their own layer, hide the layer, and show it when the party finds
        it. New pieces go on the layer you’re drawing on.
      </p>
      <ul className="cf-maplayers" aria-label="Map layers">
        {rows.map((l) => (
          <li key={l.id || 'base'} className={drawLayer === l.id ? 'cf-ml cf-ml--on' : 'cf-ml'}>
            <input
              type="radio"
              name="cf-draw-layer"
              aria-label={`Draw on ${l.name}`}
              title="Draw on this layer"
              checked={drawLayer === l.id}
              onChange={() => onDraw(l.id)}
            />
            {l.id ? (
              <input
                className="cf-ml-name"
                aria-label="Layer name"
                value={l.name}
                maxLength={CAMPFIRE_LIMITS.mapLayerName}
                onChange={(e) =>
                  onChange(layers.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))
                }
                onBlur={(e) => {
                  if (!e.target.value.trim())
                    onChange(layers.map((x) => (x.id === l.id ? { ...x, name: 'Layer' } : x)))
                }}
              />
            ) : (
              <span className="cf-ml-name cf-ml-name--base">Base map</span>
            )}
            <button
              type="button"
              className="cf-ml-count"
              title="Select everything on this layer"
              onClick={() => onPick(l.id)}
            >
              {count(l.id)}
            </button>
            {l.id ? (
              <>
                <button
                  type="button"
                  className={l.hidden ? 'cf-ml-eye cf-ml-eye--off' : 'cf-ml-eye'}
                  aria-pressed={!l.hidden}
                  aria-label={
                    l.hidden
                      ? `${l.name}: hidden from players. Show it`
                      : `${l.name}: players see it. Hide it`
                  }
                  title={l.hidden ? 'Hidden from players' : 'Players see it'}
                  onClick={() =>
                    onChange(
                      layers.map((x) => {
                        if (x.id !== l.id) return x
                        const rest = omit(x, 'hidden')
                        return x.hidden ? rest : { ...rest, hidden: true }
                      })
                    )
                  }
                >
                  <Icon name={l.hidden ? 'eyeOff' : 'eye'} size={16} />
                </button>
                <button
                  type="button"
                  className="cf-ml-del"
                  aria-label={`Delete the layer ${l.name} (its pieces move to the base map)`}
                  title="Delete the layer (its pieces stay, on the base map)"
                  onClick={() => onDelete(l.id)}
                >
                  ×
                </button>
              </>
            ) : (
              <span className="cf-ml-eye cf-ml-eye--fixed" title="Players see the base map">
                <Icon name="eye" size={16} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {layers.length < CAMPFIRE_LIMITS.mapLayers && (
        <button
          type="button"
          className="cf-dashed"
          onClick={() => {
            const id = pieceId('l')
            onChange([...layers, { id, name: `Layer ${layers.length + 1}`, hidden: true }])
            onDraw(id)
          }}
        >
          + New layer (starts hidden)
        </button>
      )}
    </>
  )
}
