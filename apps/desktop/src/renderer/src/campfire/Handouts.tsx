import { useEffect, useState } from 'react'
import type { Handout, HandoutShare } from '@glofly/shared/campfire/types'
import FormattedText from '../components/FormattedText'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { useCf } from './ctx'

// Handouts and the journal: GMs write them (formatted text, a picture) and share them with
// everyone, nobody yet, or chosen players; players read what's shared with them.

export function HandoutsPanel(): React.JSX.Element {
  const { t, isGm } = useCf()
  const [open, setOpen] = useState<string | 'new' | null>(null)
  if (open) return <HandoutView id={open} onBack={() => setOpen(null)} />
  return (
    <section className="cf-panel" aria-label="Handouts">
      <div className="cf-panel-head">
        <h2 className="cf-h2">Handouts</h2>
        {isGm && (
          <button type="button" className="cf-soft" onClick={() => setOpen('new')}>
            New handout
          </button>
        )}
      </div>
      {t.handouts.length === 0 && (
        <p className="cf-hint">
          {isGm ? 'Letters, maps and clues to hand the players.' : 'Nothing handed out yet.'}
        </p>
      )}
      <ul className="cf-list">
        {t.handouts.map((h) => (
          <li key={h.id}>
            <button type="button" className="cf-list-row" onClick={() => setOpen(h.id)}>
              {h.imageFileId ? (
                <img src={fileUrl(h.imageFileId)} alt="" className="cf-thumb" />
              ) : (
                <span className="cf-thumb cf-thumb--empty" aria-hidden="true" />
              )}
              <span className="cf-list-title">{h.title}</span>
              {isGm && (
                <span className="cf-badge">
                  {h.shared === 'all'
                    ? 'Everyone'
                    : h.shared === 'gm'
                      ? 'Only GMs'
                      : 'Some players'}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HandoutView({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const { t, isGm, say, me } = useCf()
  const [h, setH] = useState<Handout | null>(null)
  const [editing, setEditing] = useState(id === 'new')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [shared, setShared] = useState<HandoutShare>('gm')
  const [sharedWith, setSharedWith] = useState<string[]>([])
  const [imageFileId, setImageFileId] = useState<string | null>(null)
  const summary = t.handouts.find((x) => x.id === id)

  useEffect(() => {
    if (id === 'new') return
    void cf.get<Handout>(`/campfire/campaigns/${t.campaign.id}/handouts/${id}`).then((r) => {
      if (!r.ok) return say(r.message)
      setH(r.data)
      setTitle(r.data.title)
      setBody(r.data.body)
      setShared(r.data.shared)
      setSharedWith(r.data.sharedWith)
      setImageFileId(r.data.imageFileId)
    })
    // Reload when it changes (shared differently, edited).
  }, [id, t.campaign.id, summary?.updatedAt, say])

  const saveIt = async (): Promise<void> => {
    if (!title.trim()) return say('Give it a title.')
    const payload = { title: title.trim(), body, shared, sharedWith, imageFileId }
    const r =
      id === 'new'
        ? await cf.post<Handout>(`/campfire/campaigns/${t.campaign.id}/handouts`, payload)
        : await cf.patch<Handout>(`/campfire/campaigns/${t.campaign.id}/handouts/${id}`, payload)
    if (!r.ok) return say(r.message)
    setH(r.data)
    setEditing(false)
    if (id === 'new') onBack()
  }

  return (
    <section className="cf-panel" aria-label="Handout">
      <button type="button" className="cf-back" onClick={onBack}>
        ← Handouts
      </button>
      {editing && isGm ? (
        <form
          className="cf-form"
          onSubmit={(e) => {
            e.preventDefault()
            void saveIt()
          }}
        >
          <label className="cf-field">
            <span>Title</span>
            <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="cf-field">
            <span>Text (**bold**, *italic*, &gt; quotes)</span>
            <textarea
              className="cf-text cf-text--tall"
              value={body}
              maxLength={20000}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="cf-row-buttons">
            <button
              type="button"
              className="cf-ghost"
              onClick={async () => {
                const file = await pickFile(IMAGE_ACCEPT)
                if (!file) return
                const up = await uploadFile(t.campaign.id, 'handout', file)
                if (!up.ok) return say(up.message)
                setImageFileId(up.data.id)
              }}
            >
              {imageFileId ? 'Change picture' : 'Add a picture'}
            </button>
            {imageFileId && (
              <button type="button" className="cf-ghost" onClick={() => setImageFileId(null)}>
                Remove picture
              </button>
            )}
          </div>
          {imageFileId && <img className="cf-handout-img" src={fileUrl(imageFileId)} alt="" />}
          <fieldset className="cf-fieldset">
            <legend>Who sees it</legend>
            {(
              [
                ['gm', 'Only game masters (for now)'],
                ['all', 'Everyone at the table'],
                ['some', 'Chosen players']
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="cf-check">
                <input
                  type="radio"
                  name="share"
                  checked={shared === v}
                  onChange={() => setShared(v)}
                />
                {label}
              </label>
            ))}
            {shared === 'some' &&
              t.members
                .filter((m) => m.userId !== me.id)
                .map((m) => (
                  <label key={m.userId} className="cf-check cf-check--indent">
                    <input
                      type="checkbox"
                      checked={sharedWith.includes(m.userId)}
                      onChange={(e) =>
                        setSharedWith(
                          e.target.checked
                            ? [...sharedWith, m.userId]
                            : sharedWith.filter((x) => x !== m.userId)
                        )
                      }
                    />
                    {m.user?.displayName ?? 'Someone'}
                  </label>
                ))}
          </fieldset>
          <div className="cf-row-buttons">
            <button type="submit" className="cf-primary">
              {id === 'new' ? 'Save handout' : 'Save'}
            </button>
            {id !== 'new' && (
              <button type="button" className="cf-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : h ? (
        <article className="cf-handout">
          <h2 className="cf-h2">{h.title}</h2>
          {h.imageFileId && <img className="cf-handout-img" src={fileUrl(h.imageFileId)} alt="" />}
          <div className="cf-handout-body">
            <FormattedText
              text={h.body}
              renderText={(text, key) => <span key={key}>{text}</span>}
            />
          </div>
          {isGm && (
            <div className="cf-row-buttons">
              <button type="button" className="cf-ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
              {h.shared !== 'all' && (
                <button
                  type="button"
                  className="cf-primary"
                  onClick={async () => {
                    const r = await cf.patch<Handout>(
                      `/campfire/campaigns/${t.campaign.id}/handouts/${h.id}`,
                      { shared: 'all' }
                    )
                    if (!r.ok) say(r.message)
                    else setH(r.data)
                  }}
                >
                  Show everyone
                </button>
              )}
              <button
                type="button"
                className="cf-danger-ghost"
                onClick={async () => {
                  if (!window.confirm(`Delete "${h.title}"?`)) return
                  const r = await cf.del(`/campfire/campaigns/${t.campaign.id}/handouts/${h.id}`)
                  if (!r.ok) say(r.message)
                  else onBack()
                }}
              >
                Delete
              </button>
            </div>
          )}
        </article>
      ) : (
        <p className="cf-hint">Loading…</p>
      )}
    </section>
  )
}
