import { useEffect, useRef, useState } from 'react'
import type { OverlaySettings } from '../../../preload/api-types'
import { getCallPrefs } from '../lib/callPrefs'
import { isMac, isWeb } from '../lib/platform'
import { CloseIcon } from './icons'
import './QuickSwitcher.css'

// 0.7.5 Ctrl+/ (⌘/ on a Mac): every keyboard shortcut Glofly really has, in one sheet. Only
// shortcuts that exist are listed; the push-to-talk and game overlay keys show the ones you
// picked in Settings.

type Line = { what: string; keys: string[][] }
type Section = { title: string; lines: Line[] }

export default function ShortcutSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ctrl = isMac ? '⌘' : 'Ctrl'
  const closeRef = useRef<HTMLButtonElement>(null)
  const [overlay, setOverlay] = useState<OverlaySettings | null>(null)
  const ptt = getCallPrefs()

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    if (!isWeb && window.glofly.platform === 'win32' && window.glofly.overlay) {
      void window.glofly.overlay.info().then((info) => {
        if (info?.supported && info.settings.enabled) setOverlay(info.settings)
      })
    }
    return () => {
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  const sections: Section[] = [
    {
      title: 'Anywhere',
      lines: [
        { what: 'Jump to a chat, friend, constellation or setting', keys: [[ctrl, 'K']] },
        { what: 'Show keyboard shortcuts', keys: [[ctrl, '/']] },
        { what: 'Close a menu, dialog or panel', keys: [['Esc']] }
      ]
    },
    {
      title: 'In a chat',
      lines: [
        { what: 'Send', keys: [['Enter']] },
        { what: 'New line', keys: [['Shift', 'Enter']] },
        { what: 'Edit your last message (message box empty)', keys: [['↑']] },
        { what: 'Cancel a reply', keys: [['Esc']] },
        { what: 'Pick someone to @mention', keys: [['↑'], ['↓'], ['Enter']] },
        { what: 'Search this chat', keys: [[ctrl, 'F']] },
        { what: 'Jump to the newest message (message list focused)', keys: [['End']] }
      ]
    },
    {
      title: 'Photo viewer',
      lines: [
        { what: 'Previous or next photo', keys: [['←'], ['→']] },
        { what: 'Zoom in, zoom out, fit', keys: [['+'], ['−'], ['0']] },
        { what: 'Close', keys: [['Esc']] }
      ]
    },
    {
      title: 'Watch Together (full screen)',
      lines: [
        { what: 'Play or pause', keys: [['Space'], ['K']] },
        { what: 'Back 10 seconds', keys: [['←'], ['J']] },
        { what: 'Forward 10 seconds', keys: [['→'], ['L']] }
      ]
    }
  ]
  const calls: Line[] = []
  if (ptt.inputMode === 'ptt') calls.push({ what: 'Push to talk (hold)', keys: [[ptt.pttLabel]] })
  if (overlay) {
    calls.push({ what: 'Open or close the game overlay', keys: [overlay.openKey.split('+')] })
    if (overlay.muteKey) {
      calls.push({ what: 'Mute in a call (in game)', keys: [overlay.muteKey.split('+')] })
    }
  }
  if (calls.length) sections.push({ title: 'Calls and games', lines: calls })

  return (
    <div
      className="qs-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="qs-panel qs-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qs-sheet-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          } else if (e.key === 'Tab') {
            // One button inside: focus stays on it.
            e.preventDefault()
            closeRef.current?.focus()
          }
        }}
      >
        <div className="qs-sheet-head">
          <h2 id="qs-sheet-title">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="qs-sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="qs-sheet-body">
          {sections.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.lines.map((l) => (
                <div className="qs-sheet-row" key={l.what}>
                  <span>{l.what}</span>
                  <span className="qs-sheet-keys">
                    {l.keys.map((combo, i) => (
                      <span key={i} className="qs-sheet-keys">
                        {i > 0 && <span aria-hidden="true">or</span>}
                        {combo.map((k, j) => (
                          <kbd key={j}>{k}</kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {ptt.inputMode !== 'ptt' && (
            <p className="qs-sheet-note">
              Push to talk can be turned on in Settings → Voice &amp; video → Input mode.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
