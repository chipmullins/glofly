import { useEffect, useState } from 'react'
import { SRD_CREDIT, type SrdMonsterSummary, type Token } from '@glofly/shared/campfire/types'
import { crLabel } from '@glofly/shared/campfire/rules5e'
import { cf, HIDDEN_KEY, IMAGE_ACCEPT, pickFile, placeHidden, uploadFile } from './api'
import { useCf } from './ctx'
import { snapToken } from './geometry'

// GM: put things on the map: characters' tokens, a token from a picture, and monsters from the
// compendium (SRD 5.1 stat blocks, ready to roll). "Place hidden" puts them on the GM layer.

export function AddPanel(): React.JSX.Element {
  const { t, say, mapCenter, ctl, setSelectedId } = useCf()
  const [q, setQ] = useState('')
  const [list, setList] = useState<SrdMonsterSummary[]>([])
  const [hidden, setHidden] = useState(placeHidden)
  const scene = t.scene

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const r = await cf.get<{ monsters: SrdMonsterSummary[] }>(
        `/campfire/srd/monsters?q=${encodeURIComponent(q.trim())}`
      )
      if (r.ok) setList(r.data.monsters.slice(0, 40))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [q])

  const place = async (body: Record<string, unknown>, cells = 1): Promise<void> => {
    if (!scene) return say('Make a scene first.')
    const [cx, cy] = mapCenter()
    // A little spread, so a few in a row don't sit on top of each other.
    const n = t.tokens.length % 5
    const [x, y] = snapToken(
      cx - (cells * scene.grid.size) / 2 + n * scene.grid.size,
      cy - (cells * scene.grid.size) / 2,
      cells,
      cells,
      scene.grid
    )
    const r = await cf.post<Token>(`/campfire/scenes/${scene.id}/tokens`, {
      x,
      y,
      ...(hidden ? { layer: 'gm' } : {}),
      ...body
    })
    if (!r.ok) return say(r.message)
    ctl.upsertToken(r.data)
    setSelectedId(r.data.id)
  }

  const onScene = new Set(t.tokens.map((x) => x.characterId).filter(Boolean))

  return (
    <section className="cf-panel" aria-label="Add to the map">
      <h2 className="cf-h2">Add to the map</h2>
      <label className="cf-check">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => {
            setHidden(e.target.checked)
            localStorage.setItem(HIDDEN_KEY, e.target.checked ? '1' : '0')
          }}
        />
        Place hidden (GM layer: players don&apos;t see them)
      </label>

      <h3 className="cf-h3">Characters</h3>
      <ul className="cf-list">
        {t.characters.map((c) => (
          <li key={c.id} className="cf-list-row cf-list-row--static">
            <span className="cf-list-title">
              {c.name}{' '}
              <span className="cf-sub">{c.kind === 'pc' ? 'player character' : 'NPC'}</span>
            </span>
            <button
              type="button"
              className="cf-ghost cf-small"
              onClick={() =>
                void place({
                  characterId: c.id,
                  ...(c.portraitFileId ? { imageFileId: c.portraitFileId } : {}),
                  ...(c.ownerId ? { controlledBy: [c.ownerId] } : {}),
                  ...(c.kind === 'pc' ? { layer: 'tokens' } : {})
                })
              }
            >
              {onScene.has(c.id) ? 'Place another' : 'Place'}
            </button>
          </li>
        ))}
        {t.characters.length === 0 && (
          <li className="cf-hint">Players make their characters in the Sheet tab.</li>
        )}
      </ul>

      <h3 className="cf-h3">A token from a picture</h3>
      <button
        type="button"
        className="cf-ghost"
        onClick={async () => {
          const file = await pickFile(IMAGE_ACCEPT)
          if (!file) return
          const up = await uploadFile(t.campaign.id, 'token', file)
          if (!up.ok) return say(up.message)
          await place({
            imageFileId: up.data.id,
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 60)
          })
        }}
      >
        Upload a token picture
      </button>

      <h3 className="cf-h3">Monsters</h3>
      <input
        className="cf-search"
        aria-label="Find a monster"
        placeholder="Find a monster (goblin, ogre, dragon…)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="cf-list cf-monsters">
        {list.map((m) => (
          <li key={m.slug} className="cf-list-row cf-list-row--static">
            <span className="cf-list-title">
              {m.name}
              <span className="cf-sub">
                CR {crLabel(m.cr)} · {m.size} {m.type}
              </span>
            </span>
            <button
              type="button"
              className="cf-ghost cf-small"
              aria-label={`Add ${m.name} to the map`}
              onClick={() =>
                void place(
                  { srdMonster: m.slug },
                  { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[m.size] ?? 1
                )
              }
            >
              Add
            </button>
          </li>
        ))}
      </ul>
      <p className="cf-credit">{SRD_CREDIT}</p>
    </section>
  )
}
