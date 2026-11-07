// Communities round (Nov 2026): Sign in with Glofly (OAuth 2.0 + OpenID Connect, PKCE), against a
// real server with real Postgres and Redis. Not part of `npm test`:
//
//   npm run dev -w apps/server
//   GLOFLY_E2E_URL=http://localhost:4000 npx tsx --env-file=../../.env --test test/oauth.e2e.ts
//
// The consent page's calls (/oauth/request, /approve) are made here with a session token, the way
// chat.glofly.app makes them with its cookie.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ ? "set GLOFLY_E2E_URL to a running dev server" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.0" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
const REDIRECT = "https://app.example.net/auth/glofly/callback";
let pool: pg.Pool;

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...H, ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}
/** The token endpoint, form-encoded like real OAuth libraries send it. */
async function tokenCall(form: Record<string, string>, basic?: [string, string]) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (basic) headers.authorization = "Basic " + Buffer.from(`${basic[0]}:${basic[1]}`).toString("base64");
  const r = await fetch(URL_ + "/oauth/token", { method: "POST", headers, body: new URLSearchParams(form).toString() });
  return { status: r.status, json: await r.json() };
}
async function account(name: string) {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", { method: "POST", body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}
const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

let dev: { id: string; token: string; username: string };
let riley: { id: string; token: string; username: string };
let app: { id: string; clientId: string };
let secret: string;
let cid: string;
let modRole: string;

before(async () => {
  if (skip) return;
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  dev = await account("dev");
  riley = await account("oriley");
  const made = await call("/constellations", { method: "POST", token: riley.token, body: { name: `OAuth ${tag}`, template: "gaming" } });
  cid = made.json.constellation.id;
  modRole = (await pool.query("select id from constellation_roles where constellation_id = $1 and kind = 'moderator'", [cid])).rows[0].id;
  await pool.query("insert into constellation_member_roles (constellation_id, user_id, role_id) values ($1, $2, $3)", [cid, riley.id, modRole]);
});

after(async () => {
  if (skip) return;
  await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from oauth_apps where owner_id = $1", [dev.id]);
  await pool.end();
});

test("discovery and keys", { skip }, async () => {
  const d = await call("/.well-known/openid-configuration");
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.response_types_supported, ["code"]);
  assert.deepEqual(d.json.code_challenge_methods_supported, ["S256"]);
  const k = await call("/oauth/jwks");
  // RS256 first (what Apple and Google use; OpenID Connect requires it), the old ES256 key after it.
  assert.equal(k.json.keys[0].kty, "RSA");
  assert.equal(k.json.keys[0].alg, "RS256");
  assert.deepEqual(d.json.id_token_signing_alg_values_supported, ["RS256"]);
  assert.equal(k.json.keys[0].d, undefined, "never the private part");
});

