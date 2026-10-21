// Keyboard shortcuts: one list for the desktop / browser sheet (Ctrl+/ or ⌘/) and the tablet one
// (iPad with a keyboard, Android tablets and Chromebooks; 0.8.0). Each line says where it really
// exists, so a sheet only lists shortcuts its app has.

export type ShortcutApp = 'desktop' | 'tablet'

/** How the modifier keys are written: desktop Mac / iPad "⌘" and "⌥", elsewhere "Ctrl" and "Alt". */
export type ShortcutKeys = { mod: string; alt: string }

export type ShortcutLine = { what: string; keys: string[][] }
export type ShortcutSection = { title: string; lines: ShortcutLine[] }

type Line = { what: string; keys: (k: ShortcutKeys) => string[][]; on: ShortcutApp[] }
type Section = { title: string; lines: Line[] }

const BOTH: ShortcutApp[] = ['desktop', 'tablet']

const SECTIONS: Section[] = [
  {
    title: 'Anywhere',
    lines: [
      { what: 'Jump to a chat, friend, constellation or setting', keys: (k) => [[k.mod, 'K']], on: BOTH },
      { what: 'Show keyboard shortcuts', keys: (k) => [[k.mod, '/']], on: BOTH },
      { what: 'New message', keys: (k) => [[k.mod, 'N']], on: ['tablet'] },
      { what: 'Close a menu, dialog or panel', keys: () => [['Esc']], on: BOTH },
    ],
  },
  {
    title: 'In a chat',
    lines: [
      { what: 'Send', keys: () => [['Enter']], on: ['desktop'] },
      { what: 'New line', keys: () => [['Shift', 'Enter']], on: ['desktop'] },
      { what: 'Edit your last message (message box empty)', keys: () => [['↑']], on: BOTH },
      { what: 'Cancel a reply', keys: () => [['Esc']], on: BOTH },
      { what: 'Pick someone to @mention', keys: () => [['↑'], ['↓'], ['Enter']], on: ['desktop'] },
      { what: 'Search this chat', keys: (k) => [[k.mod, 'F']], on: BOTH },
      { what: 'Jump to the newest message (message list focused)', keys: () => [['End']], on: ['desktop'] },
    ],
  },
  {
    title: 'Constellations',
    lines: [{ what: 'Previous or next nebula', keys: (k) => [[k.alt, '↑'], [k.alt, '↓']], on: BOTH }],
  },
  {
    title: 'Photo viewer',
    lines: [
      { what: 'Previous or next photo', keys: () => [['←'], ['→']], on: ['desktop'] },
      { what: 'Zoom in, zoom out, fit', keys: () => [['+'], ['−'], ['0']], on: ['desktop'] },
      { what: 'Close', keys: () => [['Esc']], on: ['desktop'] },
    ],
  },
  {
    title: 'Watch Together (full screen)',
    lines: [
      { what: 'Play or pause', keys: () => [['Space'], ['K']], on: ['desktop'] },
      { what: 'Back 10 seconds', keys: () => [['←'], ['J']], on: ['desktop'] },
      { what: 'Forward 10 seconds', keys: () => [['→'], ['L']], on: ['desktop'] },
    ],
  },
]

/** The sections for one app, with its modifier keys written in. Sections with nothing left go. */
export function shortcutSections(app: ShortcutApp, keys: ShortcutKeys): ShortcutSection[] {
  return SECTIONS.map((s) => ({
    title: s.title,
    lines: s.lines.filter((l) => l.on.includes(app)).map((l) => ({ what: l.what, keys: l.keys(keys) })),
  })).filter((s) => s.lines.length > 0)
}

/** The commands a tablet keyboard can send (modules/glofly-native KeyCommands). */
export type KeyCommandId = 'quick' | 'shortcuts' | 'newMessage' | 'find' | 'editLast' | 'escape' | 'prevNebula' | 'nextNebula'

export const KEY_COMMAND_IDS: KeyCommandId[] = ['quick', 'shortcuts', 'newMessage', 'find', 'editLast', 'escape', 'prevNebula', 'nextNebula']
