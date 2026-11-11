import { rulesOf } from '@glofly/shared/campfire/rulesData'
import { useEffect, useState } from 'react'
import { SRD_CREDIT, type SrdMonsterSummary, type Token } from '@glofly/shared/campfire/types'
import { crLabel } from '@glofly/shared/campfire/rules5e'
import { cf, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { useCf } from './ctx'
import { usePlace, usePlaceHidden } from './place'

// GM: put things on the map: characters' tokens, a token from a picture, and monsters from the
// compendium (SRD 5.1 stat blocks, ready to roll). "Place hidden" puts them on the GM layer.

export function AddPanel(): React.JSX.Element {
  const { t, say, openStatBlock } = useCf()
  const [q, setQ] = useState('')
  const [list, setList] = useState<SrdMonsterSummary[]>([])
  const [hidden, setHidden] = usePlaceHidden()
  const rules = rulesOf(t.campaign.settings)

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const r = await cf.get<{ monsters: SrdMonsterSummary[] }>(
        `/campfire/srd/monsters?q=${encodeURIComponent(q.trim())}&rules=${rules}`
      )
      if (r.ok) setList(r.data.monsters.slice(0, 40))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [q, rules])

  const place = usePlace()
  const placeHere = (body: Record<string, unknown>, cells = 1): Promise<Token | null> =>
    place(body, { cells, hidden })

  const onScene = new Set(t.tokens.map((x) => x.characterId).filter(Boolean))

  return (
    <section className="cf-panel" aria-label="Add to the map">
      <h2 className="cf-h2">Add to the map</h2>
      <label className="cf-check">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
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
                void placeHere({
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
          await placeHere({
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
            <button
              type="button"
              className="cf-list-title cf-list-title--button"
              aria-label={`${m.name}: open the stat block`}
              onClick={() => openStatBlock({ slug: m.slug })}
            >
              {m.name}
              <span className="cf-sub">
                CR {crLabel(m.cr)} · {m.size} {m.type}
              </span>
            </button>
            <button
              type="button"
              className="cf-ghost cf-small"
              aria-label={`Add ${m.name} to the map`}
              onClick={() =>
                void placeHere(
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