test("developers register apps; return addresses are checked", { skip }, async () => {
  const bad = await call("/developer/apps", { method: "POST", token: dev.token, body: { name: "Bad", redirectUris: ["http://evil.example/cb"], scopes: [] } });
  assert.equal(bad.status, 400);
  const js = await call("/developer/apps", { method: "POST", token: dev.token, body: { name: "Bad", redirectUris: ["javascript://x"], scopes: [] } });
  assert.equal(js.status, 400);
  const base = { name: "Cozy RP Website", website: "https://app.example.net", redirectUris: [REDIRECT], scopes: ["email", "roles"], confidential: true };
  // The Developer Terms and a privacy policy link are required for a new app.
  const noTerms = await call("/developer/apps", { method: "POST", token: dev.token, body: { ...base, privacyUrl: "https://app.example.net/privacy" } });
  assert.equal(noTerms.status, 400);
  assert.equal(noTerms.json.error, "terms");
  const noPolicy = await call("/developer/apps", { method: "POST", token: dev.token, body: { ...base, agreeTerms: true } });
  assert.equal(noPolicy.status, 400);
  const r = await call("/developer/apps", { method: "POST", token: dev.token, body: { ...base, privacyUrl: "https://app.example.net/privacy", agreeTerms: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  app = r.json.app;
  assert.equal(app.privacyUrl, "https://app.example.net/privacy");
  assert.ok(app.devTermsVersion);
  // Changing one thing leaves the rest alone (the website and scopes stay).
  const renamed = await call(`/developer/apps/${app.id}`, { method: "PATCH", token: dev.token, body: { name: "Cozy RP Website" } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.app.website, "https://app.example.net");
  assert.deepEqual(renamed.json.app.scopes, ["email", "roles"]);
  assert.equal(renamed.json.app.privacyUrl, "https://app.example.net/privacy");
  const cleared = await call(`/developer/apps/${app.id}`, { method: "PATCH", token: dev.token, body: { privacyUrl: "" } });
  assert.equal(cleared.status, 400, "a privacy policy link can't be removed");
  secret = r.json.secret;
  assert.match(app.clientId, /^gfa_/);
  assert.match(secret, /^gfs_/);
  const stored = await pool.query("select client_secret_hash from oauth_apps where id = $1", [app.id]);
  assert.notEqual(stored.rows[0].client_secret_hash, secret);
});

const params = (extra: Record<string, string> = {}) => ({ client_id: app.clientId, redirect_uri: REDIRECT, response_type: "code", scope: "openid profile email roles", state: "xyz", ...extra });

test("the consent request refuses unregistered addresses, missing PKCE and extra scopes", { skip }, async () => {
  const { challenge } = pkce();
  assert.equal((await call(`/oauth/request?${q(params({ redirect_uri: REDIRECT + "x", code_challenge: challenge, code_challenge_method: "S256" }))}`, { token: riley.token })).status, 400);
  assert.equal((await call(`/oauth/request?${q(params())}`, { token: riley.token })).status, 400, "no PKCE");
  assert.equal((await call(`/oauth/request?${q(params({ code_challenge: challenge, code_challenge_method: "plain" }))}`, { token: riley.token })).status, 400);
  assert.equal((await call(`/oauth/request?${q(params({ scope: "openid admin", code_challenge: challenge, code_challenge_method: "S256" }))}`, { token: riley.token })).status, 400);
  assert.equal((await call(`/oauth/request?${q(params({ code_challenge: challenge, code_challenge_method: "S256" }))}`)).status, 401, "signed in only");
  const ok = await call(`/oauth/request?${q(params({ code_challenge: challenge, code_challenge_method: "S256" }))}`, { token: riley.token });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.app.name, "Cozy RP Website");
  assert.equal(ok.json.app.privacyUrl, "https://app.example.net/privacy", "the consent page links the app's privacy policy");
  assert.ok(ok.json.constellations.some((c: any) => c.id === cid));
});

let refresh: string;
let access: string;

test("code + PKCE → tokens; a signed ID token; email only when agreed; roles for picked constellations", { skip }, async () => {
  const { verifier, challenge } = pkce();
  const ap = await call("/oauth/approve", { method: "POST", token: riley.token, body: { ...params({ code_challenge: challenge, code_challenge_method: "S256", nonce: "n-123" }), email: false, constellationIds: [cid] } });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const back = new URL(ap.json.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "xyz");
  const code = back.searchParams.get("code")!;
  const wrong = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: pkce().verifier }, [app.clientId, secret]);
  assert.equal(wrong.json.error, "invalid_grant");
  // That wrong try used the code up: a stolen code can't be tried twice.
  const { verifier: v2, challenge: c2 } = pkce();
  const ap2 = await call("/oauth/approve", { method: "POST", token: riley.token, body: { ...params({ code_challenge: c2, code_challenge_method: "S256", nonce: "n-123" }), email: false, constellationIds: [cid] } });
  const code2 = new URL(ap2.json.redirect).searchParams.get("code")!;
  assert.equal((await tokenCall({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: v2 }, [app.clientId, "gfs_wrong"])).status, 401);
  const { verifier: v3, challenge: c3 } = pkce();
  const ap3 = await call("/oauth/approve", { method: "POST", token: riley.token, body: { ...params({ code_challenge: c3, code_challenge_method: "S256", nonce: "n-123" }), email: false, constellationIds: [cid] } });
  const code3 = new URL(ap3.json.redirect).searchParams.get("code")!;
  const t = await tokenCall({ grant_type: "authorization_code", code: code3, redirect_uri: REDIRECT, code_verifier: v3 }, [app.clientId, secret]);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.match(t.json.access_token, /^gfo_/);
  assert.match(t.json.refresh_token, /^gfr_/);
  assert.equal((await tokenCall({ grant_type: "authorization_code", code: code3, redirect_uri: REDIRECT, code_verifier: v3 }, [app.clientId, secret])).json.error, "invalid_grant", "one use");
  void verifier;
  access = t.json.access_token;
  refresh = t.json.refresh_token;
  // The ID token, checked with the published key.
  const [h, p, s] = t.json.id_token.split(".");
  const head = JSON.parse(Buffer.from(h, "base64url").toString());
  assert.equal(head.alg, "RS256");
  const jwk = (await call("/oauth/jwks")).json.keys.find((x: any) => x.kid === head.kid);
  const key = createPublicKey({ key: jwk, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.sub, riley.id);
  assert.equal(claims.aud, app.clientId);
  assert.equal(claims.nonce, "n-123");
  assert.equal(claims.email, undefined, "email not agreed");
  const info = await call("/oauth/userinfo", { token: access });
  assert.equal(info.status, 200);
  assert.equal(info.json.preferred_username, riley.username);
  assert.equal(info.json.email, undefined);
  assert.deepEqual(info.json.constellations[0].roles.map((r: any) => r.id), [modRole]);
  // A Glofly session token is not an access token, and an access token is not a session.
  assert.equal((await call("/oauth/userinfo", { token: riley.token })).status, 401);
  assert.equal((await call("/constellations", { token: access })).status, 401);
});

test("refresh tokens rotate; using an old one again signs the app out", { skip }, async () => {
  const r1 = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh }, [app.clientId, secret]);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.notEqual(r1.json.refresh_token, refresh);
  assert.equal((await call("/oauth/userinfo", { token: r1.json.access_token })).status, 200);
  const replay = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh }, [app.clientId, secret]);
  assert.equal(replay.json.error, "invalid_grant");
  assert.equal((await call("/oauth/userinfo", { token: r1.json.access_token })).status, 401, "the whole family is gone");
  assert.equal((await tokenCall({ grant_type: "refresh_token", refresh_token: r1.json.refresh_token }, [app.clientId, secret])).json.error, "invalid_grant");
});

