import { useCallback, useEffect, useRef, useState } from 'react'
import {
  audioCapture,
  getCallPrefs,
  pttFromKey,
  pttFromMouse,
  setCallPrefs,
  type CallPrefs
} from '../lib/callPrefs'
import { playPtt, PTT_SOUNDS, SOUND_FILES, type PttSound } from '../lib/sounds'
import { Segmented, Toggle } from './SettingsDialog'
import { isMac, isTouch, isWeb, privacySettingsPath } from '../lib/platform'
import { isBackCamera } from '../lib/cameraFacing'

// Settings → Voice & video: pick the microphone, speakers and camera for calls, check they
// work, and choose how your voice is cleaned up. Saved on this computer. Changes made during
// a call apply to it straight away.

type Devices = { mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[]; cameras: MediaDeviceInfo[] }

const CLEANUP: { key: keyof CallPrefs; label: string; desc: string }[] = [
  {
    key: 'noiseSuppression',
    label: 'Noise suppression',
    desc: 'Filters out background noise like fans, keyboards and barking dogs.'
  },
  {
    key: 'echoCancellation',
    label: 'Echo cancellation',
    desc: "Stops the other person hearing themselves through your speakers. Keep it on unless you're wearing headphones and want the clearest sound."
  },
  {
    key: 'autoGainControl',
    label: 'Automatic volume',
    desc: 'Evens out how loud you sound, whether you lean in or sit back.'
  }
]

/** How loud the microphone is right now, 0–1, while `on`. */
function useMicLevel(on: boolean, prefs: CallPrefs): { level: number; error: string | null } {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!on) return
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false
    void navigator.mediaDevices
      .getUserMedia({ audio: audioCapture(prefs) })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        setError(null)
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(s).connect(analyser)
        const data = new Uint8Array(analyser.fftSize)
        const read = (): void => {
          analyser.getByteTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
          // In 2% steps: an unchanged level skips the re-render (this runs every frame).
          setLevel(Math.round(Math.min(1, peak / 64) * 50) / 50)
          frame = requestAnimationFrame(read)
        }
        read()
      })
      .catch(() => {
        if (!cancelled)
          setError(`Glofly can't hear your microphone. Check ${privacySettingsPath('Microphone')}.`)
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close()
      setLevel(0)
    }
  }, [on, prefs])
  return { level: on ? level : 0, error }
}

