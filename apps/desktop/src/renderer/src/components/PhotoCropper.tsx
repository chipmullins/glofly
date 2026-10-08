import { useCallback, useEffect, useRef, useState } from 'react'

// Choose what's in your profile photo's circle: drag to move the photo, zoom with the slider,
// the mouse wheel or + / −. Apply draws exactly what's in the circle as a 512×512 picture,
// which is what the server keeps (so nothing gets cropped differently afterwards).

const FRAME = 320 // the crop area on screen, in px
const OUTPUT = 512 // the saved photo, in px (the server's size)
const MAX_ZOOM = 4

type PhotoCropperProps = {
  /** The picked photo (a data: URL) */
  src: string
  /** GIFs can be kept whole so they stay animated (cropping makes a still picture). */
  animated: boolean
  /** The cropped photo: WebP data plus a preview to show until Save. */
  onApply: (photo: { data: ArrayBuffer; preview: string }) => void
  /** Keep the GIF as it is (centered by the server, still animated). */
  onUseWhole: () => void
  onCancel: () => void
}

type View = { zoom: number; x: number; y: number }

export default function PhotoCropper({
  src,
  animated,
  onApply,
  onUseWhole,
  onCancel
}: PhotoCropperProps): React.JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // x, y: where the photo's center sits, relative to the circle's center (px on screen).
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number } | null>(
    null
  )

  /** At zoom 1 the photo just covers the circle's square. */
  const baseScale = natural ? Math.max(FRAME / natural.w, FRAME / natural.h) : 1

  /** Keeps the photo covering the whole circle (no empty edges). */
  const clamp = useCallback(
    (v: View): View => {
      if (!natural) return v
      const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom))
      const w = natural.w * baseScale * zoom
      const h = natural.h * baseScale * zoom
      const maxX = (w - FRAME) / 2
      const maxY = (h - FRAME) / 2
      return {
        zoom,
        x: Math.min(maxX, Math.max(-maxX, v.x)),
        y: Math.min(maxY, Math.max(-maxY, v.y))
      }
    },
    [natural, baseScale]
  )

  /** Zooms around the circle's center, keeping the same spot in the middle. */
  const zoomTo = useCallback(
    (zoom: number) =>
      setView((v) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, zoom))
        const ratio = next / v.zoom
        return clamp({ zoom: next, x: v.x * ratio, y: v.y * ratio })
      }),
    [clamp]
  )

  // Escape cancels the crop (and only the crop, not Edit profile underneath).
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  })
  useEffect(() => {
    frameRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // The mouse wheel zooms (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      setView((v) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, v.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
        const ratio = next / v.zoom
        return clamp({ zoom: next, x: v.x * ratio, y: v.y * ratio })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [clamp])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: view.x, y: view.y }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setView((v) => clamp({ ...v, x: d.x + e.clientX - d.startX, y: d.y + e.clientY - d.startY }))
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  // Arrow keys move the photo; + and − zoom.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const step = e.shiftKey ? 40 : 10
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    }
    if (moves[e.key]) {
      e.preventDefault()
      const [dx, dy] = moves[e.key]
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      zoomTo(view.zoom * 1.1)
    } else if (e.key === '-') {
      e.preventDefault()
      zoomTo(view.zoom / 1.1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void apply()
    }
  }

  async function apply(): Promise<void> {
    const img = imgRef.current
    if (!img || !natural || busy) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setBusy(false)
      setFailed(true)
      return
    }
    const k = OUTPUT / FRAME
    const w = natural.w * baseScale * view.zoom
    const h = natural.h * baseScale * view.zoom
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      img,
      (FRAME / 2 - w / 2 + view.x) * k,
      (FRAME / 2 - h / 2 + view.y) * k,
      w * k,
      h * k
    )
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.92)
    )
    if (!blob) {
      setBusy(false)
      setFailed(true)
      return
    }
    onApply({ data: await blob.arrayBuffer(), preview: canvas.toDataURL('image/webp', 0.92) })
  }

  const w = natural ? natural.w * baseScale * view.zoom : FRAME
  const h = natural ? natural.h * baseScale * view.zoom : FRAME

  return (
    <div
      className="dialog-backdrop crop-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        className="dialog dialog--panel crop-dialog"
      >
        <div className="dialog-head">
          <h1 id="crop-title">Position your photo</h1>
          <p>Drag to move it. Zoom with the slider or your mouse wheel.</p>
        </div>

        <div className="crop-stage">
          <div
            ref={frameRef}
            className="crop-frame"
            style={{ width: FRAME, height: FRAME }}
            tabIndex={0}
            role="application"
            aria-label="Photo position. Arrow keys move it, plus and minus zoom, Enter applies."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              className="crop-image"
              style={{
                width: w,
                height: h,
                left: FRAME / 2 - w / 2 + view.x,
                top: FRAME / 2 - h / 2 + view.y,
                visibility: natural ? 'visible' : 'hidden'
              }}
              onLoad={(e) => {
                const el = e.currentTarget
                setNatural({ w: el.naturalWidth, h: el.naturalHeight })
                setView({ zoom: 1, x: 0, y: 0 })
              }}
              onError={() => setFailed(true)}
            />
            <span className="crop-mask" aria-hidden="true" />
          </div>
        </div>

        <div className="crop-zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomTo(view.zoom / 1.2)}>
            −
          </button>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
          />
          <button type="button" aria-label="Zoom in" onClick={() => zoomTo(view.zoom * 1.2)}>
            +
          </button>
        </div>

        {failed && (
          <p className="dialog-message" role="alert">
            Couldn&apos;t open that photo. Try another one.
          </p>
        )}
        {animated && (
          <p className="crop-note">
            Cropping makes a still picture. Use the whole GIF to keep it animated.
          </p>
        )}

        <div className="dialog-foot">
          {animated && (
            <button
              type="button"
              className="small-button small-button--quiet crop-whole"
              onClick={onUseWhole}
            >
              Use whole GIF
            </button>
          )}
          <button type="button" className="small-button small-button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={!natural || busy}
            onClick={() => void apply()}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
