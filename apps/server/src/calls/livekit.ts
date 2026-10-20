import {
  AccessToken,
  RoomConfiguration,
  RoomServiceClient,
  ServerError,
  TrackSource,
} from "livekit-server-sdk";

// LiveKit carries the actual audio, video and screen sharing. Glofly's server never touches the
// media: it decides who may join which call and hands out a short-lived pass (a token) for it.
//
// Set in .env (from the LiveKit Cloud project's Settings → API keys):
//   LIVEKIT_URL=wss://<your-project>.livekit.cloud
//   LIVEKIT_API_KEY=...
//   LIVEKIT_API_SECRET=...
// Without them the server still runs; starting a call just says calls aren't set up yet.

const url = process.env.LIVEKIT_URL?.trim() ?? "";
const apiKey = process.env.LIVEKIT_API_KEY?.trim() ?? "";
const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() ?? "";

/** wss:// for LiveKit Cloud; ws:// is allowed only for a LiveKit server on this computer. */
const validUrl = /^wss:\/\/[^\s/]+/.test(url) || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url);

export const livekitConfigured = validUrl && apiKey.length > 0 && apiSecret.length > 0;
export const LIVEKIT_URL = url;

if (url && !validUrl) {
  console.warn("LIVEKIT_URL should look like wss://your-project.livekit.cloud. Calls are off until it does.");
}

/** A pass to join one call's room as this person. Only good for joining within 15 minutes. */
export async function callToken(
  callId: string,
  user: { id: string; displayName: string },
  maxParticipants: number,
  // 2.0: false while a moderator has muted them in a voice nebula (no microphone allowed).
  microphone = true,
): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: user.displayName,
    ttl: "15m",
  });
  token.addGrant({
    room: callId,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    // Microphone, camera and screen sharing only: no data messages, no changing their own name.
    canPublishSources: callSources(microphone),
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  // The room is created when the first person joins. It closes a minute after it empties.
  token.roomConfig = new RoomConfiguration({ maxParticipants, emptyTimeout: 60, departureTimeout: 20 });
  return token.toJwt();
}

/** What someone in a call may send. */
function callSources(microphone: boolean): TrackSource[] {
  return [
    ...(microphone ? [TrackSource.MICROPHONE] : []),
    TrackSource.CAMERA,
    TrackSource.SCREEN_SHARE,
    TrackSource.SCREEN_SHARE_AUDIO,
  ];
}

let rooms: RoomServiceClient | null = null;
function roomService(): RoomServiceClient | null {
  if (!livekitConfigured) return null;
  rooms ??= new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret, { requestTimeout: 10 });
  return rooms;
}

/**
 * How many people a call's room can hold (0 = no limit), or null if there's no room yet or
 * LiveKit can't say. Rooms are sized when the first person joins; 1-on-1 rooms made before
 * 0.5.2 hold only 2, so they can't take more people.
 */
export async function roomCapacity(callId: string): Promise<number | null> {
  const service = roomService();
  if (!service) return null;
  try {
    const [room] = await service.listRooms([callId]);
    return room ? room.maxParticipants : null;
  } catch (err) {
    console.error("Couldn't check a call's room:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Who is connected to a call's room right now (user ids), or null if LiveKit can't say. */
export async function peopleInRoom(callId: string): Promise<string[] | null> {
  const service = roomService();
  if (!service) return null;
  try {
    const participants = await service.listParticipants(callId);
    return participants.map((p) => p.identity);
  } catch (err) {
    // No room means nobody is there.
    if (err instanceof ServerError && (err.status === 404 || err.code === "not_found")) return [];
    console.error("Couldn't check a call's room:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Closes a call's room, disconnecting anyone still in it. */
export async function closeRoom(callId: string): Promise<void> {
  const service = roomService();
  if (!service) return;
  try {
    await service.deleteRoom(callId);
  } catch (err) {
    if (err instanceof ServerError && (err.status === 404 || err.code === "not_found")) return;
    console.error("Couldn't close a call's room:", err instanceof Error ? err.message : err);
  }
}

/** Disconnects one person from a call's room (they were removed from the group). */
export async function removeFromRoom(callId: string, userId: string): Promise<void> {
  const service = roomService();
  if (!service) return;
  try {
    await service.removeParticipant(callId, userId);
  } catch (err) {
    if (err instanceof ServerError && (err.status === 404 || err.code === "not_found")) return;
    console.error("Couldn't remove someone from a call's room:", err instanceof Error ? err.message : err);
  }
}

/**
 * 0.5.0 Broadcast now: a pass for a broadcast's room. The broadcaster may send their screen, its
 * sound and their microphone; friends watching can only watch and listen (they send nothing).
 */
export async function broadcastToken(
  room: string,
  user: { id: string; displayName: string },
  role: "host" | "viewer",
): Promise<string> {
  // Viewers' passes are short: once in, the connection lasts; an expired pass only stops rejoining.
  const token = new AccessToken(apiKey, apiSecret, { identity: user.id, name: user.displayName, ttl: role === "host" ? "15m" : "3m" });
  token.addGrant({
    room,
    roomJoin: true,
    canSubscribe: role === "viewer",
    canPublish: role === "host",
    canPublishSources: role === "host" ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.MICROPHONE] : [],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  token.roomConfig = new RoomConfiguration({ maxParticipants: 101, emptyTimeout: 60, departureTimeout: 20 });
  return token.toJwt();
}

/**
 * 2.0 voice nebulas: a moderator mutes (or unmutes) someone. LiveKit takes away (or gives back) their
 * permission to send microphone audio, which stops their microphone track at once. False if
 * LiveKit couldn't be reached.
 */
export async function setMicrophoneAllowed(callId: string, userId: string, allowed: boolean): Promise<boolean> {
  const service = roomService();
  if (!service) return false;
  try {
    await service.updateParticipant(callId, userId, {
      permission: {
        canSubscribe: true,
        canPublish: true,
        canPublishData: false,
        canUpdateMetadata: false,
        canPublishSources: callSources(allowed),
      },
    });
    return true;
  } catch (err) {
    if (err instanceof ServerError && (err.status === 404 || err.code === "not_found")) return true;
    console.error("Couldn't change someone's microphone permission:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * 0.7.5 LIVE preview: a watch-only pass to peek at a screen share in a voice nebula before joining.
 * It can't send anything (no microphone, camera, screen or data), it's hidden from everyone in the
 * room, and its identity isn't the person's user id, so it never counts as them being in voice.
 */
export async function previewToken(room: string, identity: string, name: string): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret, { identity, name, ttl: "2m" });
  token.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishSources: [],
    canPublishData: false,
    canUpdateOwnMetadata: false,
    hidden: true,
  });
  return token.toJwt();
}

