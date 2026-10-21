import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, constants, type ClientHttp2Session } from "node:http2";

// iPhone lock-screen ringing (CallKit): Apple "VoIP" pushes, sent straight to Apple (Firebase
// can't send this kind). They wake Glofly even when it's closed, and the app must show the call
// on the lock screen right away (iOS stops delivering them to apps that don't).
//
// Settings (.env on the server). Without them iPhones keep ringing with a normal notification:
//   APNS_KEY_FILE   path to the .p8 key from Apple Developer → Keys (the same "Apple Push
//                   Notifications service" key that was uploaded to Firebase works)
//   APNS_KEY_ID     the key's 10-character ID (shown next to it on that page)
//   APNS_TEAM_ID    the Apple Developer team ID (Membership details)
//   APNS_BUNDLE_ID  optional, default com.glofly.app (VoIP pushes go to "<bundle>.voip")
//
// A phone's VoIP token is stored as "<hex>" (App Store / TestFlight builds) or
// "sandbox:<hex>" (development builds, which Apple serves from its sandbox).

type Config = { key: KeyObject; keyId: string; teamId: string; topic: string };

function loadConfig(): Config | null {
  const file = process.env.APNS_KEY_FILE?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  if (!file || !keyId || !teamId) return null;
  try {
    const key = createPrivateKey(readFileSync(file, "utf8"));
    const bundle = process.env.APNS_BUNDLE_ID?.trim() || "com.glofly.app";
    return { key, keyId, teamId, topic: `${bundle}.voip` };
  } catch (err) {
    console.error(`iPhone call pushes are off: couldn't read APNS_KEY_FILE (${(err as Error).message}).`);
    return null;
  }
}

const config = loadConfig();
export const voipConfigured = config !== null;
export const voipKind = config ? `Apple VoIP (${config.keyId})` : "off";

// Apple's token for this server: a small signed JWT, reused for up to 50 minutes (Apple wants a
// new one at most every 20 min and at least every 60).
let jwt: { token: string; at: number } | null = null;
function bearer(c: Config): string {
  if (jwt && Date.now() - jwt.at < 50 * 60 * 1000) return jwt.token;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "ES256", kid: c.keyId })}.${b64({ iss: c.teamId, iat })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: c.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  jwt = { token: `${unsigned}.${signature}`, at: Date.now() };
  return jwt.token;
}

// One HTTP/2 connection per Apple environment, kept open and reopened when it drops.
const sessions = new Map<string, ClientHttp2Session>();
function session(host: string): ClientHttp2Session {
  const open = sessions.get(host);
  if (open && !open.closed && !open.destroyed) return open;
  const s = connect(`https://${host}`);
  s.on("error", () => sessions.delete(host));
  s.on("close", () => sessions.delete(host));
  s.setTimeout(10 * 60 * 1000, () => s.close()); // idle: let it go
  sessions.set(host, s);
  return s;
}

export type VoipResult = "sent" | "gone" | "failed";

type ApnsRequest = { topic: string; pushType: "voip" | "alert"; priority: "10" | "5"; ttlSeconds: number; body: unknown; what: string };

/** One push to Apple. "gone" means Apple says the token no longer works (forget it). */
function post(storedToken: string, r: ApnsRequest): Promise<VoipResult> {
  if (!config) return Promise.resolve("failed");
  const sandbox = storedToken.startsWith("sandbox:");
  const token = sandbox ? storedToken.slice(8) : storedToken;
  if (!/^[0-9a-f]{32,200}$/i.test(token)) return Promise.resolve("gone");
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: VoipResult) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };
    try {
      const req = session(host).request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${bearer(config)}`,
        "apns-topic": r.topic,
        "apns-push-type": r.pushType,
        "apns-priority": r.priority,
        "apns-expiration": String(Math.floor(Date.now() / 1000) + Math.max(1, r.ttlSeconds)),
      });
      let status = 0;
      let body = "";
      req.setEncoding("utf8");
      req.on("response", (headers) => (status = Number(headers[constants.HTTP2_HEADER_STATUS])));
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        if (status === 200) return finish("sent");
        const reason = (() => {
          try {
            return (JSON.parse(body) as { reason?: string }).reason ?? "";
          } catch {
            return "";
          }
        })();
        if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") return finish("gone");
        console.error(`${r.what} failed: ${status} ${reason}`);
        finish("failed");
      });
      req.on("error", () => finish("failed"));
      req.setTimeout(10_000, () => {
        req.close();
        finish("failed");
      });
      req.end(JSON.stringify(r.body));
    } catch (err) {
      console.error(`${r.what} failed:`, err);
      finish("failed");
    }
  });
}

/** Sends one VoIP push. "gone" means Apple says the token no longer works (forget it). */
export function sendVoip(storedToken: string, payload: Record<string, string>, ttlSeconds: number): Promise<VoipResult> {
  if (!config) return Promise.resolve("failed");
  return post(storedToken, { topic: config.topic, pushType: "voip", priority: "10", ttlSeconds, body: { aps: {}, ...payload }, what: "iPhone call push" });
}

// 0.9.0: alerts for Glofly Control for iPhone (its own app, so its own topic). Same Apple key.
//   CONTROL_APNS_BUNDLE_ID  optional, default com.glofly.control
export const controlAlertsConfigured = config !== null;
const controlTopic = process.env.CONTROL_APNS_BUNDLE_ID?.trim() || "com.glofly.control";

/** A normal visible notification to the Control app. Time-sensitive ones break through Focus. */
export function sendControlAlert(
  storedToken: string,
  alert: { title: string; body: string; data?: Record<string, string>; timeSensitive?: boolean },
): Promise<VoipResult> {
  return post(storedToken, {
    topic: controlTopic,
    pushType: "alert",
    priority: "10",
    ttlSeconds: 6 * 60 * 60,
    body: {
      aps: {
        alert: { title: alert.title, body: alert.body },
        sound: "default",
        "interruption-level": alert.timeSensitive ? "time-sensitive" : "active",
        "thread-id": "control",
      },
      ...(alert.data ?? {}),
      // expo-notifications (Control for iPhone) reads a notification's data from "body".
      body: alert.data ?? {},
    },
    what: "Control alert",
  });
}
