import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../preload/api-types'
import {
  fileTypeLabel,
  formatSize,
  photoUrl,
  posterUrl,
  videoUrl,
  voiceUrl
} from '../lib/attachments'
import { isWeb } from '../lib/platform'
import { playVoice, stopVoice, voiceTime } from '../lib/voice'
import { ChevronIcon, CloseIcon, DownloadIcon, FileIcon, PhotoIcon } from './icons'
import './Attachments.css'

// Photos and files in chats: how they look in a message, the full-size photo viewer,
// and the tray of files waiting to be sent.

type Failure = (error: string, message: string) => void

/** Saves an attachment (asks where first). Returns where it went, or null if cancelled/failed. */
async function save(
  conversationId: string,
  attachment: Attachment,
  onFailure: Failure
): Promise<string | null> {
  const result = await window.glofly.files.save(conversationId, attachment)
  if (!result.ok) {
    onFailure(result.error, result.message)
    return null
  }
  return result.data?.path ?? null
}

// Photos in a message are shown up to this size (one photo), or as square tiles (several).
const SINGLE_MAX_W = 360
const SINGLE_MAX_H = 320
const TILE = 176

function singleSize(a: Attachment): { width: number; height: number } {
  const w = a.width ?? a.video?.width ?? SINGLE_MAX_W
  const h = a.height ?? a.video?.height ?? SINGLE_MAX_H
  const scale = Math.min(SINGLE_MAX_W / w, SINGLE_MAX_H / h, 1)
  return { width: Math.max(80, Math.round(w * scale)), height: Math.max(60, Math.round(h * scale)) }
}

/** A photo that shows a quiet placeholder if it can't be loaded. */
function Photo({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) {
    return (
      <span className="photo-missing">
        <PhotoIcon size={22} />
        Photo unavailable
      </span>
    )
  }
  return (
    <img src={src} alt={alt} draggable={false} loading="lazy" onError={() => setFailedSrc(src)} />
  )
}

function FileCard({
  conversationId,
  attachment,
  onFailure
}: {
  conversationId: string
  attachment: Attachment
  onFailure: Failure
}): React.JSX.Element {
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function download(): Promise<void> {
    setSaving(true)
    const path = await save(conversationId, attachment, onFailure)
    setSaving(false)
    if (path) setSavedTo(path)
  }

  return (
    <div className="file-card">
      <span className="file-card-icon" aria-hidden="true">
        <FileIcon size={22} />
      </span>
      <span className="file-card-text">
        <span className="file-card-name" title={attachment.name}>
          {attachment.name}
        </span>
        <span className="file-card-meta">
          {savedTo && isWeb ? (
            // A browser keeps its downloads itself (its Downloads list has "Show in folder").
            'Downloaded'
          ) : savedTo ? (
            <>
              Saved ·{' '}
              <button type="button" onClick={() => window.glofly.files.showInFolder(savedTo)}>
                Show in folder
              </button>
            </>
          ) : (
            `${fileTypeLabel(attachment.name)} · ${formatSize(attachment.size)}`
          )}
        </span>
      </span>
      <button
        type="button"
        className="file-card-download"
        aria-label={`Download ${attachment.name}`}
        title="Download"
        disabled={saving}
        onClick={() => void download()}
      >
        <DownloadIcon size={19} strokeWidth={2} />
      </button>
    </div>
  )
}

/** The photos and files of one message. */
export function MessageAttachments({
  conversationId,
  attachments,
  onOpenPhoto,
  onFailure
}: {
  conversationId: string
  attachments: Attachment[]
  onOpenPhoto: (photos: Attachment[], index: number) => void
  onFailure: Failure
}): React.JSX.Element {
  const photos = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind === 'file' && !a.voice && !a.video)
  const voices = attachments.filter((a) => a.kind === 'file' && a.voice)
  const videos = attachments.filter((a) => a.kind === 'file' && a.video)
  const single = photos.length === 1 ? singleSize(photos[0]) : null

  return (
    <div className="attachments">
      {photos.length > 0 && (
        <div className={single ? 'photo-grid photo-grid--single' : 'photo-grid'}>
          {photos.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className="photo-tile"
              style={single ?? { width: TILE, height: TILE }}
              aria-label={`Open photo ${a.name}`}
              title={a.name}
              onClick={() => onOpenPhoto(photos, i)}
            >
              <Photo src={photoUrl(conversationId, a.id, 'preview')} alt={a.name} />
            </button>
          ))}
        </div>
      )}
      {videos.map((a) => (
        <VideoTile
          key={a.id}
          conversationId={conversationId}
          attachment={a}
          onFailure={onFailure}
        />
      ))}
      {voices.map((a) => (
        <VoiceBubble key={a.id} conversationId={conversationId} attachment={a} />
      ))}
      {files.map((a) => (
        <FileCard key={a.id} conversationId={conversationId} attachment={a} onFailure={onFailure} />
      ))}
    </div>
  )
}

