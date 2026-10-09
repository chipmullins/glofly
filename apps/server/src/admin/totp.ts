import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Authenticator-app codes (TOTP, RFC 6238): the same 6-digit codes Google Authenticator,
// Microsoft Authenticator, 1Password and the like show, a new one every 30 seconds.
// Written here with Node's own crypto, so there's no extra package to trust.

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, the size RFC 4226 recommends), as base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);

/** The code for one step. */
export function codeFor(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const number =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Checks a typed code. Accepts the current step and one either side (a phone clock a little
 * off), but never a step at or before `lastUsedStep`, so a code can't be used twice.
 * Returns the step it matched, or null.
 */
export function verifyTotp(secret: string, typed: string, lastUsedStep: number, now = Date.now()): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  let matched: number | null = null;
  // Check every candidate (no early exit), so timing doesn't hint which one matched.
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeFor(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastUsedStep && matched === null) {
      matched = step;
    }
  }
  return matched;
}

/** The address an authenticator app reads from a QR code. */
export function otpauthUri(secret: string, accountName: string): string {
  const label = encodeURIComponent(`Glofly Control:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Glofly Control")}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
