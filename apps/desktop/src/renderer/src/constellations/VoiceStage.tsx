import { useEffect, useRef, useState } from 'react'
import { openCampfire } from '../campfire/store'
import { FlameIcon } from '../campfire/icons'
import { enterFullscreen, exitFullscreen, fullscreenElement } from '../lib/fullscreen'
import { Track, type Participant, type VideoTrack } from 'livekit-client'
import type { PublicUser, SignedInUser, VoiceNebulaState } from '../../../preload/api-types'
import { useCalls } from '../calls/callState'
import { useWatch } from '../calls/useWatch'
import { ScreenPicker, TrackVideo } from '../components/CallPanel'
import { StartWatchDialog, WatchStage } from '../components/WatchTogether'
import { CallAudioPanel, PersonVolumeMenu } from '../components/CallAudio'
import { AvatarFace } from '../components/Avatar'
import TileGlow, { FlipBox } from '../components/TileGlow'
import { flipKey } from '../lib/flip'
import { colorsFor } from '../lib/avatarColors'
import { isWeb, web } from '../lib/platform'
import { voiceLine } from '@glofly/shared/constellations'
import { canControlWatch } from '@glofly/shared/watch'
import { SwapVideoIcon } from '../components/icons'
import { SpeakerIcon } from './bits'
import './Voice.css'

// A voice nebula (VoiceNebula.dc.html, approved): a shared screen big with a LIVE tag and tiles
// beside it (talking glow), controls Mute / Camera / Share / Leave, "Drop in any time · no
// ringing". Watch Together works here too (Oct 17): a Watch button beside Share.

type Tile = {
  person: PublicUser
  me: boolean
  speaking: boolean
  muted: boolean
  camera: VideoTrack | null
}

/** Columns for the voice grid: 1, then 2 up to four people, then 3. */
const gridColumns = (n: number): number => (n <= 1 ? 1 : n <= 4 ? 2 : 3)

function videoOf(p: Participant | undefined, source: Track.Source): VideoTrack | null {
  const pub = p?.getTrackPublication(source)
  return pub && !pub.isMuted && pub.track ? (pub.track as VideoTrack) : null
}

function TileFace({
  tile,
  large,
  onMenu
}: {
  tile: Tile
  large: boolean
  /** Right-click: this person's volume, just for you (0.7.1) */
  onMenu?: (x: number, y: number) => void
}): React.JSX.Element {
  const [bg, fg] = tile.me ? ['#f47a1f', '#2a1406'] : colorsFor(tile.person.id)
  const size = large ? 96 : 64
  return (
    <div
      className={[
        'cx-tile',
        tile.me && 'cx-tile--me',
        tile.speaking && !tile.muted && 'cx-tile--talking'
      ]
        .filter(Boolean)
        .join(' ')}
      data-flip={tile.person.id}
      aria-label={`${tile.me ? 'You' : tile.person.displayName}${tile.muted ? ', muted' : ''}${tile.speaking && !tile.muted ? ', talking' : ''}`}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              onMenu(e.clientX, e.clientY)
            }
          : undefined
      }
    >
      {tile.camera ? (
        <TrackVideo track={tile.camera} mirror={tile.me} />
      ) : (
        <>
          <TileGlow id={tile.person.id} avatarVersion={tile.person.avatarVersion} mine={tile.me} />
          <span
            className="cx-tile-face tile-glow-face"
            style={{
              width: size,
              height: size,
              background: bg,
              color: fg,
              fontSize: large ? 32 : 22
            }}
          >
            <AvatarFace
              id={tile.person.id}
              name={tile.person.displayName}
              avatarVersion={tile.person.avatarVersion}
            />
          </span>
        </>
      )}
      <span className="cx-tile-tag">
        {tile.me ? 'You' : tile.person.displayName.split(/\s+/)[0]}
        {tile.speaking && !tile.muted && !tile.me && (
          <span className="tile-talk-label">· talking</span>
        )}
        {tile.muted && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ff8a7a"
            strokeWidth="2.4"
            strokeLinecap="round"
            role="img"
            aria-label="muted"
          >
            <path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 11V6a3 3 0 0 0-5.6-1.5" />
          </svg>
        )}
      </span>
    </div>
  )
}

