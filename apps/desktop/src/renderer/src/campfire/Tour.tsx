import { useEffect, useLayoutEffect, useState } from 'react'
import { creditFor } from '@glofly/shared/campfire/rulesData'
import { useCf } from './ctx'
import { CfWindow } from './sheetBits'
import { campaignRules } from './rulesApi'
import './roundA.css'

// Round A: the first-time tour (approved board "Tour"): coach marks over the table that point at
// the real buttons (`data-tour` on them), one tour for players and one for game masters. Shown once
// per computer (localStorage), replayed from the table's "?" button, which also opens
// "How Campfire works". Nothing on the table changes while it runs.

type Mark = { at: string; title: string; text: string }

const PLAYER: Mark[] = [
  {
    at: 'sheet',
    title: 'Your sheet and portrait',
    text: 'Everything about your character lives here: hit points, attacks, spells and inventory. Click a number to roll it.'
  },
  {
    at: 'map',
    title: 'Move your token',
    text: 'Drag your token on the map. The ruler counts the feet as you drag. In a fight your game master may lock tokens until it’s your turn.'
  },
  {
    at: 'map',
    title: 'Target something',
    text: 'Double-click a creature to target it. Attacks you roll from the sheet go at your target, and the game master applies the damage.'
  },
  {
    at: 'turn',
    title: 'The turn order',
    text: 'Who goes when. On your turn a button says “End my turn”; press it when you’re done.'
  },
  {
    at: 'dice',
    title: 'Dice and secret rolls',
    text: 'Roll any dice here, or type /roll 1d20+5 in the call’s chat. Pick “Only the GM” for a secret roll.'
  },
  {
    at: 'tabs',
    title: 'Handouts and music',
    text: 'Letters, maps and pictures the game master shares show up in Handouts. Music plays for everyone at the table.'
  },
  {
    at: 'hub',
    title: 'The campaign hub',
    text: 'Between sessions: when the next one is, recaps, quests, the party’s loot and journal.'
  }
]
const GM: Mark[] = [
  {
    at: 'fog',
    title: 'Fog of war',
    text: 'Hide the map and reveal it as the party explores: a box, freehand, or corners. “See as a player” shows exactly what they see.'
  },
  {
    at: 'tabs',
    title: 'Add monsters and NPCs',
    text: 'The Add tab has the rules’ monsters and your own NPCs. Put them on the map hidden and reveal them when the party sees them.'
  },
  {
    at: 'turn',
    title: 'The turn order',
    text: 'Start a fight, roll initiative for everyone and step through turns with Next turn.'
  },
  {
    at: 'map',
    title: 'Approving damage',
    text: 'When a player hits, the damage waits for you here: apply it, change it or skip it. You can turn that off in the campaign settings.'
  },
  {
    at: 'draw',
    title: 'Map builder and scenes',
    text: 'Build maps room by room with walls, doors and lights, or upload pictures. Switch scenes from the top bar.'
  },
  {
    at: 'hub',
    title: 'The campaign hub',
    text: 'Plan sessions (players get reminders), write recaps, track quests and loot, and keep your homebrew. Settings are there too.'
  }
]

const key = (gm: boolean): string => `campfire.tour.${gm ? 'gm' : 'player'}`
export const tourSeen = (gm: boolean): boolean => {
  try {
    return localStorage.getItem(key(gm)) === 'done'
  } catch {
    return true
  }
}
const markSeen = (gm: boolean): void => {
  try {
    localStorage.setItem(key(gm), 'done')
  } catch {
    /* private window: shows again next time */
  }
}

