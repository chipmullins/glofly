import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { redis } from "../redis";
import { webEnabled } from "../web/session";
import { sendWebPush } from "./web";
import { apnsFor, type DeviceSounds } from "./apnsPayload";

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

/** Phones (Firebase), or browsers (web push, on whenever Glofly in a browser is). */
export const pushConfigured = account !== null || webEnabled;
export const pushKind =
  [account ? `Firebase (${account.project_id})` : null, webEnabled ? "web push" : null].filter(Boolean).join(" + ") ||
  "off";

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

// The APNs part of an iPhone push (and the sounds picked on a phone) live in apnsPayload.ts, so
// they can be tested without Redis or Firebase.
export { apnsFor, type DeviceSounds } from "./apnsPayload";

/**
 * Sends one data message to one phone. `ttlSeconds`: how long FCM keeps trying if the phone is
 * offline (a ringing call is useless after it stops ringing).
 */
export async function sendPush(
  token: string,
  data: PushData,
  ttlSeconds = 24 * 60 * 60,
  platform: string = "android",
  sounds: DeviceSounds = {},
): Promise<PushResult> {
  // Glofly in a browser: its own push service (push/web.ts).
  if (platform === "web") {
    const result = await sendWebPush(token, data, ttlSeconds);
    if (result === "failed") await countFailure();
    return result;
  }
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
            ? { apns: apnsFor(data, ttlSeconds, sounds) }
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
