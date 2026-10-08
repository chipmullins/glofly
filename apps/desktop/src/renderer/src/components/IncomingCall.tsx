import { useEffect, useRef, useState } from 'react'
import type { IncomingCallInfo } from '../calls/callState'
import Avatar from './Avatar'
import { HangUpIcon, MessageBubbleIcon, MicIcon, PhoneIcon, VideoIcon } from './icons'

// Someone is calling you (Incoming.dc.html): their face with the firefly glow rings, and
// Video / Voice only / Decline. "Decline with a message" sends a quick reply first.

const QUICK_REPLIES = [
  "Can't talk right now. I'll call you back soon.",
  'In the middle of something. Give me a few minutes!',
  "Can't talk, but I can text."
]
const REPLY_MAX = 300

type IncomingCallProps = {
  info: IncomingCallInfo
  /** You're already in a call (answering means hanging that one up first) */
  busy: boolean
  onAnswer: (video: boolean) => void
  onDecline: (message?: string) => void
}

export default function IncomingCall({
  info,
  busy,
  onAnswer,
  onDecline
}: IncomingCallProps): React.JSX.Element {
  const { call, caller } = info
  const [replying, setReplying] = useState(false)
  const [custom, setCustom] = useState('')
  const firstButton = useRef<HTMLButtonElement>(null)
  const kind = call.video ? 'video' : 'voice'

  useEffect(() => {
    firstButton.current?.focus()
  }, [replying])

  // Escape declines (or backs out of picking a message).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (replying) setReplying(false)
      else onDecline()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [replying, onDecline])

  return (
    <div className="incoming-backdrop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Incoming ${kind} call from ${caller.displayName}`}
        className="incoming"
      >
        <div className="incoming-kind">
          {call.video ? (
            <VideoIcon size={16} strokeWidth={2} />
          ) : (
            <PhoneIcon size={16} strokeWidth={2} />
          )}
          Incoming {kind} call
        </div>

        <div className="call-glow-face call-glow-face--incoming">
          <span className="call-ring" aria-hidden="true" />
          <span className="call-ring call-ring--late" aria-hidden="true" />
          <Avatar
            id={caller.id}
            name={caller.displayName}
            avatarVersion={caller.avatarVersion}
            size={104}
            className="call-glow-photo"
          />
        </div>

        <div className="incoming-who">
          <h2>{caller.displayName}</h2>
          <span>
            {busy ? 'is calling you. Answering hangs up your current call.' : 'is calling you…'}
          </span>
        </div>

        {replying ? (
          <div className="incoming-replies">
            {QUICK_REPLIES.map((text, i) => (
              <button
                key={text}
                ref={i === 0 ? firstButton : undefined}
                type="button"
                className="incoming-reply"
                onClick={() => onDecline(text)}
              >
                {text}
              </button>
            ))}
            <form
              className="incoming-custom"
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) onDecline(custom.trim())
              }}
            >
              <input
                type="text"
                aria-label="Your own message"
                placeholder="Write your own…"
                maxLength={REPLY_MAX}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button type="submit" disabled={!custom.trim()}>
                Send
              </button>
            </form>
            <button type="button" className="incoming-back" onClick={() => setReplying(false)}>
              Back
            </button>
          </div>
        ) : (
          <>
            <div
              className={call.video ? 'incoming-actions' : 'incoming-actions incoming-actions--two'}
            >
              {call.video && (
                <div className="incoming-action">
                  <button
                    ref={firstButton}
                    type="button"
                    className="incoming-answer"
                    aria-label="Answer with video"
                    onClick={() => onAnswer(true)}
                  >
                    <VideoIcon size={26} strokeWidth={2} />
                  </button>
                  <span>Video</span>
                </div>
              )}
              <div className="incoming-action">
                <button
                  ref={call.video ? undefined : firstButton}
                  type="button"
                  className="incoming-answer"
                  aria-label={call.video ? 'Answer with voice only' : 'Answer'}
                  onClick={() => onAnswer(false)}
                >
                  <MicIcon size={26} strokeWidth={2} />
                </button>
                <span>{call.video ? 'Voice only' : 'Answer'}</span>
              </div>
              <div className="incoming-action">
                <button
                  type="button"
                  className="incoming-decline"
                  aria-label="Decline call"
                  onClick={() => onDecline()}
                >
                  <HangUpIcon size={26} />
                </button>
                <span>Decline</span>
              </div>
            </div>
            <button type="button" className="incoming-message" onClick={() => setReplying(true)}>
              <MessageBubbleIcon />
              Decline with a message
            </button>
          </>
        )}
      </div>
    </div>
  )
}
