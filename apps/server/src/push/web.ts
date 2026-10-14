import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverSettings } from "../db/schema";
import type { PushData, PushResult } from "./fcm";

// Web push (Oct 2026): notifications for Glofly in a browser while every Glofly tab is closed.
//
// A browser that allows notifications registers its push subscription with PUT /devices/push
// (platform "web"), like a phone, and the server sends it the same data the phones get. The
// browser's push service (Google's for Chrome/Edge, Mozilla's for Firefox, Apple's for Safari)
// delivers it; the payload is encrypted for that one browser, so the push service can't read it.
// The service worker in the web app (apps/web/src/sw.ts) shows it.
//
// The server signs its pushes with a VAPID key pair. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY can be
// set in .env; otherwise one pair is made the first time and kept in the database (it must stay
// the same, or every browser has to sign up again).

type Keys = { publicKey: string; privateKey: string };

const SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:support@glofly.app";
let keys: Keys | null = null;
let loading: Promise<Keys | null> | null = null;

async function loadKeys(): Promise<Keys | null> {
  const fromEnv = { publicKey: process.env.VAPID_PUBLIC_KEY?.trim(), privateKey: process.env.VAPID_PRIVATE_KEY?.trim() };
  if (fromEnv.publicKey && fromEnv.privateKey) return fromEnv as Keys;
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "webPushVapid"));
    const saved = row?.value as Partial<Keys> | undefined;
    if (typeof saved?.publicKey === "string" && typeof saved?.privateKey === "string") {
      return { publicKey: saved.publicKey, privateKey: saved.privateKey };
    }
    const made = webpush.generateVAPIDKeys();
    // If two requests race, the first one saved wins and both use it.
    await db.insert(serverSettings).values({ key: "webPushVapid", value: made }).onConflictDoNothing();
    const [again] = await db.select().from(serverSettings).where(eq(serverSettings.key, "webPushVapid"));
    const kept = again?.value as Keys | undefined;
    return kept?.publicKey && kept.privateKey ? kept : made;
  } catch (err) {
    console.error("Web push keys couldn't be loaded:", err);
    return null;
  }
}

/** The key pair (made once and remembered). Null if the database can't be reached right now. */
export async function vapidKeys(): Promise<Keys | null> {
  if (keys) return keys;
  loading ??= loadKeys().then((k) => {
    keys = k;
    loading = null;
    return k;
  });
  return loading;
}

/** Only the browsers' own push services: the server never sends anything anywhere else. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

// Tests only: a stand-in push service at this exact host:port (like FCM_ENDPOINT for phones).
const TEST_HOST = process.env.WEB_PUSH_TEST_HOST?.trim() || null;

export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** A subscription from a browser, checked: an https push-service address and its two keys. */
export function parseSubscription(token: string): WebSubscription | null {
  let value: unknown;
  try {
    value = JSON.parse(token);
  } catch {
    return null;
  }
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (typeof v?.endpoint !== "string" || v.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    return null;
  }
  const known = !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
  if (url.protocol !== "https:" || url.username || url.password || !(known || (TEST_HOST && url.host === TEST_HOST))) return null;
  const b64url = /^[A-Za-z0-9_-]{16,200}={0,2}$/;
  const p256dh = v.keys?.p256dh;
  const auth = v.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !b64url.test(p256dh) || !b64url.test(auth)) return null;
  return { endpoint: v.endpoint, keys: { p256dh, auth } };
}

/** One push to one browser. Same answers as FCM: sent, gone (forget it) or failed. */
export async function sendWebPush(token: string, data: PushData, ttlSeconds: number): Promise<PushResult> {
  const subscription = parseSubscription(token);
  if (!subscription) return "gone";
  // Taking a notification away (read elsewhere) would need one to show, so browsers skip those.
  if (data.type === "clear") return "sent";
  const k = await vapidKeys();
  if (!k) return "failed";
  try {
    await webpush.sendNotification(subscription, JSON.stringify(data), {
      vapidDetails: { subject: SUBJECT, publicKey: k.publicKey, privateKey: k.privateKey },
      TTL: Math.max(0, Math.round(ttlSeconds)),
      urgency: data.type === "call_ring" ? "high" : "normal",
      // Rings for the same call replace each other while waiting for a browser that's offline.
      ...(data.type === "call_ring" || data.type === "call_stop" || data.type === "call_missed"
        ? { topic: (data.callId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined }
        : {}),
      timeout: 10_000,
    });
    return "sent";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404 / 410: the browser unsubscribed or was reset.
    if (status === 404 || status === 410) return "gone";
    console.error(`Web push couldn't be sent (${status ?? (err as Error).message})`);
    return "failed";
  }
}
