import { phoneMessageSound, phoneRingtone } from "@glofly/shared";

// The APNs part of a push for an iPhone, built from the same data the Android app gets (fcm.ts
// sends it through Firebase). Pure, so test/apnsPayload.test.ts can check it.

export type PushData = Record<string, string>;

/** The sounds picked on a phone (push_devices; null = defaults). */
export type DeviceSounds = { messageSound?: string | null; ringtone?: string | null };

/**
 * 0.8.0 grouped notifications: every message push of one chat (1-on-1, group or nebula) shares
 * one thread, so iOS stacks them ("Maya · 5 new messages") instead of a banner each. The id is the
 * conversation itself, the same thread a missed call in that chat already used. (0.7.0 grouped
 * nebula alerts by constellation; a busy constellation now stacks per nebula, like Android.)
 */
export const messageThread = (data: PushData): string => data.conversationId || data.thread || "glofly";

/**
 * Who or what a stack of message notifications is from, for iOS's summary line ("%u new messages
 * from %@", the category's format in the app; older builds show iOS's own "more notifications
 * from %@"). 1-on-1: the person; group: its name; nebula: "#nebula · Constellation".
 */
export function messageSummaryArg(data: PushData): string {
  const name = data.chatKind === "group" ? data.chatTitle || data.title || "" : data.senderName || data.title || "";
  return name.slice(0, 80) || "Glofly";
}

export function apnsFor(data: PushData, ttlSeconds: number, sounds: DeviceSounds = {}): Record<string, unknown> {
  // The .caf files are in the iPhone app (modules/glofly-native/ios/sounds); unknown ids get the defaults.
  const messageSound = `${phoneMessageSound(sounds.messageSound).native}.caf`;
  const ringSound = `${phoneRingtone(sounds.ringtone).native}.caf`;
  const expiration = String(Math.floor(Date.now() / 1000) + Math.max(0, Math.round(ttlSeconds)));
  // Clearing a notification (read elsewhere, call answered or over): a silent background push the
  // app handles if iOS wakes it (best effort; iOS can delay or skip these).
  const silent = data.type === "clear" || data.type === "call_stop" || (data.type === "call_missed" && data.dnd === "1");
  if (silent) {
    return {
      headers: { "apns-push-type": "background", "apns-priority": "5", "apns-expiration": expiration },
      payload: { aps: { "content-available": 1 } },
    };
  }
  const headers: Record<string, string> = { "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": expiration };
  const aps: Record<string, unknown> = { "mutable-content": 0 };
  if (data.type === "message") {
    aps.alert = { title: data.title || data.senderName || "Glofly", body: data.text || "New message" };
    // 0.8.0: one stack per chat (see messageThread), summarised as "N new messages from <chat>".
    aps["thread-id"] = messageThread(data);
    aps["summary-arg"] = messageSummaryArg(data);
    aps["summary-arg-count"] = 1;
    aps.category = "GLOFLY_MESSAGE";
    aps.sound = messageSound;
  } else if (data.type === "friend_request") {
    aps.alert = { title: data.title || "Glofly", body: data.text || "sent you a friend request" };
    aps["thread-id"] = "friends";
    aps.sound = messageSound;
  } else if (data.type === "friend_online" || data.type === "friend_joined") {
    // 0.3.0: "Maya is online" / "Maya joined Glofly from your invite".
    aps.alert = { title: data.title || "Glofly", body: data.text || "" };
    aps["thread-id"] = data.type === "friend_online" ? "online" : "friends";
    aps.sound = messageSound;
  } else if (data.type === "call_ring") {
    const kind = data.video === "1" ? "video" : "voice";
    aps.alert = {
      title: data.chatTitle ? `${data.callerName} · ${data.chatTitle}` : data.callerName || "Glofly",
      body: data.group === "1" ? `Incoming group ${kind} call · Tap to answer` : `Incoming ${kind} call · Tap to answer`,
    };
    aps["interruption-level"] = "time-sensitive";
    aps.category = "GLOFLY_CALL";
    if (data.dnd !== "1") aps.sound = ringSound;
    // The missed-call notification later replaces this one.
    headers["apns-collapse-id"] = data.callId;
  } else if (data.type === "call_missed") {
    aps.alert = { title: data.title || "Missed call", body: data.text || "Missed call" };
    aps["thread-id"] = data.conversationId;
    aps.sound = messageSound;
    headers["apns-collapse-id"] = data.callId;
  } else {
    aps.alert = { title: data.title || "Glofly", body: data.text || "" };
  }
  return { headers, payload: { aps } };
}