export function Tour({
  onDone,
  onHelp,
  onPractice
}: {
  onDone: () => void
  onHelp: () => void
  onPractice: () => void
}): React.JSX.Element | null {
  const { isGm } = useCf()
  const marks = isGm ? GM : PLAYER
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const mark = marks[i]

  const finish = (): void => {
    markSeen(isGm)
    onDone()
  }
  useLayoutEffect(() => {
    const find = (): void => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${mark.at}"]`)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    find()
    window.addEventListener('resize', find)
    return () => window.removeEventListener('resize', find)
  }, [mark.at])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') setI((n) => Math.min(marks.length - 1, n + 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The card sits beside the thing it points at (below it, or to its left near the right edge).
  const W = 420
  const pad = 14
  let left = window.innerWidth / 2 - W / 2
  let top = window.innerHeight / 2 - 120
  if (rect) {
    const big = rect.width > window.innerWidth * 0.5
    if (big) {
      left = rect.left + 24
      top = rect.top + 24
    } else if (rect.left > window.innerWidth / 2) {
      left = rect.left - W - pad
      top = rect.top
    } else {
      left = rect.right + pad
      top = rect.top
    }
    left = Math.max(12, Math.min(window.innerWidth - W - 12, left))
    top = Math.max(12, Math.min(window.innerHeight - 280, top))
  }

  return (
    <div
      className="cfa-tour-dim"
      style={{ position: 'fixed', zIndex: 60 }}
      role="dialog"
      aria-modal="true"
      aria-label={`Campfire tour, step ${i + 1} of ${marks.length}`}
    >
      {rect ? (
        <div
          className="cfa-tour-ring"
          style={{
            position: 'fixed',
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8
          }}
        />
      ) : (
        <div
          className="cfa-tour-ring"
          style={{ position: 'fixed', left: '50%', top: '50%', width: 0, height: 0 }}
        />
      )}
      <div className="cfa-coach" style={{ position: 'fixed', left, top, pointerEvents: 'auto' }}>
        <div className="cfa-coach-top">
          <span className="cfa-kicker">
            {isGm ? 'Game master tour' : 'Your first time at a table'} · Step {i + 1} of{' '}
            {marks.length}
          </span>
          <span className="cfa-dots" aria-hidden="true">
            {marks.map((_, n) => (
              <span key={n} className={n < i ? 'cfa-dot-done' : n === i ? 'cfa-dot-on' : ''} />
            ))}
          </span>
        </div>
        <h2>{mark.title}</h2>
        <p>{mark.text}</p>
        <div className="cfa-coach-buttons">
          <button type="button" className="cf-link" onClick={finish}>
            Skip the tour
          </button>
          <button type="button" className="cf-link" onClick={onHelp} style={{ marginLeft: 12 }}>
            How Campfire works
          </button>
          {!isGm && i === 0 && (
            <button
              type="button"
              className="cf-link"
              onClick={() => {
                markSeen(isGm)
                onPractice()
              }}
              style={{ marginLeft: 12 }}
            >
              Practice first
            </button>
          )}
          <span className="cfa-push" />
          <button type="button" className="cf-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          <button
            type="button"
            className="cf-primary"
            autoFocus
            onClick={() => (i === marks.length - 1 ? finish() : setI(i + 1))}
          >
            {i === marks.length - 1 ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "How Campfire works": the whole thing on one page. */
export function HowCampfireWorks({
  onClose,
  onTour,
  onPractice
}: {
  onClose: () => void
  onTour: () => void
  onPractice: () => void
}): React.JSX.Element {
  const { t, isGm } = useCf()
  return (
    <CfWindow label="How Campfire works" onClose={onClose} className="cfa-window--mid">
      <div className="cfa-pad" style={{ overflow: 'auto' }}>
        <div className="cfa-help">
          <span className="cfa-kicker">Help</span>
          <h1 style={{ margin: 0, color: 'var(--cf-ink)' }}>How Campfire works</h1>
          <p>
            Campfire is a 5e tabletop inside your Glofly call: a shared map, character sheets, dice
            and a turn order. The game master runs it; everyone else plays a character.
          </p>
          <h2>Characters</h2>
          <p>
            The character builder walks you through species, class, background, ability scores and
            spells. Coming from somewhere else? Import a character sheet PDF (from another app’s
            “Export to PDF”, or any filled-in 5e sheet), or copy the numbers in from another sheet.
            Level up from the sheet’s header when your game master says so.
          </p>
          <h2>The map</h2>
          <p>
            Drag your token to move; the ruler counts feet. Double-click a creature to target it.
            Ping a spot so others see where you mean. The fog of war hides what your character
            hasn’t seen yet: the server never sends it to you.
          </p>
          <h2>Rolling</h2>
          <p>
            Click any number on your sheet to roll it, use the dice tray, or type /roll in the
            call’s chat. Rolls can go to everyone, only the game master, or a whisper. Hits go to
            the game master, who applies the damage (or it lands at once if they turned that off).
          </p>
          <h2>Fights</h2>
          <p>
            The game master starts the fight and everyone rolls initiative. On your turn the top bar
            says so; press “End my turn” when you’re done. Your game master may lock tokens to their
            turn.
          </p>
          <h2>Between sessions</h2>
          <p>
            The campaign hub has the next session (say if you’re coming; you get a reminder a day
            before and half an hour before), recaps, quests, the party’s loot and journal, and the
            game master’s homebrew they’ve shared.
          </p>
          {isGm && (
            <>
              <h2>Running the table</h2>
              <p>
                Add monsters from the rules or make your own NPCs; put them on the map hidden. Build
                maps with the map builder or upload pictures. The hub’s Settings change the rules
                set, damage approval, what players see of monster health, rolls, leveling and
                diagonals.
              </p>
            </>
          )}
          <p>
            <button type="button" className="cf-ghost" onClick={onTour}>
              Take the tour again
            </button>{' '}
            <button type="button" className="cf-ghost" onClick={onPractice}>
              Open the practice table
            </button>
          </p>
          <p className="cf-sub">{creditFor(campaignRules(t.campaign.settings))}</p>
        </div>
      </div>
    </CfWindow>
  )
}
