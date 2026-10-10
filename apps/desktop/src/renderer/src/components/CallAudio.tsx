import { useEffect, useRef, useState } from 'react'
import type { PublicUser } from '../../../preload/api-types'
import {
  getCallAudio,
  isMutedForMe,
  onCallAudioChange,
  personVolume,
  setCallVolume,
  setMutedForMe,
  setPersonVolume,
  type CallAudio
} from '../lib/callAudio'
import { getCallPrefs, onCallPrefsChange, setCallPrefs, type CallPrefs } from '../lib/callPrefs'
import Avatar from './Avatar'
import ContextMenu from './ContextMenu'
import { SpeakerIcon } from './icons'

// Adjusting sound during a call: the Audio button's panel (microphone, speakers, the call's
// volume and each person's), and the small menu from right-clicking someone's tile.

function useCallAudio(): CallAudio {
  const [audio, setAudio] = useState(getCallAudio)
  useEffect(() => onCallAudioChange(setAudio), [])
  return audio
}

function useCallPrefs(): CallPrefs {
  const [prefs, setPrefs] = useState(getCallPrefs)
  useEffect(() => onCallPrefsChange(setPrefs), [])
  return prefs
}

/** Microphones and speakers plugged in right now (updates when one is plugged in or out). */
function useAudioDevices(): { mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] } {
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({
    mics: [],
    speakers: []
  })
  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => {
          const real = (kind: MediaDeviceKind): MediaDeviceInfo[] =>
            all.filter(
              (d) =>
                d.kind === kind &&
                d.deviceId &&
                d.deviceId !== 'default' &&
                d.deviceId !== 'communications'
            )
          if (alive) setDevices({ mics: real('audioinput'), speakers: real('audiooutput') })
        })
        .catch(() => alive && setDevices({ mics: [], speakers: [] }))
    }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])
  return devices
}

/** A 0–100% slider that updates as it's dragged. */
function VolumeSlider({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <span className="call-volume">
      <input
        type="range"
        className="call-range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${value}%`}
        style={{ '--fill': `${value}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="call-volume-value" aria-hidden="true">
        {value}%
      </span>
    </span>
  )
}

function MuteForMeButton({
  person,
  muted
}: {
  person: PublicUser
  muted: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={muted ? 'call-mute-me call-mute-me--on' : 'call-mute-me'}
      aria-pressed={muted}
      title={muted ? `Unmute ${person.displayName} for you` : `Mute ${person.displayName} for you`}
      onClick={() => setMutedForMe(person.id, !muted)}
    >
      {muted ? 'Muted' : 'Mute'}
    </button>
  )
}

/** The Audio button's panel. `people`: everyone else in the call right now. */
export function CallAudioPanel({
  people,
  onClose
}: {
  people: PublicUser[]
  onClose: () => void
}): React.JSX.Element {
  const audio = useCallAudio()
  const prefs = useCallPrefs()
  const { mics, speakers } = useAudioDevices()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!ref.current?.contains(target) && !target.closest('.call-audio-button')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const deviceLabel = (d: MediaDeviceInfo, i: number, what: string): string =>
    d.label || `${what} ${i + 1}`

  return (
    <div ref={ref} className="call-audio-panel" role="dialog" aria-label="Call audio">
      <div className="call-audio-row">
        <label htmlFor="call-audio-mic">Microphone</label>
        <select
          id="call-audio-mic"
          value={prefs.micId}
          onChange={(e) => setCallPrefs({ micId: e.target.value })}
        >
          <option value="">Default</option>
          {mics.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceLabel(d, i, 'Microphone')}
            </option>
          ))}
        </select>
      </div>
      <div className="call-audio-row">
        <label htmlFor="call-audio-speakers">Speakers</label>
        <select
          id="call-audio-speakers"
          value={prefs.speakerId}
          onChange={(e) => setCallPrefs({ speakerId: e.target.value })}
        >
          <option value="">Default</option>
          {speakers.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {deviceLabel(d, i, 'Speakers')}
            </option>
          ))}
        </select>
      </div>
      <div className="call-audio-row">
        <span className="call-audio-label">Call volume</span>
        <VolumeSlider label="Call volume" value={audio.volume} onChange={setCallVolume} />
      </div>
      {people.length > 0 && (
        <div className="call-audio-people">
          <span className="call-audio-head">Each person</span>
          {people.map((p) => {
            const muted = isMutedForMe(p.id, audio)
            return (
              <div key={p.id} className="call-audio-person">
                <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={26} />
                <span className="call-audio-name" title={p.displayName}>
                  {p.displayName}
                </span>
                <VolumeSlider
                  label={`${p.displayName}'s volume`}
                  value={personVolume(p.id, audio)}
                  disabled={muted}
                  onChange={(v) => setPersonVolume(p.id, v)}
                />
                <MuteForMeButton person={p} muted={muted} />
              </div>
            )
          })}
        </div>
      )}
      <p className="call-audio-note">Only changes what you hear. Remembered on this computer.</p>
    </div>
  )
}

/** Right-click on someone's tile: their volume, and Mute for me. */
export function PersonVolumeMenu({
  person,
  x,
  y,
  onClose,
  children
}: {
  person: PublicUser
  x: number
  y: number
  onClose: () => void
  /** Menu items above the volume (the call view: pin, full screen) */
  children?: React.ReactNode
}): React.JSX.Element {
  const audio = useCallAudio()
  const muted = isMutedForMe(person.id, audio)
  return (
    <ContextMenu x={x} y={y} label={`${person.displayName}'s volume`} onClose={onClose}>
      {children && (
        <>
          {children}
          <div className="menu-divider" role="separator" />
        </>
      )}
      <div className="person-volume">
        <span className="person-volume-name">
          <SpeakerIcon size={16} />
          {person.displayName}
        </span>
        <VolumeSlider
          label={`${person.displayName}'s volume`}
          value={personVolume(person.id, audio)}
          disabled={muted}
          onChange={(v) => setPersonVolume(person.id, v)}
        />
        <MuteForMeButton person={person} muted={muted} />
      </div>
    </ContextMenu>
  )
}
