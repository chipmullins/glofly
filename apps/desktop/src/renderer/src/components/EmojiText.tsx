import { memo, useMemo } from 'react'
import { emojiUrl, splitEmoji } from '../lib/emoji'

/**
 * Text with its emoji shown as Twemoji pictures, so they look the same on every computer
 * (Windows can't show flag emoji on its own). Each picture's alt text is the emoji itself,
 * so selecting and copying still gives the real characters.
 */
function EmojiText({ text }: { text: string }): React.JSX.Element {
  const pieces = useMemo(() => splitEmoji(text), [text])
  return (
    <>
      {pieces.map((piece, i) =>
        piece.url ? (
          <img
            key={i}
            className="emoji"
            src={piece.url}
            alt={piece.text}
            draggable={false}
            loading="lazy"
          />
        ) : (
          piece.text
        )
      )}
    </>
  )
}

export default memo(EmojiText)

/** A single emoji as a picture (or as text if Twemoji doesn't have it). */
export function Emoji({
  emoji,
  className = 'emoji'
}: {
  emoji: string
  className?: string
}): React.JSX.Element {
  const url = emojiUrl(emoji)
  return url ? (
    <img
      className={className}
      src={url}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  ) : (
    <span className={className}>{emoji}</span>
  )
}
