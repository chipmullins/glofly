import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanEmojiName, type ConstellationDetail, type ConstellationEmoji } from '@glofly/shared'
import { emojiApi } from '../lib/customEmoji'
import { emojiUrl } from '../lib/media'
import './NightWatch.css'
import './EmojiSettings.css'

// Communities round 2 (approved board 2a): Constellation settings → Emoji & stickers. Free for
// every constellation: up to 150 emoji (still or animated) and 60 stickers. Pictures are cleaned
// on the server (re-saved as WebP, no metadata); stickers can have their background removed.

type Tab = 'emoji' | 'stickers'
type Draft = { file: File; url: string; name: string; outside: boolean; cutout: boolean }
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export default function EmojiSettings({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('emoji')
  const [lists, setLists] = useState<{
    emoji: ConstellationEmoji[]
    stickers: ConstellationEmoji[]
    limits: { emoji: number; stickers: number }
    canManage: boolean
  } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = useCallback(() => {
    void emojiApi.list(c.id).then((r) => (r.ok ? setLists(r.data) : onProblem(r.message)))
  }, [c.id, onProblem])
  useEffect(load, [load])

  if (!lists)
    return (
      <div className="cx-settings-body">
        <p className="cx-settings-text">Loading…</p>
      </div>
    )
  const items = tab === 'emoji' ? lists.emoji : lists.stickers
  const max = tab === 'emoji' ? lists.limits.emoji : lists.limits.stickers
  const full = items.length >= max

  function pick(file: File | undefined): void {
    if (!file) return
    if (!TYPES.includes(file.type as (typeof TYPES)[number]))
      return onProblem('Use a PNG, JPG, GIF or WebP.')
    const limit = tab === 'emoji' ? 512 * 1024 : 2 * 1024 * 1024
    if (file.size > limit)
      return onProblem(
        tab === 'emoji' ? 'Emoji can be up to 512 KB.' : 'Stickers can be up to 2 MB.'
      )
    const base = file.name.replace(/\.[^.]+$/, '')
    setDraft({
      file,
      url: URL.createObjectURL(file),
      name: tab === 'emoji' ? (cleanEmojiName(base) ?? '') : base.slice(0, 30),
      outside: true,
      cutout: false
    })
  }

  async function add(): Promise<void> {
    if (!draft) return
    setBusy(true)
    const r = await window.glofly.constellations.addEmoji(
      c.id,
      await draft.file.arrayBuffer(),
      draft.file.type as (typeof TYPES)[number],
      {
        kind: tab === 'emoji' ? 'emoji' : 'sticker',
        name: draft.name,
        outside: draft.outside,
        cutout: draft.cutout
      }
    )
    setBusy(false)
    if (!r.ok) return onProblem(r.message)
    URL.revokeObjectURL(draft.url)
    setDraft(null)
    load()
  }

  async function change(
    e: ConstellationEmoji,
    changes: { name?: string; outside?: boolean }
  ): Promise<void> {
    const r = await emojiApi.change(c.id, e.id, changes)
    if (!r.ok) onProblem(r.message)
    load()
  }
  async function remove(e: ConstellationEmoji): Promise<void> {
    const r = await emojiApi.remove(c.id, e.id)
    if (!r.ok) onProblem(r.message)
    load()
  }
  const nameOk = tab === 'emoji' ? !!cleanEmojiName(draft?.name ?? '') : !!draft?.name.trim()

  return (
    <div className="cx-settings-body es">
      <div className="es-head">
        <div className="es-tabs" role="tablist" aria-label="Emoji or stickers">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'emoji'}
            className="es-tab"
            onClick={() => setTab('emoji')}
          >
            Emoji · {lists.emoji.length} of {lists.limits.emoji}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'stickers'}
            className="es-tab"
            onClick={() => setTab('stickers')}
          >
            Stickers · {lists.stickers.length} of {lists.limits.stickers}
          </button>
        </div>
        {lists.canManage && (
          <button
            type="button"
            className="es-upload"
            disabled={full}
            onClick={() => fileRef.current?.click()}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
            </svg>
            Upload {tab === 'emoji' ? 'emoji' : 'a sticker'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={TYPES.join(',')}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <div className="es-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (items.length / max) * 100)}%` }} />
      </div>
      {items.length === 0 ? (
        <p className="es-empty">
          {tab === 'emoji'
            ? 'No emoji yet. Members can use them in any chat on Glofly, for free.'
            : 'No stickers yet. Upload a picture, or a photo with its background cut out.'}
        </p>
      ) : (
        <div className={tab === 'emoji' ? 'es-grid' : 'es-grid es-grid--stickers'}>
          {items.map((e) => (
            <div key={e.id} className="es-cell">
              <img
                src={emojiUrl(e.id)}
                alt=""
                className={tab === 'emoji' ? 'es-img' : 'es-img es-img--sticker'}
              />
              {renaming?.id === e.id ? (
                <form
                  className="es-rename"
                  onSubmit={(ev) => {
                    ev.preventDefault()
                    void change(e, { name: renaming.name })
                    setRenaming(null)
                  }}
                >
                  <input
                    autoFocus
                    aria-label="New name"
                    value={renaming.name}
                    maxLength={32}
                    onChange={(ev) => setRenaming({ id: e.id, name: ev.target.value })}
                    onBlur={() => setRenaming(null)}
                  />
                </form>
              ) : (
                <b className="es-name" title={tab === 'emoji' ? `:${e.name}:` : e.name}>
                  {tab === 'emoji' ? `:${e.name}:` : e.name}
                </b>
              )}
              <span className="es-by">
                {e.animated ? 'GIF · ' : ''}
                {e.createdBy ? `by ${e.createdBy.displayName.split(/\s+/)[0]}` : ''}
                {!e.outside ? ' · here only' : ''}
              </span>
              {lists.canManage && (
                <div className="es-actions">
                  <button
                    type="button"
                    aria-label={`Rename ${e.name}`}
                    title="Rename"
                    onClick={() => setRenaming({ id: e.id, name: e.name })}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    aria-label={
                      e.outside ? `Only allow ${e.name} here` : `Allow ${e.name} everywhere`
                    }
                    title={e.outside ? 'Members can use it anywhere' : 'Only in this constellation'}
                    onClick={() => void change(e, { outside: !e.outside })}
                  >
                    {e.outside ? 'Everywhere' : 'Here only'}
                  </button>
                  <button
                    type="button"
                    className="es-remove"
                    aria-label={`Remove ${e.name}`}
                    title="Remove"
                    onClick={() => void remove(e)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="nw-note">
        PNG, JPG, GIF or WebP.{' '}
        {tab === 'emoji'
          ? 'Emoji up to 512 KB, shown at 128 px; names are 2–32 letters, numbers or _.'
          : 'Stickers up to 2 MB, shown at 320 px.'}{' '}
        Every picture is re-saved without its hidden details.
        {lists.canManage ? '' : ' People with “Manage emoji & stickers” can add more.'}
      </p>
      {draft && (
        <div
          className="nw-backdrop"
          onMouseDown={(ev) => ev.target === ev.currentTarget && setDraft(null)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="es-new-title" className="nw-dialog">
            <h2 id="es-new-title">New {tab === 'emoji' ? 'emoji' : 'sticker'}</h2>
            <div className="es-preview">
              <img
                src={draft.url}
                alt=""
                className={tab === 'emoji' ? 'es-img es-img--big' : 'es-img es-img--sticker'}
              />
              {tab === 'emoji' && (
                <div className="es-preview-line">
                  <span className="nw-item-meta">Preview in a message</span>
                  <span>
                    gg everyone <img src={draft.url} alt="" className="cemoji" />
                  </span>
                </div>
              )}
            </div>
            <label className="nw-label" htmlFor="es-name">
              NAME
            </label>
            <input
              id="es-name"
              className="es-input"
              value={tab === 'emoji' ? `:${draft.name}:` : draft.name}
              maxLength={tab === 'emoji' ? 34 : 30}
              onChange={(ev) =>
                setDraft({
                  ...draft,
                  name: tab === 'emoji' ? ev.target.value.replace(/:/g, '') : ev.target.value
                })
              }
            />
            {tab === 'emoji' && draft.name && !nameOk && (
              <span className="nw-note">2–32 letters, numbers or _.</span>
            )}
            <label className="nw-check">
              <input
                type="checkbox"
                checked={draft.outside}
                onChange={(ev) => setDraft({ ...draft, outside: ev.target.checked })}
              />
              Members can use it outside {c.name}
            </label>
            {tab === 'stickers' && draft.file.type !== 'image/gif' && (
              <label className="nw-check">
                <input
                  type="checkbox"
                  checked={draft.cutout}
                  onChange={(ev) => setDraft({ ...draft, cutout: ev.target.checked })}
                />
                Cut out the background (for photos)
              </label>
            )}
            <div className="nw-actions nw-actions--end">
              <button type="button" className="nw-btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="nw-btn nw-btn--primary"
                disabled={busy || !nameOk}
                onClick={() => void add()}
              >
                {busy ? 'Adding…' : tab === 'emoji' ? 'Add emoji' : 'Add sticker'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