test("phone apps (no secret) use PKCE alone; server apps must send their secret", { skip }, async () => {
  const r = await call("/developer/apps", { method: "POST", token: dev.token, body: { name: "Gloslate", redirectUris: ["gloslate://auth"], scopes: [], confidential: false, privacyUrl: "https://gloslate.app/privacy", agreeTerms: true } });
  assert.equal(r.status, 201);
  assert.equal(r.json.secret, null);
  const phone = r.json.app;
  const { verifier, challenge } = pkce();
  const ap = await call("/oauth/approve", { method: "POST", token: riley.token, body: { client_id: phone.clientId, redirect_uri: "gloslate://auth", response_type: "code", scope: "openid profile", code_challenge: challenge, code_challenge_method: "S256" } });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.match(ap.json.redirect, /^gloslate:\/\/auth\?code=/);
  const code = new URL(ap.json.redirect).searchParams.get("code")!;
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: "gloslate://auth", code_verifier: verifier, client_id: phone.clientId });
  assert.equal(t.status, 200, JSON.stringify(t.json));
  // The confidential app without its secret:
  assert.equal((await tokenCall({ grant_type: "refresh_token", refresh_token: "gfr_x", client_id: app.clientId })).status, 401);
});

test("Connected apps: listed, and disconnecting kills its tokens", { skip }, async () => {
  const { verifier, challenge } = pkce();
  const ap = await call("/oauth/approve", { method: "POST", token: riley.token, body: { ...params({ code_challenge: challenge, code_challenge_method: "S256" }), email: true, constellationIds: [] } });
  const code = new URL(ap.json.redirect).searchParams.get("code")!;
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier }, [app.clientId, secret]);
  const info = await call("/oauth/userinfo", { token: t.json.access_token });
  assert.equal(info.json.email, `${riley.username}@example.com`, "agreed this time");
  assert.equal(info.json.constellations, undefined, "no constellations picked: no roles");
  const list = await call("/account/connected-apps", { token: riley.token });
  assert.ok(list.json.apps.some((a: any) => a.appId === app.id));
  assert.equal((await call(`/account/connected-apps/${app.id}`, { method: "DELETE", token: riley.token })).status, 200);
  assert.equal((await call("/oauth/userinfo", { token: t.json.access_token })).status, 401);
  assert.equal((await tokenCall({ grant_type: "refresh_token", refresh_token: t.json.refresh_token }, [app.clientId, secret])).json.error, "invalid_grant");
});

test("an app switched off in Control stops working; family accounts can't use apps", { skip }, async () => {
  const { verifier, challenge } = pkce();
  const ap = await call("/oauth/approve", { method: "POST", token: riley.token, body: { ...params({ code_challenge: challenge, code_challenge_method: "S256" }), email: false, constellationIds: [] } });
  const code = new URL(ap.json.redirect).searchParams.get("code")!;
  const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier }, [app.clientId, secret]);
  await pool.query("update oauth_apps set disabled_at = now() where id = $1", [app.id]);
  try {
    assert.equal((await call("/oauth/userinfo", { token: t.json.access_token })).status, 401);
    assert.equal((await call(`/oauth/request?${q(params({ code_challenge: challenge, code_challenge_method: "S256" }))}`, { token: riley.token })).status, 400);
  } finally {
    await pool.query("update oauth_apps set disabled_at = null where id = $1", [app.id]);
  }
  const kid = await account("okid");
  await pool.query("update users set restricted = true where id = $1", [kid.id]);
  assert.equal((await call(`/oauth/request?${q(params({ code_challenge: challenge, code_challenge_method: "S256" }))}`, { token: kid.token })).status, 403);
});

test("only the owner sees or changes an app", { skip }, async () => {
  assert.equal((await call(`/developer/apps/${app.id}`, { method: "PATCH", token: riley.token, body: { name: "Mine" } })).status, 404);
  assert.equal((await call(`/developer/apps/${app.id}/secret`, { method: "POST", token: riley.token })).status, 404);
  const mine = await call("/developer/apps", { token: riley.token });
  assert.ok(!mine.json.apps.some((a: any) => a.id === app.id));
});
