import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BuiltMap,
  BuiltObject,
  DoorState,
  GridSettings,
  MapTheme,
  Point,
  Scene,
  Token
} from '@glofly/shared/campfire/types'
import { MAP_THEMES } from '@glofly/shared/campfire/types'
import BuiltLayer, { BuiltDefs, ObjectShape, type BuiltLayers } from './BuiltLayer'
import {
  cf,
  fileUrl,
  HIDDEN_KEY,
  IMAGE_ACCEPT,
  pickFile,
  pieceId,
  placeHidden,
  uploadFile
} from './api'
import { useCf } from './ctx'
import { hexPattern, MATERIALS, OBJECTS, Pinch, snapCorner, THEMES, usePanZoom } from './geometry'
import { Icon } from './icons'

// The map builder (Builder board, GMs only): rooms (drag corner to corner, or Shift for a free
// shape) with floor materials, walls with doors, objects dragged from the palette, GM notes,
// layers, undo/redo, grid settings, preview as a player, scenes, start fogged, a map picture.

type BTool = 'select' | 'room' | 'wall' | 'paint' | 'note' | 'erase'
type Sel = { kind: 'floors' | 'walls' | 'objects' | 'notes'; id: string } | null

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
  const { t, say, ctl } = useCf()
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
  const [layers, setLayers] = useState<BuiltLayers & { tokens: boolean }>({
    floor: true,
    walls: true,
    objects: true,
    notes: true,
    tokens: true
  })
  const [sel, setSel] = useState<Sel>(null)
  const [preview, setPreview] = useState(false)
  const [startFogged, setStartFogged] = useState(false)
  const [hiddenMonsters, setHiddenMonsters] = useState(placeHidden)
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
      setSel(null)
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
    if (!draft || !sel) return
    const b = draft.built
    change({
      ...b,
      [sel.kind]: (b[sel.kind] as { id: string }[]).filter((x) => x.id !== sel.id)
    } as BuiltMap)
    setSel(null)
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        removeSel()
      } else if (e.key === 'Escape') {
        setSel(null)
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
    { id: 'note', label: 'GM note', icon: 'note' },
    { id: 'erase', label: 'Erase', icon: 'erase' }
  ]
  const hint: Record<BTool, string> = {
    select: 'Selecting: click a piece, drag objects and notes, Delete removes it',
    room: 'Drawing a room: drag from corner to corner',
    wall: 'Drawing walls: drag along a wall (pick Door to draw a door)',
    paint: 'Painting floors: click a room to give it the material',
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
              Snaps to the grid · Shift for a free shape · Ctrl+Z to undo
            </span>
          </div>
          {draft && scene ? (
            <BuilderMap
              draft={draft}
              tokens={layers.tokens ? tokens.filter((x) => !(preview && x.layer === 'gm')) : []}
              layers={layers}
              tool={preview ? 'select' : tool}
              material={material}
              wallKind={wallKind}
              sel={sel}
              setSel={setSel}
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
                            : 'object'}
                    </h3>
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
                <h3 className="cf-h3">Layers</h3>
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
                          ? 'cf-layer cf-layer--on'
                          : 'cf-layer'
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
                    onChange={(e) => {
                      setHiddenMonsters(e.target.checked)
                      localStorage.setItem(HIDDEN_KEY, e.target.checked ? '1' : '0')
                    }}
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
  sel,
  setSel,
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
  sel: Sel
  setSel: (s: Sel) => void
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
  const [moving, setMoving] = useState<{
    kind: 'objects' | 'notes'
    id: string
    dx: number
    dy: number
    moved: boolean
    start: BuiltMap
  } | null>(null)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const built = draft.built

  const pieceAt = (target: EventTarget | null): Sel => {
    const el = (target as Element | null)?.closest?.('[data-piece]')
    const v = el?.getAttribute('data-piece')
    if (!v) return null
    const [kind, id] = v.split(':')
    return { kind: kind as NonNullable<Sel>['kind'], id }
  }

  const finishPoly = (): void => {
    if (poly && poly.length >= 3)
      change({ ...built, floors: [...built.floors, { id: pieceId('f'), points: poly, material }] })
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
    const at = snapCorner(raw[0], raw[1], g, e.altKey)
    const piece = pieceAt(e.target)
    if (tool === 'room') {
      if (e.shiftKey || poly) {
        setPoly([...(poly ?? []), at])
        return
      }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      setDrawing({ a: at, b: at })
    } else if (tool === 'wall') {
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
          [piece.kind]: (built[piece.kind] as { id: string }[]).filter((x) => x.id !== piece.id)
        } as BuiltMap)
    } else if (tool === 'note') {
      const n = { id: pieceId('n'), x: Math.round(raw[0]), y: Math.round(raw[1]), text: 'Note' }
      change({ ...built, notes: [...built.notes, n] })
      setSel({ kind: 'notes', id: n.id })
    } else {
      setSel(piece)
      if (piece && (piece.kind === 'objects' || piece.kind === 'notes')) {
        const p = (built[piece.kind] as { id: string; x: number; y: number }[]).find(
          (x) => x.id === piece.id
        )
        if (p) {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          setMoving({
            kind: piece.kind,
            id: piece.id,
            dx: raw[0] - p.x,
            dy: raw[1] - p.y,
            moved: false,
            start: built
          })
        }
      } else if (!piece) {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        setPan({ x: e.clientX, y: e.clientY })
      }
    }
  }

  const move = (e: React.PointerEvent<SVGSVGElement>): void => {
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
    const at = snapCorner(raw[0], raw[1], g, e.altKey)
    if (poly) setHover(at)
    if (drawing) setDrawing({ ...drawing, b: at })
    if (moving) {
      const [x, y] =
        moving.kind === 'objects'
          ? snapCorner(raw[0] - moving.dx, raw[1] - moving.dy, g, e.altKey)
          : [Math.round(raw[0] - moving.dx), Math.round(raw[1] - moving.dy)]
      const list = (built[moving.kind] as { id: string; x: number; y: number }[]).map((p) =>
        p.id === moving.id ? { ...p, x, y } : p
      )
      // Moved live without an undo step each time; one step is kept on release.
      draftLive({ ...built, [moving.kind]: list } as BuiltMap)
      if (!moving.moved) setMoving({ ...moving, moved: true })
    }
  }

  // A drag's in-between positions: shown without adding to undo history.
  const [live, setLive] = useState<BuiltMap | null>(null)
  const draftLive = (b: BuiltMap): void => setLive(b)

  const up = (e: React.PointerEvent<SVGSVGElement>): void => {
    pinch.current.up(e)
    if (pan) setPan(null)
    if (moving) {
      if (moving.moved && live) change(live)
      setLive(null)
      setMoving(null)
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
            material
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
            ...(wallKind !== 'wall' ? { door: { state: wallKind } } : {})
          }
        ]
      })
    }
  }

  const shown = live ?? built
  const hex = g.type === 'hex' ? hexPattern(g.size) : null
  const selPiece = sel ? (shown[sel.kind] as { id: string }[]).find((x) => x.id === sel.id) : null

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
        onDoubleClick={() => poly && finishPoly()}
      >
        <defs>
          <clipPath id="cf-bround" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
          <BuiltDefs grid={g} />
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
          />
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
          {selPiece && !preview && <SelectionBox piece={selPiece as never} kind={sel!.kind} />}
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
  piece,
  kind
}: {
  piece: { points?: Point[]; x?: number; y?: number; w?: number; h?: number }
  kind: string
}): React.JSX.Element | null {
  let box: { x: number; y: number; w: number; h: number } | null = null
  if (piece.points?.length) {
    const xs = piece.points.map((p) => p[0])
    const ys = piece.points.map((p) => p[1])
    box = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys)
    }
  } else if (kind === 'notes')
    box = { x: (piece.x ?? 0) - 14, y: (piece.y ?? 0) - 14, w: 28, h: 28 }
  else if (piece.x !== undefined)
    box = { x: piece.x, y: piece.y ?? 0, w: piece.w ?? 0, h: piece.h ?? 0 }
  if (!box) return null
  return (
    <rect
      x={box.x - 6}
      y={box.y - 6}
      width={box.w + 12}
      height={box.h + 12}
      fill="none"
      stroke="#ffb347"
      strokeWidth={2}
      strokeDasharray="6 4"
      pointerEvents="none"
    />
  )
}
