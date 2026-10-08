import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrack
} from 'livekit-client'
import type {
  Call,
  CallJoin,
  ConversationSummary,
  DmSummary,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import {
  CallsContext,
  firstName,
  type CallsValue,
  type CurrentCall,
  type ElsewhereCall,
  type IncomingCallInfo
} from './callState'
import { audioCapture, getCallPrefs, onCallPrefsChange, type CallPrefs } from '../lib/callPrefs'
import { startLoop } from '../lib/sounds'
import IncomingCall from '../components/IncomingCall'
import '../components/CallPanel.css'

// Everything about calls in one place: the call you're in (and its LiveKit room), a call ringing
// for you, and a call you're in on another device. It lives above the chats, so a call keeps
// going while you look at other chats; the call panel inside a chat just shows it.

/** How long someone can drop out of a call before it's ended. */
const AWAY_LIMIT_MS = 30_000

/** A friendly explanation for a microphone or camera that won't start. */
function deviceProblem(err: unknown, device: 'microphone' | 'camera'): string {
  const name = (err as { name?: string })?.name
  const which = device === 'microphone' ? 'Microphone' : 'Camera'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Glofly isn't allowed to use your ${device}. Turn it on in Windows Settings → Privacy & security → ${which}.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${device} found. Plug one in, or pick another in Settings → Voice & video.`
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `Your ${device} is busy in another app. Close it there and try again.`
  }
  return `Couldn't start your ${device}.`
}

function cameraOptions(p: CallPrefs): {
  deviceId?: string
  resolution: typeof VideoPresets.h720.resolution
} {
  return {
    ...(p.cameraId ? { deviceId: p.cameraId } : {}),
    resolution: VideoPresets.h720.resolution
  }
}

type CallProviderProps = {
  me: SignedInUser
  conversations: ConversationSummary[]
  /** Opens a chat (answering a call opens its chat). */
  onOpenChat: (conversationId: string) => void
  /** Shows a short message (say, "Jacob didn't pick up."). */
  onNotice: (message: string) => void
  onSessionExpired: () => void
  /** Lets the screen around the provider start calls too (friend menus, profile cards). */
  controlsRef?: React.MutableRefObject<CallsValue | null>
  children: React.ReactNode
}

