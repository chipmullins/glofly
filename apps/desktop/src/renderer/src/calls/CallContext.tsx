import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteParticipant,
  type RemoteTrack,
  type VideoCaptureOptions,
  type VideoResolution
} from 'livekit-client'
import type {
  Call,
  CallJoin,
  ConversationSummary,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { chatTitle } from '../lib/groups'
import { audioCapture, getCallPrefs, onCallPrefsChange, type CallPrefs } from '../lib/callPrefs'
import { playNoAnswer, playPtt, playSound, preloadPtt, startLoop } from '../lib/sounds'
import { effectiveVolume, onCallAudioChange } from '../lib/callAudio'
import { clearNotification, notify, shouldNotify } from '../lib/notify'
import IncomingCall from '../components/IncomingCall'
import {
  CallsContext,
  firstName,
  isActive,
  memberState,
  type CallChat,
  type CallsValue,
  type CurrentCall,
  type ElsewhereCall,
  type IncomingCallInfo,
  type PttState
} from './callState'
import '../components/CallPanel.css'
import { isMac, isTouch, isWeb, privacySettingsPath } from '../lib/platform'
import { shareBrowserScreen, shareDesktopScreen } from '../lib/screenSound'

// Mac: what to do when macOS won't let Glofly see the screen. Builds before Oct 12 had a different
// signature, so an old "Glofly" switch in that list can look on while it no longer counts.
const MAC_SCREEN_PROBLEM =
  'In System Settings → Privacy & Security → Screen & System Audio Recording, remove Glofly with the – button, add it again with +, then quit and reopen Glofly.'

// Everything about calls in one place: the call you're in (and its LiveKit room), a call ringing
// for you, a call you're in on another device, and which chats have a call going on. It lives
// above the chats, so a call keeps going while you look at other chats; the call panel inside a
// chat just shows it.
//
// What the server says about each person (ringing / joined / out) decides what this device
// shows: ringing for you → the Incoming card; joined but not here → "on another device".

/** 1-on-1: how long the other person can drop out before the call is ended. */
const AWAY_LIMIT_MS = 30_000

/** A friendly explanation for a microphone or camera that won't start. */
function deviceProblem(err: unknown, device: 'microphone' | 'camera'): string {
  const name = (err as { name?: string })?.name
  const which = device === 'microphone' ? 'Microphone' : 'Camera'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Glofly isn't allowed to use your ${device}. Turn it on in ${privacySettingsPath(which)}.`
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${device} found. Plug one in, or pick another in Settings → Voice & video.`
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `Your ${device} is busy in another app. Close it there and try again.`
  }
  return `Couldn't start your ${device}.`
}

/**
 * The camera to ask for.
 *
 * Desktop app and desktop browsers: 1280×720 (laptop webcams are 16:9, so nothing is lost).
 *
 * Tablets and phones in a browser (0.5.0 fix): their front cameras are 4:3 and the browser turns
 * the picture with the device. Asking for 16:9 made it cut most of the picture off when held
 * sideways (and look better upright, the "backwards" effect on a Pixel Tablet). So there it asks
 * only for about 1280 wide, in whatever shape the camera has, never cropped or stretched by the
 * browser (resizeMode "none", Chrome), and the front camera unless one was picked in Settings.
 * The tiles follow the picture's shape when the device turns (TrackVideo's resize → cameraFit).
 */
function cameraOptions(p: CallPrefs): VideoCaptureOptions {
  if (isWeb && isTouch) {
    return {
      ...(p.cameraId ? { deviceId: p.cameraId } : { facingMode: 'user' }),
      // Copied into the browser's camera request as-is: an ideal width, no height or shape. No
      // longer `resizeMode: 'none'` (Oct 17): the camera's raw frames came out of the Pixel
      // Tablet padded and off-center; Chrome's normal path still keeps the camera's own shape.
      resolution: {
        width: { ideal: 1280 },
        frameRate: 30
      } as unknown as VideoResolution
    }
  }
  return {
    ...(p.cameraId ? { deviceId: p.cameraId } : {}),
    resolution: VideoPresets.h720.resolution
  }
}

const chatOf = (c: ConversationSummary): CallChat => ({
  kind: c.kind,
  title: chatTitle(c),
  people: c.members
})

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
  /** Ringing and ongoing calls in my chats, by chat */
  const [active, setActive] = useState<Record<string, Call>>({})
  const [room, setRoom] = useState<Room | null>(null)
  const [tick, setTick] = useState(0)
  /** Push to talk while in a call (null = open mic) */
  const [ptt, setPtt] = useState<PttState | null>(null)
  /** True while push to talk is working: the microphone stays off unless the key is held */
  const pttLive = useRef(false)

  // The latest of everything, for event handlers and async steps.
  const currentRef = useRef<CurrentCall | null>(null)
  const incomingRef = useRef<IncomingCallInfo | null>(null)
  const elsewhereRef = useRef<ElsewhereCall | null>(null)
  const activeRef = useRef<Record<string, Call>>({})
  const roomRef = useRef<Room | null>(null)
  const conversationsRef = useRef(conversations)
  const callbacks = useRef({ onOpenChat, onNotice, onSessionExpired })
  useEffect(() => {
    conversationsRef.current = conversations
    callbacks.current = { onOpenChat, onNotice, onSessionExpired }
    activeRef.current = active
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

  // Every attempt to start, answer or join a call gets a number. Hanging up bumps it, so any
  // step still in flight from an older attempt knows to stop.
  const attemptRef = useRef(0)
  const audioRoot = useRef<HTMLDivElement>(null)
  const awayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ringEnd = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopOutgoing = useRef<() => void>(() => {})
  const stopRingtone = useRef<() => void>(() => {})
  /** Rooms Glofly closed on purpose (so their "disconnected" isn't treated as a dropped call). */
  const closing = useRef(new WeakSet<Room>())
  /** Calls just hung up here: a late update saying "you're in it" isn't "on another device". */
  const justLeft = useRef(new Set<string>())

  const bump = useCallback(() => setTick((t) => t + 1), [])

  // Call sounds (Settings → Notifications & sounds). "Connected" the first moment you're in a
  // call with someone else; then, in groups, "Someone joins" / "Someone leaves" as people come
  // and go; "Call ended" when the call goes away after that. A call nobody answered, or that
  // you hung up while it rang, makes no connected/ended sound (the jingle already stopped).
  const heard = useRef<{ callId: string | null; live: boolean; others: Set<string> }>({
    callId: null,
    live: false,
    others: new Set()
  })
  useEffect(() => {
    const h = heard.current
    const call = current?.call ?? null
    if (!current || (h.callId && call && call.id !== h.callId)) {
      if (h.live) playSound('callEnded')
      heard.current = { callId: null, live: false, others: new Set() }
      if (!current) return
    }
    if (!call) return
    const inIt = current.phase === 'connected' || current.phase === 'reconnecting'
    const others = new Set(
      call.members.filter((m) => m.userId !== me.id && m.state === 'joined').map((m) => m.userId)
    )
    const now = heard.current
    now.callId = call.id
    if (!now.live) {
      if (inIt && others.size > 0) {
        playSound('callConnected')
        heard.current = { callId: call.id, live: true, others }
      }
      return
    }
    if (current.chat.kind === 'group') {
      if ([...others].some((id) => !now.others.has(id))) playSound('memberJoined')
      if ([...now.others].some((id) => !others.has(id))) playSound('memberLeft')
    }
    now.others = others
  }, [current, me.id])

  const chatFor = useCallback((conversationId: string): CallChat | null => {
    const c = conversationsRef.current.find((x) => x.id === conversationId)
    return c ? chatOf(c) : null
  }, [])

  const problem = useCallback(
    (message: string) => setCurrent((c) => (c ? { ...c, problem: message } : c)),
    [setCurrent]
  )

  const clearIncoming = useCallback(() => {
    const ringing = incomingRef.current
    if (ringing) clearNotification(`call:${ringing.call.id}`)
    stopRingtone.current()
    stopRingtone.current = () => {}
    if (ringEnd.current) clearTimeout(ringEnd.current)
    ringEnd.current = null
    setIncoming(null)
  }, [setIncoming])

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
    if (id) {
      justLeft.current.add(id)
      setTimeout(() => justLeft.current.delete(id), 5000)
      void window.glofly.calls.leave(id)
    }
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
        // Tablets and phones in a browser send one full-size picture. Their camera isn't 16:9, so
        // the smaller simulcast copies came out at odd sizes (like 288×180) that the tablet's
        // video encoder pads with black: the PC (which watches a small copy in a tile) saw a small
        // off-center strip. Calls are small, so one copy is plenty.
        ...(isWeb && isTouch ? { publishDefaults: { simulcast: false } } : {}),
        audioCaptureDefaults: audioCapture(prefs),
        videoCaptureDefaults: cameraOptions(prefs),
        ...(prefs.speakerId ? { audioOutput: { deviceId: prefs.speakerId } } : {})
      })

      next
        .on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
            // Their voices play through hidden audio elements (on the speakers picked in Settings),
            // at the volume set for the call and for them (the call's Audio button).
            if (track.kind === Track.Kind.Audio) {
              audioRoot.current?.append(track.attach())
              participant.setVolume(effectiveVolume(participant.identity))
            }
            bump()
          }
        )
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          for (const el of track.detach()) el.remove()
          bump()
        })
        .on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          participant.setVolume(effectiveVolume(participant.identity))
          if (awayTimer.current) clearTimeout(awayTimer.current)
          awayTimer.current = null
          setCurrent((c) => (c ? { ...c, partnerAway: false } : c))
          bump()
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          // 1-on-1: they dropped out. Give them a moment to come back before ending the call.
          // (Groups carry on; the server notices if someone doesn't come back.)
          const c = currentRef.current
          if (c?.chat.kind === 'dm' && (c.phase === 'connected' || c.phase === 'reconnecting')) {
            setCurrent((x) => (x ? { ...x, partnerAway: true } : x))
            if (awayTimer.current) clearTimeout(awayTimer.current)
            awayTimer.current = setTimeout(() => {
              const who = currentRef.current?.chat.people[0]
              hangUp()
              if (who) {
                callbacks.current.onNotice(
                  `The call ended because ${firstName(who)}'s connection dropped.`
                )
              }
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
        // Push to talk: the microphone is ready but stays off until the key is held.
        if (pttLive.current) await next.localParticipant.setMicrophoneEnabled(false)
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
        setElsewhere({ call, chat: c.chat })
        callbacks.current.onNotice('Your call moved to another device.')
        return
      }
      if (
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.ROOM_CLOSED
      ) {
        teardown() // taken out of the call, or the call is over (the server says so too)
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

  /** Gets into a call through the server (answer, or join a group call), then its room. */
  const enter = useCallback(
    (call: Call, chat: CallChat, video: boolean, how: 'answer' | 'join') => {
      const attempt = ++attemptRef.current
      setCurrent({
        conversationId: call.conversationId,
        chat,
        call,
        video,
        phase: 'connecting',
        problem: null,
        partnerAway: false
      })
      callbacks.current.onOpenChat(call.conversationId)
      void window.glofly.calls[how](call.id).then((result) => {
        if (attempt !== attemptRef.current) {
          if (result.ok) void window.glofly.calls.leave(result.data.call.id)
          return
        }
        if (!result.ok) {
          teardown()
          failed(result.error, result.message)
          return
        }
        const status = result.data.call.status
        setCurrent((c) =>
          c
            ? {
                ...c,
                call: result.data.call,
                phase: status === 'ongoing' ? 'connected' : 'ringing'
              }
            : c
        )
        void connectRoom(result.data, video, attempt)
      })
    },
    [connectRoom, failed, setCurrent, teardown]
  )

  const start = useCallback(
    (conversation: ConversationSummary, video: boolean) => {
      if (currentRef.current) {
        callbacks.current.onNotice("You're already in a call. Hang up first.")
        return
      }
      const chat = chatOf(conversation)
      // A group call already going on: join it rather than start another.
      const existing = activeRef.current[conversation.id]
      if (existing && conversation.kind === 'group') {
        enter(existing, chat, video, 'join')
        return
      }
      const attempt = ++attemptRef.current
      setCurrent({
        conversationId: conversation.id,
        chat,
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
        const call = result.data.call
        setActive((map) => ({ ...map, [call.conversationId]: call }))
        setCurrent((c) =>
          c ? { ...c, call, phase: call.status === 'ongoing' ? 'connected' : 'ringing' } : c
        )
        void connectRoom(result.data, video, attempt)
      })
    },
    [connectRoom, enter, failed, setCurrent, teardown]
  )

  const answer = useCallback(
    async (video: boolean) => {
      const inc = incomingRef.current
      if (!inc) return
      clearIncoming()
      // Already in a call: that one ends (or you leave it) first.
      const previous = currentRef.current?.call?.id
      if (currentRef.current) teardown()
      if (previous) await window.glofly.calls.leave(previous)
      enter(inc.call, inc.chat, video, 'answer')
    },
    [clearIncoming, enter, teardown]
  )

  const decline = useCallback(
    async (message?: string) => {
      const inc = incomingRef.current
      if (!inc) return
      clearIncoming()
      if (message) await window.glofly.conversations.send(inc.call.conversationId, message)
      const result = await window.glofly.calls.decline(inc.call.id)
      if (!result.ok && result.error === 'unauthorized') callbacks.current.onSessionExpired()
    },
    [clearIncoming]
  )

  const moveHere = useCallback(() => {
    const away = elsewhereRef.current
    if (!away || currentRef.current) return
    setElsewhere(null)
    enter(away.call, away.chat, false, 'join')
  }, [enter, setElsewhere])

  const ring = useCallback(
    async (userIds: string[]) => {
      const id = currentRef.current?.call?.id
      if (!id || userIds.length === 0) return
      const result = await window.glofly.calls.ring(id, userIds)
      if (!result.ok) failed(result.error, result.message)
    },
    [failed]
  )

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
    async (sourceId: string, sound = false) => {
      const local = roomRef.current?.localParticipant
      if (!local) return
      // In a browser, the browser shows its own picker (a tab, a window or the whole screen),
      // and can share that tab's sound or the computer's sound with it (Chrome and Edge).
      if (isWeb) {
        try {
          await shareBrowserScreen(local, true)
        } catch (err) {
          const e = err as { name?: string }
          // Cancelled in the browser's picker: nothing to say.
          if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') {
            problem("Couldn't share your screen. Try again, or pick something else to share.")
          }
        }
        bump()
        return
      }
      try {
        // With sound: only the shared app's (a window), or everything but Glofly (a screen).
        await shareDesktopScreen(local, sourceId, sound)
      } catch (err) {
        // Glofly's own picker has already been answered by now, so any failure here is real
        // (an AbortError too: that's how Electron reports a share it couldn't start). It used to
        // be skipped, which is why sharing on a Mac could do nothing at all with no message.
        const e = err as { name?: string; message?: string }
        console.warn('[screen share] could not start', e?.name, e?.message)
        if (isMac && (await window.glofly.calls.screenAccess()) !== 'granted') {
          problem(MAC_SCREEN_PROBLEM)
        } else if (isMac) {
          problem(`Couldn't share your screen. ${MAC_SCREEN_PROBLEM} (${e?.name ?? 'Error'})`)
        } else {
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

  // A call changed somewhere (rang, was answered, someone joined or left, it ended).
  const onCallUpdate = useCallback(
    (call: Call, caller: PublicUser | null) => {
      setActive((map) => {
        if (isActive(call)) return { ...map, [call.conversationId]: call }
        if (map[call.conversationId]?.id !== call.id) return map
        const next = { ...map }
        delete next[call.conversationId]
        return next
      })
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
      const mine = memberState(call, me.id)

      if (cur?.call?.id === call.id) {
        if (!isActive(call)) {
          // Over. If nobody picked up, say so.
          const unanswered = call.callerId === me.id && call.status !== 'ended'
          teardown()
          if (unanswered) {
            playNoAnswer() // Dim: always the same sound, after the ringing stops
            const partner = cur.chat.kind === 'dm' ? cur.chat.people[0] : undefined
            callbacks.current.onNotice(
              partner ? `${firstName(partner)} didn't pick up.` : 'Nobody picked up.'
            )
          }
          return
        }
        if (!call.members.some((m) => m.userId === me.id)) {
          teardown() // no longer in the group
          callbacks.current.onNotice("You're no longer in this group, so you've left its call.")
          return
        }
        if (call.status === 'ongoing') stopOutgoing.current()
        setCurrent((c) => {
          if (!c) return c
          let phase = c.phase
          if (c.phase === 'connecting') {
            if (mine === 'joined') phase = call.status === 'ongoing' ? 'connected' : 'ringing'
          } else if (c.phase !== 'reconnecting') {
            phase = call.status === 'ongoing' ? 'connected' : 'ringing'
          }
          return { ...c, call, phase }
        })
        return
      }

      // Not the call I'm in here.
      const chat = chatFor(call.conversationId)
      const inc = incomingRef.current
      if (isActive(call) && mine === 'ringing' && chat) {
        if (inc?.call.id !== call.id) {
          const who = caller ?? chat.people.find((p) => p.id === call.callerId) ?? chat.people[0]
          if (!who) return
          clearIncoming()
          setIncoming({ call, caller: who, chat })
          stopRingtone.current = startLoop('ringtone')
          window.glofly.window.attention()
          // Not looking at Glofly: a Windows notification too (clicking it opens the call).
          if (shouldNotify()) {
            const kind = call.video ? 'Video call' : 'Voice call'
            void notify(
              {
                key: `call:${call.id}`,
                conversationId: call.conversationId,
                call: true,
                title:
                  chat.kind === 'group'
                    ? `${firstName(who)} is calling ${chat.title}`
                    : `${who.displayName} is calling you`,
                body: `${kind} · Click to answer`
              },
              who
            )
          }
        } else {
          setIncoming({ ...inc, call })
        }
        // Stop ringing when its time is up, even if nothing else is heard.
        const until = call.members.find((m) => m.userId === me.id)?.ringingUntil
        if (until) {
          if (ringEnd.current) clearTimeout(ringEnd.current)
          ringEnd.current = setTimeout(
            () => {
              if (incomingRef.current?.call.id === call.id) clearIncoming()
            },
            Math.max(0, new Date(until).getTime() - Date.now())
          )
        }
      } else if (inc?.call.id === call.id) {
        clearIncoming() // answered elsewhere, declined, or over
        // It rang out (or they hung up) while you were away.
        if (call.status === 'missed' && shouldNotify()) {
          void notify(
            {
              key: call.conversationId,
              conversationId: call.conversationId,
              title:
                inc.chat.kind === 'group'
                  ? `${firstName(inc.caller)} · ${inc.chat.title}`
                  : inc.caller.displayName,
              body: `Missed ${call.video ? 'video' : 'voice'} call`
            },
            inc.caller
          )
        }
      }

      if (isActive(call) && mine === 'joined' && chat && !justLeft.current.has(call.id)) {
        if (!cur || cur.call?.id !== call.id) setElsewhere({ call, chat })
      } else if (elsewhereRef.current?.call.id === call.id) {
        setElsewhere(null)
      }
    },
    [chatFor, clearIncoming, me.id, setCurrent, setElsewhere, setIncoming, teardown]
  )

  /** Catches up with the server: calls in my chats, ringing for me, or mine elsewhere. */
  const syncActive = useCallback(async () => {
    const result = await window.glofly.calls.active()
    if (!result.ok) return
    const ids = new Set(result.data.map((a) => a.call.id))
    setActive(Object.fromEntries(result.data.map((a) => [a.call.conversationId, a.call])))
    if (incomingRef.current && !ids.has(incomingRef.current.call.id)) clearIncoming()
    if (elsewhereRef.current && !ids.has(elsewhereRef.current.call.id)) setElsewhere(null)
    const cur = currentRef.current
    if (cur?.call && cur.phase !== 'starting' && !ids.has(cur.call.id)) teardown()
    for (const { call } of result.data) onCallUpdate(call, null)
  }, [clearIncoming, onCallUpdate, setElsewhere, teardown])

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

  // Ringing tiles and "4 of 6" go stale when someone's ringing runs out: refresh once a second
  // while anyone's being rung.
  useEffect(() => {
    const anyRinging = Object.values(active).some((c) =>
      c.members.some((m) => m.state === 'ringing')
    )
    if (!anyRinging) return
    const timer = setInterval(bump, 1000)
    return () => clearInterval(timer)
  }, [active, bump])

  // Changing devices in Settings → Voice & video during a call switches them right away.
  useEffect(() => {
    return onCallPrefsChange((p) => {
      const r = roomRef.current
      if (!r) return
      if (p.micId) void r.switchActiveDevice('audioinput', p.micId).catch(() => {})
      if (p.cameraId) void r.switchActiveDevice('videoinput', p.cameraId).catch(() => {})
      void r.switchActiveDevice('audiooutput', p.speakerId || 'default').catch(() => {})
      const mic = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack
      if (mic && 'restartTrack' in mic) {
        void (mic as { restartTrack: (o: unknown) => Promise<void> })
          .restartTrack(audioCapture(p))
          .catch(() => {})
      }
      bump()
    })
  }, [bump])

  // Call volume and each person's volume (the Audio button, or right-clicking a tile) apply
  // straight away.
  useEffect(() => {
    return onCallAudioChange((a) => {
      const r = roomRef.current
      if (!r) return
      for (const p of r.remoteParticipants.values()) p.setVolume(effectiveVolume(p.identity, a))
      bump()
    })
  }, [bump])

  // Push to talk (Settings → Voice & video). While in a call, the main process listens for
  // the chosen key, even with a game in front; holding it turns the microphone on. Letting go
  // turns it off a moment later, so the end of a word isn't cut off.
  useEffect(() => {
    if (!room) return
    let mode: CallPrefs['inputMode'] | null = null
    let key: string | null = null
    let ended = false
    let release: ReturnType<typeof setTimeout> | null = null
    const setMic = (on: boolean): void => {
      void room.localParticipant
        .setMicrophoneEnabled(on)
        .catch((err) => problem(deviceProblem(err, 'microphone')))
        .finally(bump)
    }
    const apply = async (p: CallPrefs): Promise<void> => {
      if (p.inputMode === mode && p.pttKey === key) return
      const wasPtt = mode === 'ptt'
      mode = p.inputMode
      key = p.pttKey
      if (p.inputMode !== 'ptt') {
        window.glofly.ptt.stop()
        pttLive.current = false
        setPtt(null)
        if (wasPtt) setMic(true) // back to open mic
        return
      }
      preloadPtt(p.pttSound)
      const status = await window.glofly.ptt.start(p.pttKey)
      if (ended || key !== p.pttKey) return
      pttLive.current = status === 'ok'
      setPtt({ label: p.pttLabel, held: false, status })
      // If the key can't be heard, the microphone stays on rather than leaving you unheard.
      setMic(status !== 'ok')
      if (status === 'unavailable') {
        problem("Push to talk isn't working on this computer, so your microphone is on.")
      }
    }
    void apply(getCallPrefs())
    const stopPrefs = onCallPrefsChange((p) => void apply(p))
    const stopEvents = window.glofly.onEvent((e) => {
      if (e.type !== 'ptt' || !pttLive.current) return
      if (release) clearTimeout(release)
      release = null
      const sound = getCallPrefs().pttSound
      if (e.down) {
        playPtt(sound, 'down')
        setMic(true)
        setPtt((x) => (x ? { ...x, held: true } : x))
      } else {
        playPtt(sound, 'up')
        release = setTimeout(() => {
          setMic(false)
          setPtt((x) => (x ? { ...x, held: false } : x))
        }, 150)
      }
    })
    return () => {
      ended = true
      stopPrefs()
      stopEvents()
      if (release) clearTimeout(release)
      if (mode === 'ptt') window.glofly.ptt.stop()
      pttLive.current = false
      setPtt(null)
    }
  }, [room, bump, problem])

  // Signing out (or the window closing) ends the call.
  useEffect(() => {
    return () => {
      stopRingtone.current()
      const id = currentRef.current?.call?.id
      teardown()
      if (id) void window.glofly.calls.leave(id)
    }
  }, [teardown])

  const callIn = useCallback((conversationId: string) => active[conversationId] ?? null, [active])

  const value: CallsValue = {
    current,
    incoming,
    elsewhere,
    room,
    tick,
    ptt,
    callIn,
    start,
    answer,
    decline,
    hangUp,
    toggleMic,
    toggleCamera,
    shareScreen,
    stopSharing,
    ring,
    moveHere,
    clearProblem,
    showProblem: problem
  }
  useEffect(() => {
    if (controlsRef) controlsRef.current = value
  })

  return (
    <CallsContext.Provider value={value}>
      {children}
      {/* Their voices play from here, whichever chat is open. */}
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
