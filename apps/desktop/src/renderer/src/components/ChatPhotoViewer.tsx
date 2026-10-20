import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Attachment, Message, PublicUser } from '../../../preload/api-types'
import {
  clampPan,
  fitScale,
  photoSubtitle,
  stepZoom,
  toggleZoom,
  viewerPhotos,
  zoomAround,
  ZOOM_MAX,
  type ViewerPhoto
} from '@glofly/shared/photos'
import { photoUrl } from '../lib/attachments'
import { isWeb } from '../lib/platform'
import Avatar from './Avatar'
import { ChevronIcon, CloseIcon, DownloadIcon } from './icons'
import './ChatPhotoViewer.css'

// The photo viewer (0.7.5, PhotoViewer.dc.html, approved): who sent it and when, "3 of 12"
// through every photo in the loaded part of the chat, Show in chat, Save, zoom (wheel, − + Fit,
// double-click), drag to move, ← → and a strip of thumbnails. Esc closes. Opens with the
// approved spring (240 ms), closes in 160 ms; Reduce Motion fades only.

type Failure = (error: string, message: string) => void

const CLOSE_MS = 160
/** Space kept free on each side of a fitted photo for the ← → buttons */
const SIDE = 100

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export default function ChatPhotoViewer({
  conversationId,
  chatName,
  messages,
  start,
  fallback,
  personOf,
  nameOf,
  onShowInChat,
  onClose,
  onFailure
}: {
  conversationId: string
  /** Groups and nebulas: "· in <name>" (null in a 1-on-1) */
  chatName: string | null
  /** The chat's loaded messages: the viewer steps through all their photos */
  messages: Message[]
  /** The photo that was clicked */
  start: Attachment
  /** The clicked message's photos, used when that message isn't in `messages` (still sending) */
  fallback: Attachment[]
  personOf: (userId: string) => PublicUser | null
  nameOf: (userId: string) => string
  /** Scroll to that message and highlight it (the viewer has closed by then) */
  onShowInChat: (messageId: string) => void
  onClose: () => void
  onFailure: Failure
}): React.JSX.Element {
  const items = useMemo<(ViewerPhoto | { photo: Attachment; message: null })[]>(() => {
    const all = viewerPhotos(messages)
    if (all.some((p) => p.photo.id === start.id)) return all
    return fallback.map((photo) => ({ photo, message: null }))
  }, [messages, start.id, fallback])

  const [currentId, setCurrentId] = useState(start.id)
  const found = items.findIndex((p) => p.photo.id === currentId)
  const index = found < 0 ? 0 : found
  const item = items[index]
  const photo = item.photo
  const count = items.length

  const [closing, setClosing] = useState(false)
  const close = useCallback(
    (after?: () => void) => {
      if (closing) return
      if (reducedMotion()) {
        onClose()
        after?.()
        return
      }
      setClosing(true)
      setTimeout(() => {
        onClose()
        after?.()
      }, CLOSE_MS)
    },
    [closing, onClose]
  )

  // ---- zoom and pan ----
  const stageRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState<{ id: string; w: number; h: number } | null>(null)
  const size = useMemo(
    () =>
      natural?.id === photo.id
        ? { w: natural.w, h: natural.h }
        : { w: photo.width ?? 0, h: photo.height ?? 0 },
    [natural, photo.id, photo.width, photo.height]
  )
  const fit = fitScale(size, box)
  const [zoom, setZoom] = useState<number | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const scale = zoom ?? fit
  const percent = Math.round(scale * 100)

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    // Room for the arrows at the sides when the photo is fitted
    const measure = (): void =>
      setBox({ w: Math.max(0, el.clientWidth - 2 * SIDE), h: Math.max(0, el.clientHeight - 16) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const go = useCallback(
    (to: number) => {
      if (count < 2) return
      const next = items[(to + count) % count]
      setCurrentId(next.photo.id)
      setZoom(null)
      setPan({ x: 0, y: 0 })
    },
    [count, items]
  )

  const setScale = useCallback(
    (to: number | null, at = { x: 0, y: 0 }) => {
      if (to === null) {
        setZoom(null)
        setPan({ x: 0, y: 0 })
        return
      }
      const clamped = Math.min(ZOOM_MAX, Math.max(fit, to))
      setPan((p) => clampPan(zoomAround(p, scale, clamped, at), size, clamped, box))
      setZoom(clamped <= fit + 1e-6 ? null : clamped)
    },
    [fit, scale, size, box]
  )

  const pointFrom = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
  }

  // Wheel zooms around the pointer (needs a non-passive listener to stop the page scrolling).
  const wheelState = useRef({ scale, setScale })
  useEffect(() => {
    wheelState.current = { scale, setScale }
  })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const { scale: s, setScale: set } = wheelState.current
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))
      set(s * factor, pointFrom(e.clientX, e.clientY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null)
  const zoomed = zoom !== null

  // ---- keys, focus ----
  const rootRef = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const keyState = useRef({ go, index, close, setScale, scale, fit })
  useEffect(() => {
    keyState.current = { go, index, close, setScale, scale, fit }
  })
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      const k = keyState.current
      if (e.key === 'Escape') {
        e.preventDefault()
        k.close()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        k.go(k.index - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        k.go(k.index + 1)
      } else if (e.key === '+' || e.key === '=') {
        k.setScale(stepZoom(k.scale, k.fit, 1))
      } else if (e.key === '-') {
        k.setScale(stepZoom(k.scale, k.fit, -1))
      } else if (e.key === '0') {
        k.setScale(null)
      } else if (e.key === 'Tab') {
        // Keep focus inside the viewer
        const root = rootRef.current
        if (!root) return
        const focusables = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')]
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus()
    }
  }, [])

  // The current thumbnail stays in view
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  // ---- save ----
  const [savedTo, setSavedTo] = useState<{ id: string; path: string } | null>(null)
  async function download(): Promise<void> {
    const result = await window.glofly.files.save(conversationId, photo)
    if (!result.ok) {
      onFailure(result.error, result.message)
      return
    }
    const path = result.data?.path
    if (path) setSavedTo({ id: photo.id, path })
  }

  const [loadedId, setLoadedId] = useState<string | null>(null)
  const sender = item.message ? personOf(item.message.senderId) : null
  const senderName = item.message ? nameOf(item.message.senderId) : photo.name
  const subtitle = item.message ? photoSubtitle(item.message.createdAt, chatName) : ''
  const shown = { w: size.w * scale, h: size.h * scale }
  const hasSize = size.w > 0 && size.h > 0 && box.w > 0

  // On the page itself (not inside the chat), so it covers everything, the dock included
  return createPortal(
    <div
      ref={rootRef}
      className={closing ? 'cpv cpv--closing' : 'cpv'}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}${item.message ? ` from ${senderName}` : ''}`}
    >
      <div className="cpv-bar">
        {item.message ? (
          <Avatar
            id={item.message.senderId}
            name={senderName}
            avatarVersion={sender?.avatarVersion}
            size={40}
          />
        ) : null}
        <span className="cpv-title">
          <span className="cpv-name">{senderName}</span>
          {subtitle && <span className="cpv-sub">{subtitle}</span>}
        </span>
        {count > 1 && (
          <span className="cpv-count" aria-live="polite">
            {index + 1} of {count}
          </span>
        )}
        {item.message && (
          <button
            type="button"
            className="cpv-button cpv-button--text"
            onClick={() => {
              const id = item.message?.id
              close(id ? () => onShowInChat(id) : undefined)
            }}
          >
            Show in chat
          </button>
        )}
        {savedTo?.id === photo.id && isWeb ? (
          <span className="cpv-button cpv-button--text" role="status">
            Downloaded
          </span>
        ) : savedTo?.id === photo.id ? (
          <button
            type="button"
            className="cpv-button cpv-button--text"
            onClick={() => window.glofly.files.showInFolder(savedTo.path)}
          >
            Show in folder
          </button>
        ) : (
          <button
            type="button"
            className="cpv-button"
            aria-label="Save photo"
            title="Save"
            onClick={() => void download()}
          >
            <DownloadIcon size={20} strokeWidth={2} />
          </button>
        )}
        <button
          ref={closeButton}
          type="button"
          className="cpv-button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={() => close()}
        >
          <CloseIcon size={20} strokeWidth={2} />
        </button>
      </div>

      <div
        ref={stageRef}
        className={zoomed ? 'cpv-stage cpv-stage--zoomed' : 'cpv-stage'}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }
          if (zoomed) e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (zoomed) setPan(clampPan({ x: d.px + dx, y: d.py + dy }, size, scale, box))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          // A click on the dark area around a fitted photo closes, like before
          if (d && !d.moved && !zoomed && e.target === e.currentTarget) close()
        }}
        onDoubleClick={(e) => setScale(toggleZoom(zoom, fit), pointFrom(e.clientX, e.clientY))}
      >
        <div
          className="cpv-frame"
          key={photo.id}
          style={
            hasSize
              ? {
                  width: shown.w,
                  height: shown.h,
                  transform: `translate(${pan.x}px, ${pan.y}px)`
                }
              : undefined
          }
        >
          {loadedId !== photo.id && (
            <img
              className="cpv-preview"
              src={photoUrl(conversationId, photo.id, 'preview')}
              alt=""
              draggable={false}
            />
          )}
          <img
            className={loadedId === photo.id ? 'cpv-full cpv-full--loaded' : 'cpv-full'}
            src={photoUrl(conversationId, photo.id, 'full')}
            alt={photo.name}
            draggable={false}
            onLoad={(e) => {
              setLoadedId(photo.id)
              const img = e.currentTarget
              if (!photo.width || !photo.height) {
                setNatural({ id: photo.id, w: img.naturalWidth, h: img.naturalHeight })
              }
            }}
          />
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="cpv-step cpv-step--prev"
            aria-label="Previous photo"
            onClick={() => go(index - 1)}
          >
            <ChevronIcon direction="left" size={22} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="cpv-step cpv-step--next"
            aria-label="Next photo"
            onClick={() => go(index + 1)}
          >
            <ChevronIcon direction="right" size={22} strokeWidth={2.2} />
          </button>
        </>
      )}

      <div className="cpv-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={!zoomed}
          onClick={() => setScale(stepZoom(scale, fit, -1))}
        >
          −
        </button>
        <span className="cpv-zoom-value" aria-live="polite">
          {percent}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={scale >= ZOOM_MAX - 1e-6}
          onClick={() => setScale(stepZoom(scale, fit, 1))}
        >
          +
        </button>
        <button
          type="button"
          className="cpv-zoom-fit"
          aria-pressed={!zoomed}
          onClick={() => setScale(null)}
        >
          Fit
        </button>
      </div>

      {count > 1 && (
        <div className="cpv-strip" ref={stripRef} role="group" aria-label="All photos">
          {items.map((p, i) => (
            <button
              key={p.photo.id}
              type="button"
              className="cpv-thumb"
              aria-label={`Photo ${i + 1} of ${count}`}
              aria-current={i === index ? 'true' : undefined}
              tabIndex={i === index ? 0 : -1}
              onClick={() => go(i)}
            >
              <img
                src={photoUrl(conversationId, p.photo.id, 'preview')}
                alt=""
                loading="lazy"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
      <div className="cpv-hint" aria-hidden="true">
        Scroll to zoom · drag to move · ← → for more · Esc to close
      </div>
    </div>,
    document.body
  )
}
