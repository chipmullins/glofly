import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { eq } from "drizzle-orm";
import { QR_ID_PATTERN, type QrLoginRequest, type QrLoginStart, type QrLoginState } from "@glofly/shared";
import { db } from "../db";
import { users } from "../db/schema";
import { redis } from "../redis";
import { requireCurrentApp } from "../app-version";
import { appVersionFrom, platformColumn, requireAuth } from "./sessions";
import { fromWebOrigin, saysWeb, webEnabled } from "../web/session";
import { emitToUser } from "../realtime";
import type { PendingLogin } from "./twoStep";
import { finishSignIn } from "./finish";

// QR code sign-in (0.7.3, Chip: "like Discord: scan a QR code from your desktop on your phone").
//
// 1. The computer's sign-in screen asks for a code: POST /auth/qr → { id, secret }. The QR code
//    holds `${server}/qr/<id>`. Only the computer knows `secret`.
// 2. The phone's own camera opens that link: a tiny page here that opens Glofly
//    (glofly://qr-login/<id>). Glofly (signed in) shows who's asking: GET /account/qr/<id>.
// 3. Tap Sign in: POST /account/qr/<id>/approve. The computer, asking every second or two
//    (POST /auth/qr/<id>/poll with its secret), gets its own new session.
//
// Codes live 2 minutes, work once, and only a phone app (not another computer, not the browser)
// can approve one. The phone's approval counts instead of the password and the two-step code,
// since that phone is already signed in.

