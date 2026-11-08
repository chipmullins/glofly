import type { FormatAction } from '@glofly/shared/format'
import { shortcutLabel } from '../lib/platform'

/**
 * The formatting bar above the message box while text is selected (0.9.3, approved board 3).
 * Buttons keep the box focused (mousedown is stopped) so the selection survives the click.
 */
export default function FormatBar({
  onFormat
}: {
  onFormat: (action: FormatAction) => void
}): React.JSX.Element {
  const item = (action: FormatAction, label: string, keys: string | null, icon: React.ReactNode) => (
    <button
      key={action}
      type="button"
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onFormat(action)}
    >
      {icon}
    </button>
  )
  return (
    <div className="fmt-toolbar" role="toolbar" aria-label="Formatting">
      {item('b', 'Bold', shortcutLabel('B'), <b style={{ fontSize: 16 }}>B</b>)}
      {item('i', 'Italic', shortcutLabel('I'), <i style={{ fontSize: 16, fontFamily: 'Georgia, serif' }}>I</i>)}
      {item('s', 'Strikethrough', shortcutLabel('Shift+X'), <s style={{ fontSize: 16 }}>S</s>)}
      {item('code', 'Code', null, <span className="fmt-toolbar-mono">&lt;/&gt;</span>)}
      {item(
        'spoiler',
        'Spoiler',
        null,
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
          <path d="M4 20 20 4" />
        </svg>
      )}
      {item(
        'quote',
        'Quote',
        null,
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 7h4v4c0 3-2 5-4 6l-1-1.5c1.3-.8 2-2 2-3.5H7zM14 7h4v4c0 3-2 5-4 6l-1-1.5c1.3-.8 2-2 2-3.5h-1z" />
        </svg>
      )}
      {item(
        'codeblock',
        'Code block',
        null,
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="m9 10-2 2 2 2M15 10l2 2-2 2" />
        </svg>
      )}
    </div>
  )
}
