import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverSettings } from "../db/schema";

// Communities round (Nov 2026): Sign in with Glofly's ID tokens are JWTs signed with RS256 (RSA 2048),
// like Apple's and Google's: OpenID Connect requires providers to support RS256, and many apps
// (Gloslate's verifier among them) only accept it. Each key is made once and kept in
// server_settings as a private JWK; the public halves are published at /oauth/jwks so apps can check
// tokens came from Glofly. The first key (ES256, "oauth_signing_key") stays published so tokens it
// signed can still be checked, but new tokens are RS256.

type Alg = "RS256" | "ES256";
const SETTINGS: Record<Alg, string> = { RS256: "oauth_signing_key_rs256", ES256: "oauth_signing_key" };
type Stored = { kid: string; jwk: Record<string, string> };
type Key = { kid: string; privateKey: KeyObject; publicJwk: Record<string, string> };
const cached = new Map<Alg, Key>();

function generate(alg: Alg): KeyObject {
  return alg === "RS256"
    ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    : generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
}

async function signingKey(alg: Alg): Promise<Key> {
  const hit = cached.get(alg);
  if (hit) return hit;
  const setting = SETTINGS[alg];
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, setting));
  let stored = row?.value as Stored | undefined;
  if (!stored?.jwk?.d) {
    stored = { kid: randomUUID().slice(0, 8), jwk: generate(alg).export({ format: "jwk" }) as Record<string, string> };
    // Two servers starting at once: the first one written wins, everyone reads it back.
    await db.insert(serverSettings).values({ key: setting, value: stored }).onConflictDoNothing();
    const [again] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, setting));
    stored = again.value as Stored;
  }
  const privateKey = createPrivateKey({ key: stored.jwk, format: "jwk" });
  const pub = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, string>;
  delete pub.d;
  const key = { kid: stored.kid, privateKey, publicJwk: { ...pub, kid: stored.kid, use: "sig", alg } };
  cached.set(alg, key);
  return key;
}

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** A signed JWT (RS256). */
export async function signJwt(claims: Record<string, unknown>): Promise<string> {
  const key = await signingKey("RS256");
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid }));
  const body = b64(JSON.stringify(claims));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), key.privateKey);
  return `${head}.${body}.${b64(sig)}`;
}

/** The public keys apps check ID tokens with (the signing key first). */
export async function jwks(): Promise<{ keys: Record<string, string>[] }> {
  return { keys: [(await signingKey("RS256")).publicJwk, (await signingKey("ES256")).publicJwk] };
}