const QR_SECONDS = 120;
const key = (id: string) => `qr:${id}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Pending = {
  secretHash: string;
  login: Omit<PendingLogin, "keepSignedIn"> & { keepSignedIn: boolean };
  app: "desktop" | "web";
  createdAt: number;
  scannedBy?: string;
  approvedBy?: string;
  declined?: boolean;
};

async function load(id: string): Promise<Pending | null> {
  if (!QR_ID_PATTERN.test(id)) return null;
  const raw = await redis.get(key(id));
  return raw ? (JSON.parse(raw) as Pending) : null;
}
const save = (id: string, p: Pending) => redis.set(key(id), JSON.stringify(p), { KEEPTTL: true });

/** The address phones open (the QR code): this server's own public address. */
function qrUrl(req: Request, id: string): string {
  const base = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  return `${base}/qr/${id}`;
}

const startLimiter = rateLimit("qr:start", {
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many QR codes. Wait a few minutes." },
});
const pollLimiter = rateLimit("qr:poll", {
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little." },
});

export const qrAuthRouter = Router();

/** The browser version only from its own page (as signing in with a password). */
function webCheck(req: Request, res: Response): "web" | null | false {
  if (!saysWeb(req)) return null;
  if (!webEnabled || !fromWebOrigin(req.headers)) {
    res.status(403).json({ error: "forbidden", message: "Glofly in a browser only works at its own address." });
    return false;
  }
  return "web";
}

// POST /auth/qr  { deviceName?, keepSignedIn? } → QrLoginStart
qrAuthRouter.post("/", requireCurrentApp, startLimiter, async (req, res) => {
  const web = webCheck(req, res);
  if (web === false) return;
  const platform = web ?? platformColumn(req.headers["x-glofly-platform"]);
  if (platform && platform !== "web") {
    res.status(400).json({ error: "invalid", message: "Sign in on a computer with your phone, not the other way round." });
    return;
  }
  const id = randomBytes(16).toString("base64url"); // 22 characters
  const secret = randomBytes(32).toString("base64url");
  const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName.trim().slice(0, 60) || null : null;
  const pending: Pending = {
    secretHash: sha(secret),
    login: {
      keepSignedIn: req.body?.keepSignedIn !== false,
      deviceName,
      appVersion: appVersionFrom(req.headers["x-glofly-version"]),
      platform,
      web,
    },
    app: web ? "web" : "desktop",
    createdAt: Date.now(),
  };
  await redis.set(key(id), JSON.stringify(pending), { EX: QR_SECONDS });
  const body: QrLoginStart = { id, secret, expiresAt: new Date(Date.now() + QR_SECONDS * 1000).toISOString(), url: qrUrl(req, id) };
  res.json(body);
});

// POST /auth/qr/:id/poll  { secret } → QrLoginState, or (approved) the same answer as signing in.
qrAuthRouter.post("/:id/poll", requireCurrentApp, pollLimiter, async (req, res) => {
  const web = webCheck(req, res);
  if (web === false) return;
  const id = String(req.params.id);
  const p = await load(id);
  const secret = String(req.body?.secret ?? "");
  const given = Buffer.from(sha(secret));
  if (!p || given.length !== 64 || !timingSafeEqual(given, Buffer.from(p.secretHash)) || p.login.web !== web) {
    res.json({ state: "expired" } satisfies QrLoginState);
    return;
  }
  if (p.declined) {
    await redis.del(key(id));
    res.json({ state: "declined" } satisfies QrLoginState);
    return;
  }
  if (p.approvedBy) {
    // Used once: whoever deletes it signs in.
    if (!(await redis.del(key(id)))) {
      res.json({ state: "expired" } satisfies QrLoginState);
      return;
    }
    await finishSignIn(res, p.approvedBy, p.login);
    return;
  }
  if (p.scannedBy) {
    const [u] = await db
      .select({ id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion })
      .from(users)
      .where(eq(users.id, p.scannedBy));
    if (u) {
      res.json({ state: "scanned", by: u } satisfies QrLoginState);
      return;
    }
  }
  res.json({ state: "waiting" } satisfies QrLoginState);
});

// ---------------------------------------------------------------------------------------------
// The phone's side (signed in)

export const qrAccountRouter = Router();
qrAccountRouter.use(requireAuth);

const PHONE_ONLY = { error: "phone_only", message: "Approve sign-ins from Glofly on your phone." };
const GONE = { error: "expired", message: "That QR code has run out. Show a new one on the computer." };
const isPhone = (res: Response) => {
  const platform = res.locals.sessionPlatform as string | null | undefined;
  return platform === "android" || platform === "ios";
};

// GET /account/qr/:id → QrLoginRequest (and the computer shows "Waiting for you to approve")
qrAccountRouter.get("/:id", async (req, res) => {
  if (!isPhone(res)) {
    res.status(403).json(PHONE_ONLY);
    return;
  }
  const id = String(req.params.id);
  const p = await load(id);
  if (!p || p.approvedBy || p.declined) {
    res.status(410).json(GONE);
    return;
  }
  const myId = (res.locals.user as { id: string }).id;
  if (!p.scannedBy) await save(id, { ...p, scannedBy: myId });
  else if (p.scannedBy !== myId) {
    res.status(410).json(GONE);
    return;
  }
  const ttl = await redis.ttl(key(id));
  const body: QrLoginRequest = {
    id,
    deviceName: p.login.deviceName,
    app: p.app,
    createdAt: new Date(p.createdAt).toISOString(),
    expiresAt: new Date(Date.now() + Math.max(0, ttl) * 1000).toISOString(),
  };
  res.json(body);
});

async function decide(req: Request, res: Response, approve: boolean) {
  if (!isPhone(res)) {
    res.status(403).json(PHONE_ONLY);
    return;
  }
  const id = String(req.params.id);
  const p = await load(id);
  const myId = (res.locals.user as { id: string }).id;
  if (!p || p.approvedBy || p.declined || (p.scannedBy && p.scannedBy !== myId)) {
    res.status(410).json(GONE);
    return;
  }
  const [u] = await db.select({ restricted: users.restricted, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, myId));
  if (approve && (!u || u.suspendedAt)) {
    res.status(403).json({ error: "forbidden", message: "This account can't sign in right now." });
    return;
  }
  await save(id, { ...p, scannedBy: myId, ...(approve ? { approvedBy: myId } : { declined: true }) });
  // Other signed-in devices of this account hear about it (the Devices list refreshes).
  if (approve) emitToUser(myId, "account:changed", {});
  res.json({ ok: true });
}

// POST /account/qr/:id/approve · POST /account/qr/:id/decline
qrAccountRouter.post("/:id/approve", (req, res) => decide(req, res, true));
qrAccountRouter.post("/:id/decline", (req, res) => decide(req, res, false));

// ---------------------------------------------------------------------------------------------
// GET /qr/:id: what a phone's camera opens. Opens Glofly (glofly://qr-login/<id>), or says how.

export const qrPageRouter = Router();
qrPageRouter.get("/:id", (req, res) => {
  const id = String(req.params.id);
  if (!QR_ID_PATTERN.test(id)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  const open = `glofly://qr-login/${id}`;
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${open}">
<title>Sign in with Glofly</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#1c1210;color:#f5ede6;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center}
main{padding:32px 24px;max-width:360px}
h1{font-size:24px;margin:0 0 10px}
p{color:#d9c2b1;margin:0 0 22px}
a.b{display:inline-block;padding:14px 26px;border-radius:999px;background:#ffa54a;color:#2a1406;font-weight:700;text-decoration:none}
small{display:block;margin-top:22px;color:#9a897c}
</style></head>
<body><main>
<h1>Sign in with Glofly</h1>
<p>Open Glofly on this phone to approve signing in on your computer.</p>
<a class="b" href="${open}">Open Glofly</a>
<small>Don't have Glofly on this phone? Get it at glofly.app, sign in, then scan the code again.</small>
</main></body></html>`);
});
