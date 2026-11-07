import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverSettings } from "../db/schema";

// Communities round (Nov 2026): Sign in with Glofly's ID tokens are JWTs signed with ES256 (P-256).
// The key is made once and kept in server_settings ("oauth_signing_key", a private JWK); its public
// half is published at /oauth/jwks so apps can check tokens came from Glofly.

const SETTING = "oauth_signing_key";
type Stored = { kid: string; jwk: Record<string, string> };
let cached: { kid: string; privateKey: KeyObject; publicJwk: Record<string, string> } | null = null;

async function signingKey() {
  if (cached) return cached;
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, SETTING));
  let stored = row?.value as Stored | undefined;
  if (!stored?.jwk?.d) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    stored = { kid: randomUUID().slice(0, 8), jwk: privateKey.export({ format: "jwk" }) as Record<string, string> };
    // Two servers starting at once: the first one written wins, everyone reads it back.
    await db.insert(serverSettings).values({ key: SETTING, value: stored }).onConflictDoNothing();
    const [again] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, SETTING));
    stored = again.value as Stored;
  }
  const privateKey = createPrivateKey({ key: stored.jwk, format: "jwk" });
  const { d: _private, ...pub } = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, string>;
  void _private;
  cached = { kid: stored.kid, privateKey, publicJwk: { ...pub, kid: stored.kid, use: "sig", alg: "ES256" } };
  return cached;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** A signed JWT (ES256). */
export async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const key = await signingKey();
  const head = b64(JSON.stringify({ alg: "ES256", typ: "JWT", kid: key.kid }));
  const body = b64(JSON.stringify(claims));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64(sig)}`;
}

/** The public keys apps check ID tokens with. */
export async function jwks(): Promise<{ keys: Record<string, string>[] }> {
  return { keys: [(await signingKey()).publicJwk] };
}
