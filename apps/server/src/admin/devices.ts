import { createHash, createPublicKey, randomInt, verify, type KeyObject } from "node:crypto";
import { Router, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { adminDevices } from "../db/schema";
import { redis } from "../redis";
import { rateLimit } from "../rateLimit";
import { logAction, logInBackground, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";

// 0.8.2: Control for iPhone. A phone is approved once, from the home network, with a code shown in
// desktop Control (Server → Approved phones). The phone makes its own key pair (ECDSA P-256; the
// private half never leaves the phone and is locked behind Face ID) and hands us the public half.
// From then on every request from the phone carries a signature, which is what lets it reach
// /admin from anywhere instead of only from ADMIN_IPS:
//
//   X-Control-Device     the device id
//   X-Control-Time       when it was signed (milliseconds since 1970); within 2 minutes of ours
//   X-Control-Nonce      16–64 random characters, never reused (remembered 5 minutes)
//   X-Control-Signature  base64url of the 64-byte signature (r‖s) over the lines
//       GLOFLY-CONTROL-1, METHOD, /admin/path?query, time, nonce, sha256 hex of the body
//
// The admin still signs in with the admin password and an authenticator code as always; a
// session started on a phone only works with that phone's signature (not tied to a network).

export const PHONE_SESSION_MINUTES = 30;
const PAIR_CODE_SECONDS = 5 * 60;
const SKEW_MS = 2 * 60 * 1000;
const NONCE_SECONDS = 5 * 60;
export const DEVICES_MAX = 3;

const SIG_VERSION = "GLOFLY-CONTROL-1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

/** The bytes that get signed (the phone builds the same string). */
export function signedText(method: string, url: string, time: string, nonce: string, body: Buffer | undefined): string {
  return [SIG_VERSION, method.toUpperCase(), url, time, nonce, sha256(body ?? Buffer.alloc(0))].join("\n");
}

/** A raw uncompressed P-256 point (65 bytes, base64url) as a key Node can verify with. */
export function publicKeyFrom(raw: string): KeyObject | null {
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.length !== 65 || bytes[0] !== 4) return null;
    return createPublicKey({
      key: { kty: "EC", crv: "P-256", x: bytes.subarray(1, 33).toString("base64url"), y: bytes.subarray(33).toString("base64url") },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

const keyCache = new Map<string, { raw: string; key: KeyObject }>();

export type SignedDevice = { id: string; adminId: string; name: string };
type Verdict = { ok: true; device: SignedDevice } | { ok: false; message: string };

const header = (req: Request, name: string): string => {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
};

/** Checks a request signed by an approved phone. */
export async function verifyDeviceRequest(req: Request, fromIp: string): Promise<Verdict> {
  const deviceId = header(req, "x-control-device");
  const time = header(req, "x-control-time");
  const nonce = header(req, "x-control-nonce");
  const signature = header(req, "x-control-signature");
  const refused: Verdict = { ok: false, message: "This phone isn't approved for Glofly Control. Approve it again from desktop Control." };
  if (!UUID.test(deviceId) || !/^\d{12,14}$/.test(time) || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
    return refused;
  }
  if (Math.abs(Date.now() - Number(time)) > SKEW_MS) {
    return { ok: false, message: "Your phone's clock is off. Turn on Set Automatically in Settings → General → Date & Time." };
  }
  const [row] = await db
    .select({ id: adminDevices.id, adminId: adminDevices.adminId, name: adminDevices.name, publicKey: adminDevices.publicKey })
    .from(adminDevices)
    .where(eq(adminDevices.id, deviceId));
  if (!row) return refused;
  let cached = keyCache.get(row.id);
  if (!cached || cached.raw !== row.publicKey) {
    const key = publicKeyFrom(row.publicKey);
    if (!key) return refused;
    cached = { raw: row.publicKey, key };
    keyCache.set(row.id, cached);
  }
  const text = signedText(req.method, req.originalUrl, time, nonce, (req as Request & { rawBody?: Buffer }).rawBody);
  let good = false;
  try {
    good = verify("sha256", Buffer.from(text), { key: cached.key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  } catch {
    good = false;
  }
  if (!good) return refused;
  // Each signed request works once.
  const fresh = await redis.set(`admin:nonce:${row.id}:${nonce}`, "1", { NX: true, EX: NONCE_SECONDS });
  if (fresh !== "OK") return refused;
  void db.update(adminDevices).set({ lastUsedAt: new Date(), lastIp: fromIp }).where(eq(adminDevices.id, row.id)).catch(() => {});
  return { ok: true, device: { id: row.id, adminId: row.adminId, name: row.name } };
}

/** Bad signatures are counted per address (good ones aren't): 30 per 15 minutes. */
export const deviceSignatureLimiter = rateLimit("admin:device", {
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  skip: (req) => !req.headers["x-control-device"],
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many tries. Wait 15 minutes and try again." },
});

// ───────────── Pairing ─────────────

const pairKey = (code: string) => `admin:paircode:${sha256(`glofly-pair:${code}`)}`;
// No look-alike characters (0/O, 1/I/L), like backup codes.
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizePairCode = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Public (before sign-in) part: the phone hands over its key with the code. */
export const devicePairRouter = Router();

const pairLimiter = rateLimit("admin:pair", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many tries. Wait 15 minutes and try again." },
});

// POST /admin/devices/pair  { code, publicKey, name } — from the phone, on the home network.
devicePairRouter.post("/pair", pairLimiter, async (req, res) => {
  const parsed = z
    .object({
      code: z.string().max(20),
      publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
      name: z.string().trim().min(1).max(40),
    })
    .safeParse(req.body);
  if (!parsed.success || !publicKeyFrom(parsed.data.publicKey)) {
    res.status(400).json({ error: "invalid", message: "Type the code shown in desktop Control." });
    return;
  }
  if (res.locals.adminDevice) {
    res.status(409).json({ error: "already_paired", message: "This phone is already approved." });
    return;
  }
  const code = normalizePairCode(parsed.data.code);
  // GETDEL: a code works once, even if two phones try it at the same moment.
  const adminId = code.length === 6 ? await redis.getDel(pairKey(code)) : null;
  if (!adminId) {
    logInBackground({ adminId: null, action: "Phone approval refused", note: "Wrong or expired code", ip: res.locals.adminIp });
    res.status(401).json({ error: "wrong_code", message: "That code isn't right or has run out. Make a new one in desktop Control." });
    return;
  }
  const [device] = await db
    .insert(adminDevices)
    .values({ adminId, name: parsed.data.name, publicKey: parsed.data.publicKey, lastIp: res.locals.adminIp })
    .returning({ id: adminDevices.id });
  await logAction({
    adminId,
    action: "Approved a phone",
    targetLabel: parsed.data.name,
    details: { deviceId: device.id },
    note: "Approved with a code from desktop Control",
    ip: res.locals.adminIp,
  });
  res.status(201).json({ deviceId: device.id, name: parsed.data.name });
});

// ───────────── Signed-in part (desktop Control and the phone) ─────────────

export const devicesRouter = Router();

const listDevices = (adminId: string) =>
  db
    .select({
      id: adminDevices.id,
      name: adminDevices.name,
      createdAt: adminDevices.createdAt,
      lastUsedAt: adminDevices.lastUsedAt,
      lastIp: adminDevices.lastIp,
      pushToken: adminDevices.pushToken,
    })
    .from(adminDevices)
    .where(eq(adminDevices.adminId, adminId))
    .orderBy(desc(adminDevices.createdAt));

// GET /admin/devices
devicesRouter.get("/devices", async (_req, res) => {
  const rows = await listDevices(admin(res).id);
  const current = (res.locals.adminDevice as SignedDevice | undefined)?.id ?? null;
  res.json({
    devices: rows.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
      lastIp: d.lastIp,
      alerts: !!d.pushToken,
      thisDevice: d.id === current,
    })),
    max: DEVICES_MAX,
  });
});

// POST /admin/devices/pair-code  { note } — desktop Control, on the home network only.
devicesRouter.post("/devices/pair-code", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  if (res.locals.adminDevice) {
    res.status(403).json({ error: "desktop_only", message: "Approve a new phone from desktop Control at home." });
    return;
  }
  const me = admin(res);
  if ((await listDevices(me.id)).length >= DEVICES_MAX) {
    res.status(409).json({ error: "too_many", message: `You can approve up to ${DEVICES_MAX} phones. Remove one first.` });
    return;
  }
  let code = "";
  for (let i = 0; i < 6; i++) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  await redis.set(pairKey(code), me.id, { EX: PAIR_CODE_SECONDS });
  await logAction({ adminId: me.id, action: "Made a phone approval code", note: parsed.data.note, ip: ip(res) });
  res.json({ code: `${code.slice(0, 3)}-${code.slice(3)}`, expiresIn: PAIR_CODE_SECONDS });
});

// POST /admin/devices/:id/remove  { note } — the phone can't sign in any more; its sessions end.
devicesRouter.post("/devices/:id/remove", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = String(req.params.id);
  const me = admin(res);
  const removed = UUID.test(id)
    ? await db
        .delete(adminDevices)
        .where(and(eq(adminDevices.id, id), eq(adminDevices.adminId, me.id)))
        .returning({ name: adminDevices.name })
    : [];
  if (!removed.length) {
    res.status(404).json({ error: "not_found", message: "That phone was already removed." });
    return;
  }
  keyCache.delete(id);
  await logAction({ adminId: me.id, action: "Removed a phone", targetLabel: removed[0].name, details: { deviceId: id }, note: parsed.data.note, ip: ip(res) });
  res.json({ ok: true, message: `${removed[0].name} can't use Control any more.` });
});

// PUT /admin/devices/me/push  { token: "<hex>" | "sandbox:<hex>" | null } — the phone's alert address.
devicesRouter.put("/devices/me/push", async (req, res) => {
  const device = res.locals.adminDevice as SignedDevice | undefined;
  if (!device) {
    res.status(403).json({ error: "phone_only", message: "Only an approved phone can get alerts." });
    return;
  }
  const parsed = z
    .object({ token: z.string().regex(/^(sandbox:)?[0-9a-f]{32,200}$/i).nullable() })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  await db.update(adminDevices).set({ pushToken: parsed.data.token }).where(eq(adminDevices.id, device.id));
  res.json({ ok: true });
});
