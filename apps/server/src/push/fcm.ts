import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { redis } from "../redis";

// Sends push messages to phones through Firebase Cloud Messaging (the HTTP v1 API).
//
// FCM_SERVICE_ACCOUNT_FILE points at the Google service-account key from Firebase (Project
// settings → Service accounts → Generate new private key). It lives only on the server, like
// the RDS certificate; never in the repo. Without it, pushes are off and the server runs as usual.
//
// Android: every message is a data message, and the Glofly app decides what to show (one
// notification per chat, the incoming-call screen, clearing a chat's notification once it's read
// elsewhere), even while it's closed. iPhones don't run app code for a data message, so the same
// data goes out with an APNs notification built from it (apnsFor); FCM hands it to Apple. FCM_ENDPOINT points at a stand-in FCM for testing (like S3_ENDPOINT).

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

function loadAccount(): ServiceAccount | null {
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!file) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("missing fields");
    return parsed;
  } catch (err) {
    console.error(`Push notifications are off: couldn't read FCM_SERVICE_ACCOUNT_FILE (${(err as Error).message}).`);
    return null;
  }
}

const account = loadAccount();
const endpoint = (process.env.FCM_ENDPOINT?.trim() || "https://fcm.googleapis.com").replace(/\/$/, "");

export const pushConfigured = account !== null;
export const pushKind = account ? `Firebase (${account.project_id})` : "off";

// ── Access token: a signed JWT swapped for a Google access token, kept until shortly before it expires.

let accessToken: { value: string; expiresAt: number } | null = null;

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

async function getAccessToken(): Promise<string> {
  if (!account) throw new Error("push not configured");
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) return accessToken.value;
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key);
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${b64url(signature)}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google sign-in for push failed (${res.status})`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return accessToken.value;
}

// ── Sending

export type PushData = Record<string, string>;

/** "sent" · "gone" (the token no longer works: forget it) · "failed" (try again another time). */
export type PushResult = "sent" | "gone" | "failed";

const failedKey = () => `push:failed:${new Date().toISOString().slice(0, 10)}`;

/** Pushes per day that couldn't be sent (Control's Dashboard). */
export async function failedPushesToday(): Promise<number> {
  return Number(await redis.get(failedKey()).catch(() => 0)) || 0;
}

async function countFailure() {
  try {
    await redis.multi().incr(failedKey()).expire(failedKey(), 3 * 24 * 60 * 60).exec();
  } catch {
    // Counting is best-effort.
  }
}

/** The APNs part of a push for an iPhone, built from the same data the Android app gets. */
export function apnsFor(data: PushData, ttlSeconds: number): Record<string, unknown> {
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
    aps["thread-id"] = data.conversationId;
    aps.category = "GLOFLY_MESSAGE";
    aps.sound = "glofly_message.caf";
  } else if (data.type === "friend_request") {
    aps.alert = { title: data.title || "Glofly", body: data.text || "sent you a friend request" };
    aps["thread-id"] = "friends";
    aps.sound = "glofly_message.caf";
  } else if (data.type === "call_ring") {
    const kind = data.video === "1" ? "video" : "voice";
    aps.alert = {
      title: data.chatTitle ? `${data.callerName} · ${data.chatTitle}` : data.callerName || "Glofly",
      body: data.group === "1" ? `Incoming group ${kind} call · Tap to answer` : `Incoming ${kind} call · Tap to answer`,
    };
    aps["interruption-level"] = "time-sensitive";
    aps.category = "GLOFLY_CALL";
    if (data.dnd !== "1") aps.sound = "glofly_ringtone.caf";
    // The missed-call notification later replaces this one.
    headers["apns-collapse-id"] = data.callId;
  } else if (data.type === "call_missed") {
    aps.alert = { title: data.title || "Missed call", body: data.text || "Missed call" };
    aps["thread-id"] = data.conversationId;
    aps.sound = "glofly_message.caf";
    headers["apns-collapse-id"] = data.callId;
  } else {
    aps.alert = { title: data.title || "Glofly", body: data.text || "" };
  }
  return { headers, payload: { aps } };
}

/**
 * Sends one data message to one phone. `ttlSeconds`: how long FCM keeps trying if the phone is
 * offline (a ringing call is useless after it stops ringing).
 */
export async function sendPush(
  token: string,
  data: PushData,
  ttlSeconds = 24 * 60 * 60,
  platform: string = "android",
): Promise<PushResult> {
  if (!account) return "failed";
  try {
    const res = await fetch(`${endpoint}/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token,
          data,
          // High priority wakes the phone right away; everything Glofly sends is shown or acted on.
          ...(platform === "ios"
            ? { apns: apnsFor(data, ttlSeconds) }
            : { android: { priority: "high", ttl: `${Math.max(0, Math.round(ttlSeconds))}s` } }),
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "sent";
    const body = (await res.json().catch(() => null)) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    } | null;
    const code = body?.error?.details?.find((d) => d.errorCode)?.errorCode ?? body?.error?.status;
    if (res.status === 404 || code === "UNREGISTERED" || (res.status === 400 && code === "INVALID_ARGUMENT")) {
      return "gone";
    }
    if (res.status === 401) accessToken = null; // signed out by Google: sign in again next time
    console.error(`Push couldn't be sent (${res.status} ${code ?? ""})`);
    await countFailure();
    return "failed";
  } catch (err) {
    console.error(`Push couldn't be sent (${(err as Error).message})`);
    await countFailure();
    return "failed";
  }
}
