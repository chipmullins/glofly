import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ADMIN_KEY (64 hex characters, only in the server's .env) encrypts the authenticator secret
// in the database, so a copy of the database alone isn't enough to make Control codes.
// Without ADMIN_KEY, Control is switched off: /admin answers 503.

function key(): Buffer | null {
  const hex = process.env.ADMIN_KEY?.trim();
  return hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}

export const adminConfigured = (): boolean => key() !== null;

/** AES-256-GCM. Stored as "v1:<iv>:<tag>:<data>" (base64url). */
export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("ADMIN_KEY is missing or not 64 hex characters.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(stored: string): string {
  const k = key();
  if (!k) throw new Error("ADMIN_KEY is missing or not 64 hex characters.");
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Backup codes: 10 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
const BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newBackupCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += BACKUP_ALPHABET[b % BACKUP_ALPHABET.length];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
export const normalizeBackupCode = (typed: string): string => typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashBackupCode = (typed: string): string => sha256(`glofly-backup:${normalizeBackupCode(typed)}`);

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