/**
 * A video (0.5.0): its picture with a play button and its length; pressing play plays it right
 * there (streamed as it loads, with the player's own controls, full screen included).
 */
function VideoTile({
  conversationId,
  attachment,
  onFailure
}: {
  conversationId: string
  attachment: Attachment
  onFailure: Failure
}): React.JSX.Element {
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const size = singleSize(attachment)
  const seconds = Math.round((attachment.video?.durationMs ?? 0) / 1000)
  const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  if (failed) {
    return (
      <div className="video-tile video-tile--failed" style={size}>
        <span>This video can&apos;t play here.</span>
        <button
          type="button"
          onClick={() => void save(conversationId, attachment, onFailure)}
          className="video-tile-save"
        >
          <DownloadIcon size={16} strokeWidth={2} /> Download it
        </button>
      </div>
    )
  }
  return (
    <div className="video-tile" style={size}>
      {playing ? (
        <video
          src={videoUrl(conversationId, attachment.id)}
          poster={posterUrl(conversationId, attachment.id)}
          controls
          autoPlay
          playsInline
          preload="metadata"
          aria-label={attachment.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <button
          type="button"
          className="video-tile-start"
          aria-label={`Play video ${attachment.name} (${length})`}
          onClick={() => setPlaying(true)}
        >
          <Photo src={posterUrl(conversationId, attachment.id)} alt="" />
          <span className="video-tile-play" aria-hidden="true">
            <PlayIcon />
          </span>
          <span className="video-tile-length">{length}</span>
        </button>
      )}
    </div>
  )
}

/**
 * A voice message: play / pause, its waveform (click or drag along it to jump), and the
 * time (its length, or where it's at while playing).
 */
function VoiceBubble({
  conversationId,
  attachment
}: {
  conversationId: string
  attachment: Attachment
}): React.JSX.Element {
  const voice = attachment.voice!
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [at, setAt] = useState(0) // seconds
  const [length, setLength] = useState(voice.durationMs / 1000)
  const [failed, setFailed] = useState(false)
  const url = voiceUrl(conversationId, attachment.id)

  // Stops when the message scrolls away for good (chat closed).
  useEffect(() => () => (playing ? stopVoice() : undefined), [playing])

  async function play(from: number): Promise<void> {
    setLoading(true)
    setFailed(false)
    try {
      const exact = await playVoice(
        url,
        from >= length - 0.1 ? 0 : from,
        (sec) => setAt(sec),
        (reachedEnd) => {
          setPlaying(false)
          if (reachedEnd) setAt(0)
        }
      )
      setLength(exact)
      setPlaying(true)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  function toggle(): void {
    if (playing) stopVoice()
    else void play(at)
  }

  function seek(e: React.PointerEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect()
    const to = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * length
    setAt(to)
    if (playing) void play(to)
  }

  const progress = length > 0 ? at / length : 0
  return (
    <div className={playing ? 'voice-bubble voice-bubble--playing' : 'voice-bubble'}>
      <button
        type="button"
        className="voice-play"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        disabled={loading}
        onClick={toggle}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div
        className="voice-wave"
        role="slider"
        tabIndex={0}
        aria-label="Voice message position"
        aria-valuemin={0}
        aria-valuemax={Math.round(length)}
        aria-valuenow={Math.round(at)}
        aria-valuetext={`${voiceTime(at * 1000)} of ${voiceTime(length * 1000)}`}
        onPointerDown={seek}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const to = Math.min(length, Math.max(0, at + (e.key === 'ArrowRight' ? 5 : -5)))
            setAt(to)
            if (playing) void play(to)
          } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            toggle()
          }
        }}
      >
        {voice.peaks.map((p, i) => (
          <span
            key={i}
            className={
              (i + 0.5) / voice.peaks.length <= progress ? 'voice-bar voice-bar--done' : 'voice-bar'
            }
            style={{ height: `${Math.max(12, p)}%` }}
          />
        ))}
      </div>
      <span className="voice-time">
        {failed ? "Couldn't play" : voiceTime((playing || at > 0 ? at : length) * 1000)}
      </span>
    </div>
  )
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
    </svg>
  )
}

