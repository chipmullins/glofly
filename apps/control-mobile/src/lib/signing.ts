import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

// Request signing for Control for iPhone (spec: apps/server/src/admin/devices.ts). Pure JavaScript,
// no React Native imports, so the Node test (test/transport.e2e.ts) runs exactly this code.
//
// Every request from the approved phone carries:
//   X-Control-Device     the device id the server gave when the phone was approved
//   X-Control-Time       milliseconds since 1970, as a string
//   X-Control-Nonce      16–64 random characters [A-Za-z0-9_-], never reused
//   X-Control-Signature  base64url of the 64-byte r‖s ECDSA P-256 / SHA-256 signature over the lines
//     GLOFLY-CONTROL-1 \n METHOD \n /admin/path?query \n time \n nonce \n sha256-hex(body bytes)

export const SIG_VERSION = 'GLOFLY-CONTROL-1'

/** Random bytes from the platform (expo-crypto on the phone, node:crypto in the test). */
export type RandomBytes = (count: number) => Uint8Array

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** base64url without padding (no Buffer/btoa needed, so it works the same everywhere). */
export function base64url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63]
  }
  return out
}

export const sha256Hex = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)))

export type PhoneKey = {
  /** 32-byte secret, hex. Kept in the Keychain behind Face ID; in memory only while signed in. */
  secretKeyHex: string
  /** base64url of the 65-byte uncompressed public point, what POST /admin/devices/pair wants. */
  publicKey: string
}

/** A new key pair. The seed comes from the platform's secure random source (48 bytes for P-256). */
export function makePhoneKey(randomBytes: RandomBytes): PhoneKey {
  const secretKey = p256.utils.randomSecretKey(randomBytes(p256.lengths.seed ?? 48))
  return { secretKeyHex: bytesToHex(secretKey), publicKey: publicKeyFor(bytesToHex(secretKey)) }
}

export const publicKeyFor = (secretKeyHex: string): string =>
  base64url(p256.getPublicKey(hexToBytes(secretKeyHex), false))

/** The exact text that gets signed (the server builds the same string). */
export function signedText(method: string, path: string, time: string, nonce: string, bodyText: string): string {
  return [SIG_VERSION, method.toUpperCase(), path, time, nonce, sha256Hex(bodyText)].join('\n')
}

export type SignedHeaders = {
  'X-Control-Device': string
  'X-Control-Time': string
  'X-Control-Nonce': string
  'X-Control-Signature': string
}

export function signRequest(opts: {
  deviceId: string
  secretKeyHex: string
  method: string
  /** path + query exactly as requested, starting with /admin/ */
  path: string
  /** the exact body text sent ('' when there is no body) */
  bodyText: string
  time: number
  randomBytes: RandomBytes
}): SignedHeaders {
  const time = String(opts.time)
  const nonce = base64url(opts.randomBytes(18)) // 24 characters
  const text = signedText(opts.method, opts.path, time, nonce, opts.bodyText)
  // prehash (sha256) is noble v2's default; 'compact' = the 64-byte r‖s the server wants.
  const signature = p256.sign(utf8ToBytes(text), hexToBytes(opts.secretKeyHex), { format: 'compact' })
  return {
    'X-Control-Device': opts.deviceId,
    'X-Control-Time': time,
    'X-Control-Nonce': nonce,
    'X-Control-Signature': base64url(signature),
  }
}