export function CallProvider({
  me,
  conversations,
  onOpenChat,
  onNotice,
  onSessionExpired,
  controlsRef,
  children
}: CallProviderProps): React.JSX.Element {
  const [current, setCurrentState] = useState<CurrentCall | null>(null)
  const [incoming, setIncomingState] = useState<IncomingCallInfo | null>(null)
  const [elsewhere, setElsewhereState] = useState<ElsewhereCall | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [tick, setTick] = useState(0)

  // The latest of everything, for event handlers and async steps.
  const currentRef = useRef<CurrentCall | null>(null)
  const incomingRef = useRef<IncomingCallInfo | null>(null)
  const elsewhereRef = useRef<ElsewhereCall | null>(null)
  const roomRef = useRef<Room | null>(null)
  const conversationsRef = useRef(conversations)
  const callbacks = useRef({ onOpenChat, onNotice, onSessionExpired })
  useEffect(() => {
    conversationsRef.current = conversations
    callbacks.current = { onOpenChat, onNotice, onSessionExpired }
  })

  const setCurrent = useCallback(
    (next: CurrentCall | null | ((c: CurrentCall | null) => CurrentCall | null)) => {
      const value = typeof next === 'function' ? next(currentRef.current) : next
      currentRef.current = value
      setCurrentState(value)
    },
    []
  )
  const setIncoming = useCallback((value: IncomingCallInfo | null) => {
    incomingRef.current = value
    setIncomingState(value)
  }, [])
  const setElsewhere = useCallback((value: ElsewhereCall | null) => {
    elsewhereRef.current = value
    setElsewhereState(value)
  }, [])

  // Every attempt to start, answer or rejoin a call gets a number. Hanging up bumps it, so any
  // step still in flight from an older attempt knows to stop.
  const attemptRef = useRef(0)
  const audioRoot = useRef<HTMLDivElement>(null)
  const awayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopOutgoing = useRef<() => void>(() => {})
  const stopRingtone = useRef<() => void>(() => {})
  /** Rooms Glofly closed on purpose (so their "disconnected" isn't treated as a dropped call). */
  const closing = useRef(new WeakSet<Room>())

  const bump = useCallback(() => setTick((t) => t + 1), [])

  const partnerFor = useCallback((conversationId: string): PublicUser | null => {
    const c = conversationsRef.current.find((x) => x.id === conversationId)
    return c?.kind === 'dm' ? c.partner : null
  }, [])

  const problem = useCallback(
    (message: string) => setCurrent((c) => (c ? { ...c, problem: message } : c)),
    [setCurrent]
  )

  /** Leaves the room and forgets the call here (doesn't tell the server: see hangUp). */
  const teardown = useCallback(() => {
    attemptRef.current += 1
    stopOutgoing.current()
    stopOutgoing.current = () => {}
    if (awayTimer.current) clearTimeout(awayTimer.current)
    awayTimer.current = null
    const old = roomRef.current
    roomRef.current = null
    if (old) {
      closing.current.add(old)
      void old.disconnect()
    }
    audioRoot.current?.replaceChildren()
    setRoom(null)
    setCurrent(null)
  }, [setCurrent])

  const hangUp = useCallback(() => {
    const id = currentRef.current?.call?.id
    teardown()
    if (id) void window.glofly.calls.leave(id)
  }, [teardown])

  // Defined below; connectRoom and rejoin call each other when a connection drops.
  const rejoinRef = useRef<(reason: DisconnectReason | undefined) => void>(() => {})

  /** Joins the call's LiveKit room and turns on the microphone (and camera, for video). */
  const connectRoom = useCallback(
    async (join: CallJoin, camera: boolean, attempt: number): Promise<void> => {
      const prefs = getCallPrefs()
      const next = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: audioCapture(prefs),
        videoCaptureDefaults: cameraOptions(prefs),
        ...(prefs.speakerId ? { audioOutput: { deviceId: prefs.speakerId } } : {})
      })

      next
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          // Their voice plays through a hidden audio element (on the speakers picked in Settings).
          if (track.kind === Track.Kind.Audio) audioRoot.current?.append(track.attach())
          bump()
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const el of track.detach()) el.remove()
          bump()
        })
        .on(RoomEvent.ParticipantConnected, () => {
          if (awayTimer.current) clearTimeout(awayTimer.current)
          awayTimer.current = null
          setCurrent((c) => (c ? { ...c, partnerAway: false } : c))
          bump()
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          // They dropped out. Give them a moment to come back before ending the call.
          const c = currentRef.current
          if (c?.phase === 'connected' || c?.phase === 'reconnecting') {
            setCurrent((x) => (x ? { ...x, partnerAway: true } : x))
            if (awayTimer.current) clearTimeout(awayTimer.current)
            awayTimer.current = setTimeout(() => {
              const who = currentRef.current?.partner
              hangUp()
              if (who)
                callbacks.current.onNotice(
                  `The call ended because ${firstName(who)}'s connection dropped.`
                )
            }, AWAY_LIMIT_MS)
          }
          bump()
        })
        .on(RoomEvent.Reconnecting, () =>
          setCurrent((c) => (c ? { ...c, phase: 'reconnecting' } : c))
        )
        .on(RoomEvent.Reconnected, () =>
          setCurrent((c) =>
            c ? { ...c, phase: c.call?.status === 'ongoing' ? 'connected' : 'ringing' } : c
          )
        )
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (closing.current.has(next)) return
          rejoinRef.current(reason)
        })
        .on(RoomEvent.MediaDevicesError, (err: Error) => problem(deviceProblem(err, 'microphone')))
      for (const e of [
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ActiveSpeakersChanged
      ]) {
        next.on(e, bump)
      }

      const previous = roomRef.current
      if (previous) {
        closing.current.add(previous)
        void previous.disconnect()
      }
      roomRef.current = next
      setRoom(next)

      try {
        await next.connect(join.url, join.token)
      } catch {
        if (attempt !== attemptRef.current) return
        hangUp()
        callbacks.current.onNotice(
          "Couldn't connect the call. Check your connection and try again."
        )
        return
      }
      if (attempt !== attemptRef.current || roomRef.current !== next) {
        closing.current.add(next)
        void next.disconnect()
        return
      }
      try {
        await next.localParticipant.setMicrophoneEnabled(true)
      } catch (err) {
        problem(deviceProblem(err, 'microphone'))
      }
      if (camera) {
        try {
          await next.localParticipant.setCameraEnabled(true)
        } catch (err) {
          problem(deviceProblem(err, 'camera'))
        }
      }
      bump()
    },
    [bump, hangUp, problem, setCurrent]
  )

  // The connection to the call's room was lost (not by hanging up).
  useEffect(() => {
    rejoinRef.current = (reason) => {
      const c = currentRef.current
      if (!c?.call) return
      const call = c.call
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        // You picked up the same call on another device: it carries on there.
        teardown()
        setElsewhere({ call, partner: c.partner })
        callbacks.current.onNotice('Your call moved to another device.')
        return
      }
      if (
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED ||
        reason === DisconnectReason.PARTICIPANT_REMOVED
      ) {
        teardown() // the call is over (the server says so too)
        return
      }
      // Anything else: try once to get back in.
      const camera = roomRef.current?.localParticipant.isCameraEnabled ?? false
      const attempt = ++attemptRef.current
      setCurrent((x) => (x ? { ...x, phase: 'reconnecting' } : x))
      void window.glofly.calls.join(call.id).then((result) => {
        if (attempt !== attemptRef.current) return
        if (!result.ok) {
          teardown()
          callbacks.current.onNotice(
            result.error === 'conflict'
              ? 'The call ended.'
              : 'You lost your connection to the call.'
          )
          return
        }
        setCurrent((x) =>
          x
            ? {
                ...x,
                call: result.data.call,
                phase: result.data.call.status === 'ongoing' ? 'connected' : 'ringing'
              }
            : x
        )
        void connectRoom(result.data, camera, attempt)
      })
    }
  }, [connectRoom, setCurrent, setElsewhere, teardown])

  const failed = useCallback((error: string, message: string) => {
    if (error === 'unauthorized') callbacks.current.onSessionExpired()
    else callbacks.current.onNotice(message)
  }, [])

  const start = useCallback(
    (conversation: DmSummary, video: boolean) => {
      if (currentRef.current) {
        callbacks.current.onNotice("You're already in a call. Hang up first.")
        return
      }
      const attempt = ++attemptRef.current
      setCurrent({
        conversationId: conversation.id,
        partner: conversation.partner,
        call: null,
        video,
        phase: 'starting',
        problem: null,
        partnerAway: false
      })
      stopOutgoing.current = startLoop('outgoing')
      void window.glofly.calls.start(conversation.id, video).then((result) => {
        if (attempt !== attemptRef.current) {
          // Hung up before the server answered: cancel it there too.
          if (result.ok) void window.glofly.calls.leave(result.data.call.id)
          return
        }
        if (!result.ok) {
          teardown()
          failed(result.error, result.message)
          return
        }
        setCurrent((c) =>
          c
            ? {
                ...c,
                call: result.data.call,
                phase: result.data.call.status === 'ongoing' ? 'connected' : 'ringing'
              }
            : c
        )
        void connectRoom(result.data, video, attempt)
      })
    },
    [connectRoom, failed, setCurrent, teardown]
  )

  const answer = useCallback(
    async (video: boolean) => {
      const inc = incomingRef.current
      if (!inc) return
      stopRingtone.current()
      setIncoming(null)
      // Already in a call: that one ends first.
      const previous = currentRef.current?.call?.id
      if (currentRef.current) teardown()
      if (previous) await window.glofly.calls.leave(previous)
      const attempt = ++attemptRef.current
      setCurrent({
        conversationId: inc.call.conversationId,
        partner: inc.caller,
        call: inc.call,
        video: inc.call.video,
        phase: 'connecting',
        problem: null,
        partnerAway: false
      })
      callbacks.current.onOpenChat(inc.call.conversationId)
      void window.glofly.calls.answer(inc.call.id).then((result) => {
        if (attempt !== attemptRef.current) {
          if (result.ok) void window.glofly.calls.leave(result.data.call.id)
          return
        }
        if (!result.ok) {
          teardown()
          failed(result.error, result.message)
          return
        }
        setCurrent((c) => (c ? { ...c, call: result.data.call, phase: 'connected' } : c))
        void connectRoom(result.data, video, attempt)
      })
    },
    [connectRoom, failed, setCurrent, setIncoming, teardown]
  )

  const decline = useCallback(
    async (message?: string) => {
      const inc = incomingRef.current
      if (!inc) return
      stopRingtone.current()
      setIncoming(null)
      if (message) await window.glofly.conversations.send(inc.call.conversationId, message)
      const result = await window.glofly.calls.decline(inc.call.id)
      if (!result.ok && result.error === 'unauthorized') callbacks.current.onSessionExpired()
    },
    [setIncoming]
  )

  const moveHere = useCallback(() => {
    const away = elsewhereRef.current
    if (!away || currentRef.current) return
    setElsewhere(null)
    const attempt = ++attemptRef.current
    setCurrent({
      conversationId: away.call.conversationId,
      partner: away.partner,
      call: away.call,
      video: away.call.video,
      phase: 'connecting',
      problem: null,
      partnerAway: false
    })
    callbacks.current.onOpenChat(away.call.conversationId)
    void window.glofly.calls.join(away.call.id).then((result) => {
      if (attempt !== attemptRef.current) return
      if (!result.ok) {
        teardown()
        failed(result.error, result.message)
        return
      }
      const status = result.data.call.status
      setCurrent((c) =>
        c
          ? { ...c, call: result.data.call, phase: status === 'ongoing' ? 'connected' : 'ringing' }
          : c
      )
      void connectRoom(result.data, false, attempt)
    })
  }, [connectRoom, failed, setCurrent, setElsewhere, teardown])

  const toggleMic = useCallback(() => {
    const local = roomRef.current?.localParticipant
    if (!local) return
    local
      .setMicrophoneEnabled(!local.isMicrophoneEnabled)
      .then(() => setCurrent((c) => (c ? { ...c, problem: null } : c)))
      .catch((err) => problem(deviceProblem(err, 'microphone')))
      .finally(bump)
  }, [bump, problem, setCurrent])

  const toggleCamera = useCallback(() => {
    const local = roomRef.current?.localParticipant
    if (!local) return
    local
      .setCameraEnabled(!local.isCameraEnabled, cameraOptions(getCallPrefs()))
      .then(() => setCurrent((c) => (c ? { ...c, problem: null } : c)))
      .catch((err) => problem(deviceProblem(err, 'camera')))
      .finally(bump)
  }, [bump, problem, setCurrent])

  const shareScreen = useCallback(
    async (sourceId: string) => {
      const local = roomRef.current?.localParticipant
      if (!local) return
      await window.glofly.calls.chooseScreen(sourceId)
      try {
        await local.setScreenShareEnabled(true, { audio: false })
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          problem("Couldn't share your screen. Try again, or pick a different window.")
        }
      }
      bump()
    },
    [bump, problem]
  )

  const stopSharing = useCallback(() => {
    void roomRef.current?.localParticipant.setScreenShareEnabled(false).finally(bump)
  }, [bump])

  const clearProblem = useCallback(
    () => setCurrent((c) => (c ? { ...c, problem: null } : c)),
    [setCurrent]
  )

  // A call changed somewhere (rang, was answered, ended).
  const onCallUpdate = useCallback(
    (call: Call, caller: PublicUser | null) => {
      const cur = currentRef.current
      // This device is starting a call in that chat and hasn't heard back yet: that's ours.
      if (
        cur &&
        !cur.call &&
        cur.conversationId === call.conversationId &&
        call.callerId === me.id
      ) {
        return
      }
      if (cur?.call?.id === call.id) {
        if (call.status === 'ringing') return
        if (call.status === 'ongoing') {
          stopOutgoing.current()
          setCurrent((c) =>
            c ? { ...c, call, phase: c.phase === 'reconnecting' ? c.phase : 'connected' } : c
          )
          return
        }
        // Over. If they never picked up, say so.
        const unanswered = cur.call.callerId === me.id && call.status !== 'ended'
        teardown()
        if (unanswered) callbacks.current.onNotice(`${firstName(cur.partner)} didn't pick up.`)
        return
      }

      const inc = incomingRef.current
      if (inc?.call.id === call.id) {
        if (call.status === 'ringing') return
        stopRingtone.current()
        setIncoming(null)
        // Picked up on another of your devices.
        if (call.status === 'ongoing') setElsewhere({ call, partner: inc.caller })
        return
      }

      const away = elsewhereRef.current
      if (away?.call.id === call.id) {
        setElsewhere(
          call.status === 'ringing' || call.status === 'ongoing' ? { ...away, call } : null
        )
        return
      }

      if (call.status !== 'ringing') return
      const partner =
        call.callerId === me.id
          ? partnerFor(call.conversationId)
          : (caller ?? partnerFor(call.conversationId))
      if (!partner) return
      if (call.callerId === me.id) {
        // You're calling them from another device.
        if (!cur) setElsewhere({ call, partner })
        return
      }
      setIncoming({ call, caller: partner })
      stopRingtone.current()
      stopRingtone.current = startLoop('ringtone')
      window.glofly.window.attention()
    },
    [me.id, partnerFor, setCurrent, setElsewhere, setIncoming, teardown]
  )

  /** Catches up with the server: a call ringing for you, or one you're in elsewhere. */
  const syncActive = useCallback(async () => {
    const result = await window.glofly.calls.active()
    if (!result.ok) return
    const ids = new Set(result.data.map((a) => a.call.id))
    // Anything that ended while we weren't looking.
    if (incomingRef.current && !ids.has(incomingRef.current.call.id)) {
      stopRingtone.current()
      setIncoming(null)
    }
    if (elsewhereRef.current && !ids.has(elsewhereRef.current.call.id)) setElsewhere(null)
    const cur = currentRef.current
    if (cur?.call && cur.phase !== 'starting' && !ids.has(cur.call.id)) teardown()

    for (const { call, joined } of result.data) {
      if (currentRef.current?.call?.id === call.id) continue
      const partner = partnerFor(call.conversationId)
      if (!partner) continue
      if (joined) {
        if (!currentRef.current) setElsewhere({ call, partner })
      } else if (call.status === 'ringing' && call.callerId !== me.id && !incomingRef.current) {
        onCallUpdate(call, partner)
      }
    }
  }, [me.id, onCallUpdate, partnerFor, setElsewhere, setIncoming, teardown])

  useEffect(() => {
    return window.glofly.onEvent((event) => {
      if (event.type === 'call:updated') onCallUpdate(event.call, event.caller)
      if (event.type === 'connection' && event.connected) void syncActive()
    })
  }, [onCallUpdate, syncActive])

  // On sign-in, once the chat list is here (calls need it to know who's who).
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current || conversations.length === 0) return
    synced.current = true
    void syncActive()
  }, [conversations.length, syncActive])

  // Changing devices in Settings → Voice & video during a call switches them right away.
  useEffect(() => {
    return onCallPrefsChange((p) => {
      const r = roomRef.current
      if (!r) return
      if (p.micId) void r.switchActiveDevice('audioinput', p.micId).catch(() => {})
      if (p.cameraId) void r.switchActiveDevice('videoinput', p.cameraId).catch(() => {})
      void r.switchActiveDevice('audiooutput', p.speakerId || 'default').catch(() => {})
      const mic = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack
      if (mic && 'restartTrack' in mic)
        void (mic as { restartTrack: (o: unknown) => Promise<void> })
          .restartTrack(audioCapture(p))
          .catch(() => {})
      bump()
    })
  }, [bump])

  // Signing out (or the window closing) ends the call.
  useEffect(() => {
    return () => {
      stopRingtone.current()
      const id = currentRef.current?.call?.id
      teardown()
      if (id) void window.glofly.calls.leave(id)
    }
  }, [teardown])

  const value: CallsValue = {
    current,
    incoming,
    elsewhere,
    room,
    tick,
    start,
    answer,
    decline,
    hangUp,
    toggleMic,
    toggleCamera,
    shareScreen,
    stopSharing,
    moveHere,
    clearProblem
  }
  useEffect(() => {
    if (controlsRef) controlsRef.current = value
  })

  return (
    <CallsContext.Provider value={value}>
      {children}
      {/* Their voice plays from here, whichever chat is open. */}
      <div ref={audioRoot} hidden />
      {incoming && (
        <IncomingCall
          info={incoming}
          busy={current !== null}
          onAnswer={(video) => void answer(video)}
          onDecline={(message) => void decline(message)}
        />
      )}
    </CallsContext.Provider>
  )
}