/** Full-size photo viewer. ← → move between the photos of a message; Esc closes. */
export function PhotoViewer({
  conversationId,
  photos,
  startIndex,
  onClose,
  onFailure
}: {
  conversationId: string
  photos: Attachment[]
  startIndex: number
  onClose: () => void
  onFailure: Failure
}): React.JSX.Element {
  const [index, setIndex] = useState(startIndex)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [savedTo, setSavedTo] = useState<{ id: string; path: string } | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const photo = photos[index]
  const count = photos.length

  const keys = useRef({ onClose, count })
  useEffect(() => {
    keys.current = { onClose, count }
  })
  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') keys.current.onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + keys.current.count) % keys.current.count)
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % keys.current.count)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function download(): Promise<void> {
    const path = await save(conversationId, photo, onFailure)
    if (path) setSavedTo({ id: photo.id, path })
  }

  return (
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${photo.name}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="photo-viewer-bar">
        <span className="photo-viewer-title">
          <span className="photo-viewer-name">{photo.name}</span>
          <span className="photo-viewer-meta">
            {count > 1 && `${index + 1} of ${count} · `}
            {photo.width && photo.height ? `${photo.width} × ${photo.height}` : ''}
          </span>
        </span>
        {savedTo?.id === photo.id && isWeb ? (
          <span className="photo-viewer-button" role="status">
            Downloaded
          </span>
        ) : savedTo?.id === photo.id ? (
          <button
            type="button"
            className="photo-viewer-button"
            onClick={() => window.glofly.files.showInFolder(savedTo.path)}
          >
            Show in folder
          </button>
        ) : (
          <button type="button" className="photo-viewer-button" onClick={() => void download()}>
            <DownloadIcon size={18} strokeWidth={2} />
            Save
          </button>
        )}
        <button
          ref={closeButton}
          type="button"
          className="photo-viewer-close"
          aria-label="Close photo"
          onClick={onClose}
        >
          <CloseIcon size={20} strokeWidth={2.2} />
        </button>
      </div>

      <div
        className="photo-viewer-stage"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {/* The preview shows instantly; the full-size photo fades in over it once loaded. */}
        <div className="photo-viewer-frame" key={photo.id}>
          {loadedId !== photo.id && (
            <img
              className="photo-viewer-preview"
              src={photoUrl(conversationId, photo.id, 'preview')}
              alt=""
              draggable={false}
            />
          )}
          <img
            className={
              loadedId === photo.id
                ? 'photo-viewer-full photo-viewer-full--loaded'
                : 'photo-viewer-full'
            }
            src={photoUrl(conversationId, photo.id, 'full')}
            alt={photo.name}
            draggable={false}
            onLoad={() => setLoadedId(photo.id)}
          />
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="photo-viewer-step photo-viewer-step--prev"
            aria-label="Previous photo"
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
          >
            <ChevronIcon direction="left" size={26} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="photo-viewer-step photo-viewer-step--next"
            aria-label="Next photo"
            onClick={() => setIndex((i) => (i + 1) % count)}
          >
            <ChevronIcon direction="right" size={26} strokeWidth={2.2} />
          </button>
        </>
      )}
    </div>
  )
}

/** A file added to the message box, uploading or ready to send. */
export type Upload = {
  localId: string
  name: string
  size: number
  looksLikePhoto: boolean
  status: 'uploading' | 'ready' | 'failed'
  attachment: Attachment | null
  error: string | null
}

/** Files waiting to be sent, shown above the message box. */
export function UploadTray({
  conversationId,
  uploads,
  onRemove
}: {
  conversationId: string
  uploads: Upload[]
  onRemove: (localId: string) => void
}): React.JSX.Element {
  return (
    <ul className="upload-tray" aria-label="Files to send">
      {uploads.map((u) => {
        const photo = u.attachment?.kind === 'image' ? u.attachment : null
        const video = u.attachment?.video ? u.attachment : null
        return (
          <li
            key={u.localId}
            className={u.status === 'failed' ? 'upload-chip upload-chip--failed' : 'upload-chip'}
          >
            <span className="upload-thumb" aria-hidden="true">
              {photo ? (
                <img src={photoUrl(conversationId, photo.id, 'preview')} alt="" draggable={false} />
              ) : video ? (
                <img src={posterUrl(conversationId, video.id)} alt="" draggable={false} />
              ) : u.looksLikePhoto ? (
                <PhotoIcon size={20} />
              ) : (
                <FileIcon size={20} />
              )}
              {u.status === 'uploading' && <span className="upload-spinner" />}
            </span>
            <span className="upload-text">
              <span className="upload-name" title={u.name}>
                {u.name}
              </span>
              <span className="upload-meta" role={u.status === 'failed' ? 'alert' : undefined}>
                {u.status === 'uploading'
                  ? 'Uploading…'
                  : u.status === 'failed'
                    ? u.error
                    : video
                      ? `Video · ${formatSize(video.size)}`
                      : formatSize(u.attachment?.size ?? u.size)}
              </span>
            </span>
            <button
              type="button"
              className="upload-remove"
              aria-label={`Remove ${u.name}`}
              title="Remove"
              onClick={() => onRemove(u.localId)}
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}
