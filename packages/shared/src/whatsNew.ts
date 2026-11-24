// "What's new" (0.11.3). Every app (desktop, web, phones) carries these notes in its
// build. On start it compares the newest one it has with the newest one this device has shown:
// newer notes show once, then the device remembers. Brand-new accounts don't get them (the welcome
// flow is their introduction). Settings → About → What's new shows them again.
//
// Each release adds an entry at the TOP (newest first): plain words, what people can do now, not
// how it was built. Items can be limited to some apps (`on`); an entry with nothing for an app
// doesn't show there.

export type WhatsNewApp = 'desktop' | 'web' | 'phone'
export type WhatsNewItem = { title: string; text: string; on?: WhatsNewApp[] }
export type WhatsNewEntry = { version: string; date: string; headline: string; items: WhatsNewItem[] }

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.11.4',
    date: '2026-11-24',
    headline: 'Better fights on phones, roomier calls',
    items: [
      {
        title: 'Attack from your phone',
        text: 'In Campfire, tap a weapon, then the creature you want to hit. Rings show how far it reaches, and it only rolls if the target is in range. Bows show how many arrows you have left.',
        on: ['phone']
      },
      {
        title: 'Hide and show creatures',
        text: 'Game masters can pick a creature on the map and hide it from players, or show it again, right from the phone.',
        on: ['phone']
      },
      {
        title: 'Three-person calls side by side',
        text: 'With three people on a video call, the tiles sit side by side instead of stacked, so nobody gets squished.',
        on: ['phone']
      },
      {
        title: 'Faster GIFs',
        text: 'Popular GIFs and searches load quicker.'
      }
    ]
  },
  {
    version: '0.11.3',
    date: '2026-11-12',
    headline: 'Campfire got a lot better at fights',
    items: [
      {
        title: 'Attack the way you’d expect',
        text: 'Click a weapon, then the creature you want to hit. A box around you shows how far you reach, anything out of range fades, and it only rolls if they’re close enough. Bows past their normal range roll with disadvantage.',
        on: ['desktop', 'web']
      },
      {
        title: 'Roll your own initiative',
        text: 'When the game master starts a fight, monsters roll right away and you get a “Roll for initiative!” prompt. The turn order starts once everyone has rolled.'
      },
      {
        title: 'Starting gear by class',
        text: 'New characters pick their class’s starting equipment (or take the gold and shop for it), with a green “Added” on everything you’ve picked. The builder also tells you what’s left before Next.'
      },
      {
        title: 'Two hands, arrows and shields',
        text: 'Longswords and other versatile weapons have a two-handed attack. Bows and crossbows use up arrows and bolts from your pack, and two-handed weapons ask you to put the shield away first.'
      },
      {
        title: 'Smoother tokens',
        text: 'Tokens follow your mouse exactly and glide into place. Ctrl+Z puts back a move you didn’t mean.',
        on: ['desktop', 'web']
      },
      {
        title: 'For game masters',
        text: 'Hide or show a creature from its card (or press H), see every hidden creature in the Hidden menu, and choose whether to reveal hidden monsters when you roll initiative. Campaigns can be deleted from the campaign hub, and the roll history goes back much further.',
        on: ['desktop', 'web']
      }
    ]
  }
]

/** -1, 0 or 1, comparing "0.11.3"-style versions number by number. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** The newest notes this app carries (what a device has "seen" once it's shown them). */
export const latestWhatsNew = (): string | null => WHATS_NEW[0]?.version ?? null

/**
 * The notes to show for this app: newer than `seen` (at most three releases, newest first, only
 * the items for this app). `seen` null (a device that's never shown any): just the newest.
 */
export function whatsNewFor(app: WhatsNewApp, seen: string | null, notes: readonly WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  const fresh = seen ? notes.filter((n) => compareVersions(n.version, seen) > 0) : notes.slice(0, 1)
  return fresh
    .slice(0, 3)
    .map((n) => ({ ...n, items: n.items.filter((i) => !i.on || i.on.includes(app)) }))
    .filter((n) => n.items.length > 0)
}
