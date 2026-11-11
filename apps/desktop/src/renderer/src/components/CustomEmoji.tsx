import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { splitEmoji, type EmojiInfo, type EmojiRef } from '@glofly/shared'
import { emojiUrl } from '../lib/media'
import { emojiApi } from '../lib/customEmoji'
import './CustomEmoji.css'

// Communities round 2 (approved board 2b): a constellation's custom emoji in messages and
// reactions, and the "From Night Raiders" card when you click one.

export function CustomEmojiImg({
  emoji,
  size,
  className
}: {
  emoji: Pick<EmojiRef, 'id' | 'name'>
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <img
      className={className ?? 'cemoji'}
      src={emojiUrl(emoji.id)}
      alt={`:${emoji.name}:`}
      title={`:${emoji.name}:`}
      draggable={false}
      loading="lazy"
      style={size ? { width: size, height: size } : undefined}
    />
  )
}

/** Text with `:name:` turned into pictures (clicking one tells where it's from). */
export function WithCustomEmoji({
  text,
  refs,
  renderText,
  jumbo
}: {
  text: string
  refs: EmojiRef[] | undefined
  renderText: (text: string, key: string) => ReactNode
  jumbo?: boolean
}): React.JSX.Element {
  if (!refs?.length) return <>{renderText(text, 't')}</>
  return (
    <>
      {splitEmoji(text, refs).map((p, i) =>
        'text' in p ? (
          renderText(p.text, `t${i}`)
        ) : (
          <EmojiButton key={`e${i}`} emoji={p.emoji} jumbo={jumbo} />
        )
      )}
    </>
  )
}

function EmojiButton({ emoji, jumbo }: { emoji: EmojiRef; jumbo?: boolean }): React.JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button
        type="button"
        className={jumbo ? 'cemoji-btn cemoji-btn--jumbo' : 'cemoji-btn'}
        aria-label={`:${emoji.name}:, custom emoji`}
        onClick={(e) => {
          e.stopPropagation()
          const el = e.currentTarget
          setAnchor((a) => (a ? null : el))
        }}
      >
        <CustomEmojiImg emoji={emoji} className={jumbo ? 'cemoji cemoji--jumbo' : 'cemoji'} />
      </button>
      {anchor && <EmojiCard emojiId={emoji.id} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  )
}

function EmojiCard({
  emojiId,
  anchor,
  onClose
}: {
  emojiId: string
  anchor: HTMLElement
  onClose: () => void
}): React.JSX.Element {
  const [info, setInfo] = useState<EmojiInfo | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void emojiApi.info(emojiId).then((r) => r.ok && setInfo(r.data))
  }, [emojiId])
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])
  const box = anchor.getBoundingClientRect()
  const top = Math.min(window.innerHeight - 180, box.bottom + 6)
  const left = Math.max(8, Math.min(window.innerWidth - 292, box.left - 20))
  return createPortal(
    <div
      ref={ref}
      className="cemoji-card"
      role="dialog"
      aria-label="Custom emoji"
      style={{ top, left }}
    >
      {info ? (
        <>
          <div className="cemoji-card-head">
            <CustomEmojiImg emoji={info} className="cemoji cemoji--card" />
            <div>
              <b>:{info.name}:</b>
              <span>
                {info.constellation
                  ? `From ${info.constellation.name}`
                  : 'From a private constellation'}
              </span>
            </div>
          </div>
          {!info.member && (
            <p>
              {info.constellation?.public
                ? `Join ${info.constellation.name} to use it yourself. Emoji are free on Glofly.`
                : 'Members of its constellation can use it anywhere on Glofly, for free.'}
            </p>
          )}
        </>
      ) : (
        <p>Loading…</p>
      )}
    </div>,
    document.body
  )
}