export default function VoiceVideoSettings(): React.JSX.Element {
  const [prefs, setPrefs] = useState<CallPrefs>(getCallPrefs)
  const [devices, setDevices] = useState<Devices | null>(null)
  const [testingMic, setTestingMic] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [previewBack, setPreviewBack] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { level, error: micError } = useMicLevel(testingMic, prefs)

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      // "default" and "communications" are Windows' own shortcuts; "Default" below covers them.
      const real = (kind: MediaDeviceKind): MediaDeviceInfo[] =>
        all.filter(
          (d) =>
            d.kind === kind &&
            d.deviceId &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications'
        )
      setDevices({
        mics: real('audioinput'),
        speakers: real('audiooutput'),
        cameras: real('videoinput')
      })
    } catch {
      setDevices({ mics: [], speakers: [], cameras: [] })
    }
  }, [])

  // Plugging in a headset or webcam shows up straight away.
  useEffect(() => {
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [refresh])

  // Camera preview, while it's switched on.
  useEffect(() => {
    if (!previewing) return
    let stream: MediaStream | null = null
    let video: HTMLVideoElement | null = null
    let cancelled = false
    void navigator.mediaDevices
      .getUserMedia({
        // A tablet's camera in its own shape (like in a call), the front one unless one is picked.
        video: isTouch
          ? {
              ...(prefs.cameraId ? { deviceId: prefs.cameraId } : { facingMode: 'user' }),
              width: { ideal: 640 }
            }
          : { ...(prefs.cameraId ? { deviceId: prefs.cameraId } : {}), width: 640, height: 360 }
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        setCameraError(null)
        setPreviewBack(isBackCamera(s.getVideoTracks()[0]))
        video = videoRef.current
        if (video) video.srcObject = s
        void refresh() // names show once the camera has been allowed
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            `Glofly can't use your camera. Check that it's plugged in and allowed in ${privacySettingsPath('Camera')}.`
          )
          setPreviewing(false)
        }
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [previewing, prefs.cameraId, refresh])

  // Names show once the microphone has been allowed.
  useEffect(() => {
    if (testingMic && !micError) void refresh()
  }, [testingMic, micError, refresh])

  function change(changes: Partial<CallPrefs>): void {
    setPrefs(setCallPrefs(changes))
  }

  async function playTestSound(): Promise<void> {
    const audio = new Audio(SOUND_FILES.chime.url) as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>
    }
    if (prefs.speakerId && audio.setSinkId) await audio.setSinkId(prefs.speakerId).catch(() => {})
    void audio.play().catch(() => {})
  }

  const unnamed = !!devices && [...devices.mics, ...devices.cameras].some((d) => !d.label)
  const option = (d: MediaDeviceInfo, i: number, kind: string): React.JSX.Element => (
    <option key={d.deviceId} value={d.deviceId}>
      {d.label || `${kind} ${i + 1}`}
    </option>
  )
  const picker = (
    id: string,
    label: string,
    list: MediaDeviceInfo[] | undefined,
    value: string,
    kind: string,
    onPick: (id: string) => void
  ): React.JSX.Element => (
    <select
      id={id}
      className="settings-select settings-select--device"
      aria-label={label}
      disabled={!list}
      // A device that's been unplugged falls back to Default.
      value={list?.some((d) => d.deviceId === value) ? value : ''}
      onChange={(e) => onPick(e.target.value)}
    >
      <option value="">Default</option>
      {list?.map((d, i) => option(d, i, kind))}
    </select>
  )

  return (
    <>
      <section className="settings-section">
        <h2>Microphone and speakers</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="voice-mic">
                Microphone
              </label>
              {unnamed && (
                <span className="settings-row-desc">
                  Test your mic or preview your camera to see their names.
                </span>
              )}
            </div>
            {picker('voice-mic', 'Microphone', devices?.mics, prefs.micId, 'Microphone', (micId) =>
              change({ micId })
            )}
          </div>
          <div className="settings-row settings-row--stack">
            <div className="settings-row-text">
              <span className="settings-row-label">Mic test</span>
              <span className="settings-row-desc">
                {micError ??
                  (testingMic
                    ? 'Say something. The bar moves when Glofly hears you.'
                    : 'Check that Glofly can hear you.')}
              </span>
            </div>
            <div className="voice-test">
              <div
                className="voice-meter"
                role="meter"
                aria-label="Microphone level"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(level * 100)}
              >
                <span style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
              <button
                type="button"
                className="small-button small-button--quiet"
                onClick={() => setTestingMic((v) => !v)}
              >
                {testingMic ? 'Stop' : 'Test mic'}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="voice-speaker">
                Speakers
              </label>
              <span className="settings-row-desc">Where you hear calls.</span>
            </div>
            <div className="voice-inline">
              {picker(
                'voice-speaker',
                'Speakers',
                devices?.speakers,
                prefs.speakerId,
                'Speakers',
                (speakerId) => change({ speakerId })
              )}
              <button
                type="button"
                className="small-button small-button--quiet"
                onClick={() => void playTestSound()}
              >
                Play test sound
              </button>
            </div>
          </div>
        </div>
      </section>

      <PushToTalk prefs={prefs} onChange={change} />

      <section className="settings-section">
        <h2>Camera</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="voice-camera">
                Camera
              </label>
            </div>
            {picker(
              'voice-camera',
              'Camera',
              devices?.cameras,
              prefs.cameraId,
              'Camera',
              (cameraId) => change({ cameraId })
            )}
          </div>
          <div className="settings-row settings-row--stack">
            <div className="voice-preview">
              {previewing ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={[
                    'voice-preview-video',
                    prefs.mirrorCamera && !previewBack && 'voice-preview-video--mirror',
                    isTouch && 'voice-preview-video--whole'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              ) : (
                <span className="voice-preview-empty">{cameraError ?? 'Your camera is off'}</span>
              )}
            </div>
            <button
              type="button"
              className="small-button small-button--quiet"
              onClick={() => setPreviewing((v) => !v)}
            >
              {previewing ? 'Stop preview' : 'Preview camera'}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Mirror my camera</span>
              <span className="settings-row-desc">
                Shows you like a mirror. The other person always sees you the right way round.
              </span>
            </div>
            <Toggle
              on={prefs.mirrorCamera}
              label="Mirror my camera"
              onChange={(mirrorCamera) => change({ mirrorCamera })}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>During calls</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Call controls</span>
              <span className="settings-row-desc">
                {prefs.callControls === 'hover'
                  ? 'In full frame and full screen, the buttons fade away until you move the mouse over the call.'
                  : 'The buttons always show, even in full frame and full screen.'}
              </span>
            </div>
            <Segmented
              label="Call controls"
              value={prefs.callControls}
              options={[
                { value: 'hover', label: 'Show when hovering' },
                { value: 'always', label: 'Always show' }
              ]}
              onChange={(callControls) => change({ callControls })}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Voice processing</h2>
        <div className="settings-card">
          {CLEANUP.map((row) => (
            <div key={row.key} className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-label">{row.label}</span>
                <span className="settings-row-desc">{row.desc}</span>
              </div>
              <Toggle
                on={prefs[row.key] as boolean}
                label={row.label}
                onChange={(on) => change({ [row.key]: on })}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** Plays a push-to-talk pair: the press, then the let-go a moment later. */
function previewPtt(sound: PttSound | 'none'): void {
  if (sound === 'none') return
  playPtt(sound, 'down', true)
  setTimeout(() => playPtt(sound, 'up', true), 650)
}

/**
 * Input mode: open mic, or push to talk with a key or mouse button you pick. The key works
 * while a game or another app is in front.
 */
function PushToTalk({
  prefs,
  onChange
}: {
  prefs: CallPrefs
  onChange: (changes: Partial<CallPrefs>) => void
}): React.JSX.Element | null {
  const [recording, setRecording] = useState(false)
  const [refused, setRefused] = useState(false)

  // Waiting for a key: the next key or mouse side button becomes the push-to-talk key.
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.code === 'Escape') {
        setRecording(false)
        return
      }
      const picked = pttFromKey(e.code)
      if (!picked) {
        setRefused(true)
        return
      }
      onChange(picked)
      setRefused(false)
      setRecording(false)
    }
    const onMouse = (e: MouseEvent): void => {
      const picked = pttFromMouse(e.button)
      if (!picked) return // left/right clicks keep working (Cancel, closing Settings)
      e.preventDefault()
      e.stopPropagation()
      onChange(picked)
      setRefused(false)
      setRecording(false)
    }
    // Side buttons would otherwise act as Back / Forward.
    const swallow = (e: MouseEvent): void => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('mouseup', swallow, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('mouseup', swallow, true)
    }
  }, [recording, onChange])

  const ptt = prefs.inputMode === 'ptt'
  // A touch screen without a keyboard (an iPad in a browser) has no key to hold.
  if (isTouch && !ptt) return null
  return (
    <section className="settings-section">
      <h2>Input mode</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label">How your microphone turns on</span>
            <span className="settings-row-desc">
              {ptt
                ? 'Your mic is off in calls until you hold your push-to-talk key.'
                : 'Your mic is on in calls until you mute it.'}
            </span>
          </div>
          <Segmented
            label="Input mode"
            value={prefs.inputMode}
            options={[
              { value: 'open', label: 'Open mic' },
              { value: 'ptt', label: 'Push to talk' }
            ]}
            onChange={(inputMode) => onChange({ inputMode })}
          />
        </div>
        {ptt && (
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Push-to-talk key</span>
              <span className="settings-row-desc">
                {recording
                  ? refused
                    ? "That key can't be used. Try another key or a mouse side button."
                    : 'Press a key or a mouse side button… (Esc to cancel)'
                  : isWeb
                    ? "Works while this Glofly tab is in front (browsers can't hear keys pressed in other apps)."
                    : isMac
                      ? 'Works while other apps are in front, once Glofly is allowed under Privacy & Security → Accessibility.'
                      : 'Works while games and other apps are in front. Games run as administrator need Glofly run as administrator too.'}
              </span>
            </div>
            <div className="voice-inline">
              <kbd className={recording ? 'ptt-key ptt-key--recording' : 'ptt-key'}>
                {recording ? '…' : prefs.pttLabel}
              </kbd>
              <button
                type="button"
                className="small-button small-button--quiet"
                onClick={() => {
                  setRefused(false)
                  setRecording((v) => !v)
                }}
              >
                {recording ? 'Cancel' : 'Change key'}
              </button>
            </div>
          </div>
        )}
        {ptt && (
          <div className="settings-row">
            <div className="settings-row-text">
              <label className="settings-row-label" htmlFor="voice-ptt-sound">
                Push-to-talk sound
              </label>
              <span className="settings-row-desc">
                Plays when you press the key and when you let go. Only you hear it.
              </span>
            </div>
            <div className="voice-inline">
              <select
                id="voice-ptt-sound"
                className="settings-select"
                value={prefs.pttSound}
                onChange={(e) => {
                  const pttSound = e.target.value as PttSound | 'none'
                  onChange({ pttSound })
                  previewPtt(pttSound)
                }}
              >
                {(Object.keys(PTT_SOUNDS) as PttSound[]).map((k) => (
                  <option key={k} value={k}>
                    {PTT_SOUNDS[k].label}
                  </option>
                ))}
                <option value="none">None</option>
              </select>
              <button
                type="button"
                className="small-button small-button--quiet"
                disabled={prefs.pttSound === 'none'}
                onClick={() => previewPtt(prefs.pttSound)}
              >
                Play
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