export default function VoiceStage({
  me,
  nebulaName,
  constellationName,
  state,
  people,
  joinedHere,
  timedOut,
  onJoin,
  onOpenChat,
  campfireHome
}: {
  me: SignedInUser
  nebulaName: string
  constellationName: string
  state: VoiceNebulaState | null
  /** Members of the constellation, by id */
  people: Map<string, PublicUser>
  /** I'm in this voice nebula on this device */
  joinedHere: boolean
  timedOut: boolean
  onJoin: () => void
  onOpenChat: () => void
  /** Campfire (Nov 2026): the voice nebula's conversation (its campaigns live there) */
  campfireHome?: string
}): React.JSX.Element {
  const calls = useCalls()
  const { room, current } = calls
  void calls.tick // re-render as the room changes
  const [picking, setPicking] = useState(false)
  const [watchDialog, setWatchDialog] = useState<'start' | 'change' | null>(null)
  // 0.7.1: the call's audio settings (mic, speakers, each person's volume, mute for me), as in a call
  const [audioOpen, setAudioOpen] = useState(false)
  const [volumeFor, setVolumeFor] = useState<{ person: PublicUser; x: number; y: number } | null>(
    null
  )
  const [playerUrl, setPlayerUrl] = useState<string | null>(null)
  const screenBox = useRef<HTMLDivElement>(null)
  // 0.7.2: the video's size comes from the height of the box it sits in (--area-h, as in a call).
  // Without it the video had no width at all: a black box with only the controls showing.
  const watchBox = useRef<HTMLDivElement>(null)
  const [watchBoxH, setWatchBoxH] = useState(0)
  useEffect(() => {
    void window.glofly.watch.playerUrl().then(setPlayerUrl)
  }, [])
  const callId = joinedHere ? (current?.call?.id ?? null) : null
  const watchApi = useWatch(callId, calls.showProblem)
  const watch = playerUrl ? watchApi.watch : null
  const watching = !!watch
  useEffect(() => {
    const el = watchBox.current
    if (!watching || !el) return
    const measure = (): void => setWatchBoxH(Math.round(el.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [watching, joinedHere, room])
  const canControl = !!watch && canControlWatch(watch, me.id)

  const header = (
    <header className="cx-voice-head">
      <SpeakerIcon size={20} color="#ffb347" />
      <h2>{nebulaName}</h2>
      <span className="cx-voice-sub">Drop in any time · no ringing</span>
      <span style={{ flex: 1 }} />
      {watch && joinedHere && canControl && (
        <>
          <button
            type="button"
            className="cx-voice-head-button"
            onClick={() => setWatchDialog('change')}
          >
            <SwapVideoIcon size={16} />
            Change video
          </button>
          <button type="button" className="cx-voice-head-button" onClick={watchApi.stop}>
            Stop watching
          </button>
        </>
      )}
      {campfireHome && (
        <button
          type="button"
          className="cx-voice-head-button"
          title="Campfire: a tabletop for this voice nebula"
          onClick={() =>
            openCampfire({
              home: { kind: 'nebula', id: campfireHome },
              callId: joinedHere ? (current?.call?.id ?? null) : null,
              placeName: `${constellationName} · ${nebulaName}`
            })
          }
        >
          <FlameIcon size={16} />
          Campfire
        </button>
      )}
      <button type="button" className="cx-link-button" onClick={onOpenChat}>
        Open chat
      </button>
    </header>
  )

  if (!joinedHere || !room) {
    const inIt = (state?.userIds ?? [])
      .map((id) => people.get(id))
      .filter((p): p is PublicUser => !!p)
    const connecting = joinedHere && !room
    return (
      <main className="cx-voice">
        {header}
        <div className="cx-voice-lobby">
          <span className="cx-voice-lobby-mark" aria-hidden="true">
            <SpeakerIcon size={34} color="#ffb347" />
          </span>
          <h3>
            {inIt.length
              ? voiceLine(inIt.slice(0, 3), nebulaName, inIt.length)
              : `Nobody's in ${nebulaName} yet`}
          </h3>
          {inIt.length > 0 && (
            <div className="cx-voice-lobby-faces">
              {inIt.slice(0, 8).map((p) => {
                const [bg, fg] = colorsFor(p.id)
                return (
                  <span
                    key={p.id}
                    className="cx-voice-lobby-face"
                    style={{ background: bg, color: fg }}
                    title={p.displayName}
                  >
                    <AvatarFace id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} />
                  </span>
                )
              })}
              {state?.live && <span className="cx-live">LIVE</span>}
            </div>
          )}
          <p>
            {timedOut
              ? "You're timed out for now, so you can't join voice."
              : current && !joinedHere
                ? 'Joining leaves your other call.'
                : 'Hop in and talk. Nobody gets rung, and you can leave any time.'}
          </p>
          <button
            type="button"
            className="cx-join-voice"
            disabled={timedOut || connecting}
            onClick={onJoin}
          >
            {connecting ? 'Connecting…' : `Join ${nebulaName}`}
          </button>
        </div>
      </main>
    )
  }

  // In the room: everyone's tiles, and the shared screen if there is one.
  const local = room.localParticipant
  const tiles: Tile[] = [
    ...[...room.remoteParticipants.values()].map((p) => ({
      person: people.get(p.identity) ?? {
        id: p.identity,
        username: p.identity,
        displayName: p.name || 'Someone',
        avatarVersion: null
      },
      me: false,
      speaking: p.isSpeaking,
      muted: !p.isMicrophoneEnabled,
      camera: videoOf(p, Track.Source.Camera)
    })),
    {
      person: me,
      me: true,
      speaking: local.isSpeaking,
      muted: !local.isMicrophoneEnabled,
      camera: videoOf(local, Track.Source.Camera)
    }
  ]
  const sharer =
    [...room.remoteParticipants.values()].find((p) => videoOf(p, Track.Source.ScreenShare)) ??
    (videoOf(local, Track.Source.ScreenShare) ? local : undefined)
  const screen = sharer ? videoOf(sharer, Track.Source.ScreenShare) : null
  const sharerName = sharer
    ? sharer === local
      ? 'Your screen'
      : `${(people.get(sharer.identity)?.displayName ?? sharer.name ?? 'Someone').split(/\s+/)[0]}'s screen`
    : ''
  const micOn = local.isMicrophoneEnabled
  const camOn = local.isCameraEnabled
  const sharing = local.isScreenShareEnabled
  const modMuted = state?.muted.includes(me.id) ?? false
  const ready = current?.phase === 'connected'

  let media: React.ReactNode
  if (watch && playerUrl) {
    media = (
      <div
        className="cx-voice-big cx-voice-big--watch"
        ref={watchBox}
        style={
          watchBoxH > 0 ? ({ '--area-h': `${watchBoxH - 24}px` } as React.CSSProperties) : undefined
        }
      >
        <WatchStage
          me={me}
          people={tiles.filter((t) => !t.me).map((t) => t.person)}
          talking={tiles.filter((t) => t.speaking && !t.muted).map((t) => t.person)}
          api={watchApi}
          playerUrl={playerUrl}
        />
      </div>
    )
  } else if (screen) {
    media = (
      <div className="cx-voice-big" ref={screenBox}>
        <TrackVideo track={screen} fit="contain" />
        <span className="cx-voice-live">LIVE</span>
        <span className="cx-voice-screen-tag">{sharerName}</span>
        <button
          type="button"
          className="cx-voice-full"
          aria-label="Full screen"
          onClick={() => {
            const el = screenBox.current
            if (!el) return
            if (fullscreenElement()) void exitFullscreen()
            else void enterFullscreen(el)
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <main className="cx-voice">
      {header}
      {current?.problem && (
        <p className="cx-voice-problem" role="alert">
          {current.problem}
          <button type="button" aria-label="Dismiss" onClick={calls.clearProblem}>
            ×
          </button>
        </p>
      )}
      <div className={media ? 'cx-voice-stage' : 'cx-voice-stage cx-voice-stage--grid'}>
        {media}
        <FlipBox
          flip={flipKey(
            tiles.map((t) => t.person.id),
            media ? 'tiles' : 'grid'
          )}
          className={media ? 'cx-voice-tiles' : 'cx-voice-grid'}
          data-count={Math.min(tiles.length, 9)}
          style={
            media
              ? undefined
              : ({
                  '--cx-cols': gridColumns(tiles.length),
                  '--cx-rows': Math.ceil(tiles.length / gridColumns(tiles.length))
                } as React.CSSProperties)
          }
        >
          {tiles.map((t) => (
            <TileFace
              key={t.person.id}
              tile={t}
              large={!media}
              onMenu={t.me ? undefined : (x, y) => setVolumeFor({ person: t.person, x, y })}
            />
          ))}
        </FlipBox>
      </div>

      <div role="toolbar" aria-label="Voice controls" className="cx-voice-controls">
        <button
          type="button"
          className={micOn ? 'cx-control' : 'cx-control cx-control--off'}
          aria-label={
            micOn ? 'Mute microphone' : modMuted ? 'A moderator muted you' : 'Unmute microphone'
          }
          title={modMuted ? 'A moderator muted you' : micOn ? 'Mute' : 'Unmute'}
          disabled={!ready || modMuted}
          onClick={calls.toggleMic}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {micOn ? (
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </>
            ) : (
              <>
                <path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 11V6a3 3 0 0 0-5.6-1.5" />
                <path d="M5 11a7 7 0 0 0 11.2 5.6M12 18v3" />
              </>
            )}
          </svg>
        </button>
        <button
          type="button"
          className={camOn ? 'cx-control cx-control--on' : 'cx-control'}
          aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          title={camOn ? 'Camera off' : 'Camera on'}
          disabled={!ready}
          onClick={calls.toggleCamera}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="6" width="13" height="12" rx="2" />
            <path d="m16 10 5-3v10l-5-3" />
          </svg>
        </button>
        <span className="call-audio-wrap cx-audio-wrap">
          <button
            type="button"
            className={
              audioOpen
                ? 'cx-control cx-control--on call-audio-button'
                : 'cx-control call-audio-button'
            }
            aria-label="Voice audio: microphone, speakers and volume"
            aria-expanded={audioOpen}
            aria-haspopup="dialog"
            title="Audio"
            onClick={() => setAudioOpen((v) => !v)}
          >
            <SpeakerIcon size={22} color="currentColor" />
          </button>
          {audioOpen && (
            <CallAudioPanel
              people={tiles.filter((t) => !t.me).map((t) => t.person)}
              onClose={() => setAudioOpen(false)}
            />
          )}
        </span>
        {(!isWeb || web?.screenShare) && (
          <button
            type="button"
            className={sharing ? 'cx-control cx-control--on' : 'cx-control'}
            aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
            title={sharing ? 'Stop sharing' : 'Share screen'}
            disabled={!ready}
            onClick={() =>
              sharing
                ? calls.stopSharing()
                : isWeb
                  ? void calls.shareScreen('browser')
                  : setPicking(true)
            }
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6" />
            </svg>
          </button>
        )}
        {playerUrl && (
          <button
            type="button"
            className={watch ? 'cx-control cx-control--on' : 'cx-control'}
            aria-label={
              watch ? 'Change the video you are watching together' : 'Watch a video together'
            }
            title={
              watch && !canControl
                ? 'Only the person who started the video can change it'
                : 'Watch together'
            }
            disabled={!ready || (!!watch && !canControl)}
            onClick={() => setWatchDialog(watch ? 'change' : 'start')}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="5" width="19" height="13" rx="3" />
              <path d="M10 9v5l4.5-2.5z" fill="currentColor" />
              <path d="M8 21h8" />
            </svg>
          </button>
        )}
        <button type="button" className="cx-leave" onClick={calls.hangUp}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.4 2.4-3.4-1.6v-2.6a12 12 0 0 0-6.4 0v2.6l-3.4 1.6z" />
          </svg>
          Leave
        </button>
      </div>

      {picking && (
        <ScreenPicker
          onClose={() => setPicking(false)}
          onPick={(id, sound) => {
            setPicking(false)
            void calls.shareScreen(id, sound)
          }}
        />
      )}
      {volumeFor && (
        <PersonVolumeMenu
          person={volumeFor.person}
          x={volumeFor.x}
          y={volumeFor.y}
          onClose={() => setVolumeFor(null)}
        />
      )}
      {watchDialog && (
        <StartWatchDialog
          changing={watchDialog === 'change'}
          onStart={async (link, control) => {
            const r = await watchApi.start(link, control)
            if (r.ok && r.data.someoneNeedsUpdate) {
              calls.showProblem('Someone here needs to update Glofly to see this video.')
            }
            return r
          }}
          onClose={() => setWatchDialog(null)}
          onShareScreen={
            !isWeb || web?.screenShare
              ? () => {
                  setWatchDialog(null)
                  if (isWeb) void calls.shareScreen('browser')
                  else setPicking(true)
                }
              : undefined
          }
        />
      )}
      <span className="cx-sr-only" aria-live="polite">
        {constellationName}
      </span>
    </main>
  )
}
