// 0.9.3 Connections (Steam, Twitch, Kick) against a real server, with a stand-in for all three
// sites on this computer (the sandbox can't reach them). Start the server with:
//   STEAM_API_KEY=sk STEAM_OPENID_URL=http://127.0.0.1:4792/openid STEAM_API_URL=http://127.0.0.1:4792/steam \
//   TWITCH_CLIENT_ID=tw TWITCH_CLIENT_SECRET=tws TWITCH_ID_URL=http://127.0.0.1:4792/twid TWITCH_API_URL=http://127.0.0.1:4792/helix \
//   KICK_CLIENT_ID=kc KICK_CLIENT_SECRET=kcs KICK_ID_URL=http://127.0.0.1:4792/kid KICK_API_URL=http://127.0.0.1:4792/kick \
//   YOUTUBE_HUB_URL=http://127.0.0.1:4792/yt/hub YOUTUBE_FEED_URL=http://127.0.0.1:4792/yt/feed \
//   npx tsx src/index.ts
// then run with GLOFLY_E2E_URL=http://localhost:4000 GLOFLY_E2E_CONNECTIONS=1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ || !process.env.GLOFLY_E2E_CONNECTIONS ? "set GLOFLY_E2E_URL and GLOFLY_E2E_CONNECTIONS (server pointed at the stand-in)" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.3" };
const PASSWORD = "glofly-e2e-" + randomBytes(4).toString("hex");
const tag = randomBytes(3).toString("hex");
const num = () => String(10_000_000 + Math.floor(Math.random() * 80_000_000));
const STEAM_ID = `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
const TWITCH_ID = num();
const KICK_ID = num();
// The same stand-in key every run (the server keeps Kick's key and asks again at most once a minute).
const KEY_FILE = join(tmpdir(), "glofly-e2e-kick-key.pem");
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
const kickPrivate = createPrivateKey(readFileSync(KEY_FILE));
const kickKeys = { privateKey: kickPrivate, publicKey: createPublicKey(kickPrivate) };

// ---- the stand-in ----
const KROOF_ID = num();
const YT_ID = `UC${randomBytes(16).toString("base64url").slice(0, 22)}`;
const seen = { hub: [] as URLSearchParams[], checkAuth: 0, eventsubCreated: [] as string[], eventsubDeleted: [] as string[], kickSubs: 0, revoked: 0, pkce: "" };
let standIn: Server;
let twitchLive = false;

function standInHandler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, body: string) {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (v: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(v));
  // Steam
  if (url.pathname === "/openid" && req.method === "POST") {
    seen.checkAuth++;
    const p = new URLSearchParams(body);
    const ok = p.get("openid.mode") === "check_authentication" && p.get("openid.sig") === "good";
    res.writeHead(200, { "content-type": "text/plain" }).end(`ns:http://specs.openid.net/auth/2.0\nis_valid:${ok}\n`);
    return;
  }
  if (url.pathname === "/steam/IPlayerService/GetOwnedGames/v1/") {
    if (url.searchParams.get("key") !== "sk") return json({}, 403);
    return json({
      response: {
        games: [
          { appid: 413150, name: `Stardew ${tag}`, playtime_forever: 600, rtime_last_played: 1_700_000_000 },
          { appid: 10, name: `Never played ${tag}`, playtime_forever: 0 },
        ],
      },
    });
  }
  if (url.pathname === "/steam/ISteamUser/GetPlayerSummaries/v2/") {
    return json({
      response: {
        players: (url.searchParams.get("steamids") ?? "").split(",").map((id) => ({
          steamid: id,
          personaname: "Chip on Steam",
          profileurl: `https://steamcommunity.com/profiles/${id}/`,
          communityvisibilitystate: 3,
          gameextrainfo: `Stardew ${tag}`,
        })),
      },
    });
  }
  // Twitch
  if (url.pathname === "/twid/oauth2/token") {
    const p = url.searchParams.get("grant_type") ? url.searchParams : new URLSearchParams(body);
    if (p.get("client_id") !== "tw" || p.get("client_secret") !== "tws") return json({}, 403);
    if (p.get("grant_type") === "authorization_code" && p.get("code") !== "good-code") return json({}, 400);
    return json({ access_token: p.get("grant_type") === "client_credentials" ? "tw-app" : "tw-user", expires_in: 5000 });
  }
  if (url.pathname === "/twid/oauth2/revoke") {
    seen.revoked++;
    return json({});
  }
  if (url.pathname === "/helix/users" && url.searchParams.get("login")) {
    if (req.headers.authorization !== "Bearer tw-app") return json({}, 401);
    const login = url.searchParams.get("login");
    return json({ data: login === `kroof${tag}` ? [{ id: KROOF_ID, login, display_name: `Kroof${tag}` }] : [] });
  }
  if (url.pathname === "/helix/users") {
    if (req.headers.authorization !== "Bearer tw-user") return json({}, 401);
    return json({ data: [{ id: TWITCH_ID, login: `chip${tag}`, display_name: `Chip${tag}` }] });
  }
  if (url.pathname === "/helix/streams") {
    if (req.headers.authorization !== "Bearer tw-app") return json({}, 401);
    return json({
      data: twitchLive
        ? [{ title: "Speedrun night @everyone", game_name: "Celeste", started_at: "2026-11-08T20:00:00Z", viewer_count: 12, thumbnail_url: "https://static-cdn.jtvnw.net/x-{width}x{height}.jpg" }]
        : [],
    });
  }
  if (url.pathname === "/helix/eventsub/subscriptions" && req.method === "POST") {
    const b = JSON.parse(body);
    assert.equal(b.transport.method, "webhook");
    assert.ok(String(b.transport.callback).endsWith("/hooks/twitch"));
    const id = `sub-${b.type}-${tag}`;
    seen.eventsubCreated.push(id);
    return json({ data: [{ id }] }, 202);
  }
  if (url.pathname === "/helix/eventsub/subscriptions" && req.method === "DELETE") {
    seen.eventsubDeleted.push(url.searchParams.get("id") ?? "");
    return res.writeHead(204).end();
  }
  // Kick
  if (url.pathname === "/kid/oauth/token") {
    const p = new URLSearchParams(body);
    if (p.get("client_id") !== "kc" || p.get("client_secret") !== "kcs") return json({}, 403);
    if (p.get("grant_type") === "authorization_code") {
      if (p.get("code") !== "kick-code" || !p.get("code_verifier")) return json({}, 400);
      seen.pkce = p.get("code_verifier") ?? "";
      return json({ access_token: "kick-user", expires_in: 5000 });
    }
    return json({ access_token: "kick-app", expires_in: 5000 });
  }
  if (url.pathname === "/kid/oauth/revoke") {
    seen.revoked++;
    return json({});
  }
  if (url.pathname === "/kick/users") {
    if (req.headers.authorization !== "Bearer kick-user") return json({}, 401);
    return json({ data: [{ user_id: Number(KICK_ID), name: `Maya_${tag}` }] });
  }
  if (url.pathname === "/kick/channels") return json({ data: [{ broadcaster_user_id: Number(KICK_ID), slug: `maya-${tag}` }] });
  if (url.pathname === "/kick/livestreams") return json({ data: [] });
  if (url.pathname === "/kick/events/subscriptions" && req.method === "POST") {
    seen.kickSubs++;
    return json({ data: [{ subscription_id: `kick-sub-${tag}` }] });
  }
  if (url.pathname === "/kick/events/subscriptions" && req.method === "DELETE") return res.writeHead(204).end();
  // YouTube
  if (url.pathname === "/yt/feed") {
    if (url.searchParams.get("channel_id") !== YT_ID) return res.writeHead(404).end();
    return res.writeHead(200, { "content-type": "application/atom+xml" }).end(`<?xml version="1.0"?><feed><title>Night Raiders TV &amp; friends</title></feed>`);
  }
  if (url.pathname === "/yt/hub/subscribe") {
    seen.hub.push(new URLSearchParams(body));
    return res.writeHead(202).end();
  }
  if (url.pathname === "/kick/public-key") return json({ data: { public_key: kickKeys.publicKey.export({ type: "spki", format: "pem" }) } });
  res.writeHead(404).end();
}

let pool: pg.Pool;
async function call(path: string, opts: { method?: string; body?: unknown; token?: string; headers?: Record<string, string>; rawText?: string } = {}) {
  const headers: Record<string, string> = { ...H, ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.rawText ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    redirect: "manual",
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, text, headers: r.headers };
}
async function account(name: string) {
  const username = `${name}${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: name, password: PASSWORD, birthday: "1995-05-14", acceptTerms: true },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.user.id as string, token: r.json.token as string, username };
}
async function befriend(a: { token: string; username: string }, b: { token: string; username: string }) {
  assert.ok((await call("/friends/requests", { method: "POST", token: a.token, body: { username: b.username } })).status < 300);
  const req = (await call("/friends", { token: b.token })).json.incoming.find((p: any) => p.username === a.username);
  assert.ok((await call(`/friends/requests/${req.id}/accept`, { method: "POST", token: b.token })).status < 300);
}
/** The browser's trip back from the site: the return address from the start link + the site's answer. */
async function startLink(token: string, provider: string) {
  const r = await call(`/connections/${provider}/start`, { method: "POST", token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return new URL(r.json.url as string);
}
/** The "Link X to Glofly?" page: its account line, then pressing Link (or Cancel). */
async function confirmLink(page: { status: number; text: string }, answer: "yes" | "no" = "yes") {
  assert.equal(page.status, 200, page.text);
  assert.match(page.text, /to Glofly\?/);
  const token = /name="token" value="([A-Za-z0-9_-]+)"/.exec(page.text)?.[1];
  assert.ok(token, "the page carries a one-use token");
  const r = await fetch(URL_ + "/connections/confirm", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: token!, answer }).toString(),
  });
  return { status: r.status, text: await r.text() };
}
const pathOf = (u: string) => {
  const x = new URL(u);
  return x.pathname + x.search;
};
const wait = async (check: () => Promise<boolean>, what: string) => {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`timed out waiting for ${what}`);
};
async function twitchHook(type: string, body: unknown, opts: { secret?: string; at?: Date; id?: string } = {}) {
  const secret = opts.secret ?? ((await pool.query("select value from server_settings where key = 'twitch_eventsub_secret'")).rows[0]?.value.secret as string);
  const id = opts.id ?? randomBytes(8).toString("hex");
  const at = (opts.at ?? new Date()).toISOString();
  const text = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", secret).update(id + at + text).digest("hex");
  return call("/hooks/twitch", {
    method: "POST",
    rawText: text,
    headers: { "Twitch-Eventsub-Message-Id": id, "Twitch-Eventsub-Message-Timestamp": at, "Twitch-Eventsub-Message-Signature": sig, "Twitch-Eventsub-Message-Type": type },
  });
}
async function kickHook(body: unknown, opts: { key?: import("node:crypto").KeyObject; at?: Date } = {}) {
  const id = randomBytes(8).toString("hex");
  const at = (opts.at ?? new Date()).toISOString();
  const text = JSON.stringify(body);
  const signature = sign("RSA-SHA256", Buffer.from(`${id}.${at}.${text}`), opts.key ?? kickKeys.privateKey).toString("base64");
  return call("/hooks/kick", {
    method: "POST",
    rawText: text,
    headers: { "Kick-Event-Message-Id": id, "Kick-Event-Message-Timestamp": at, "Kick-Event-Signature": signature, "Kick-Event-Type": "livestream.status.updated", "Kick-Event-Version": "1" },
  });
}

let chip: Awaited<ReturnType<typeof account>>;
let maya: Awaited<ReturnType<typeof account>>;
let other: Awaited<ReturnType<typeof account>>;

before(async () => {
  if (skip) return;
  standIn = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        standInHandler(req, res, body);
      } catch (err) {
        console.error(err);
        res.writeHead(500).end();
      }
    });
  });
  await new Promise<void>((r) => standIn.listen(4792, "127.0.0.1", r));
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  chip = await account("cnchip");
  maya = await account("cnmaya");
  other = await account("cnother");
  await befriend(chip, maya);
});

after(async () => {
  if (skip) return;
  if (cid) await pool.query("delete from constellations where id = $1", [cid]);
  await pool.query("delete from users where id = any($1)", [[chip.id, maya.id, other.id]]);
  await pool.query("delete from stream_watches where channel_id = any($1)", [[TWITCH_ID, KICK_ID, KROOF_ID, YT_ID]]);
  await pool.end();
  standIn.close();
});

test("lists what this server can link", { skip }, async () => {
  const r = await call("/connections", { token: chip.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.available, { steam: true, twitch: true, kick: true });
  assert.deepEqual(r.json.accounts, []);
  assert.equal((await call("/connections")).status, 401);
  assert.equal((await call("/connections/myspace/start", { method: "POST", token: chip.token })).status, 404);
});

test("Steam: link checks Steam's answer, syncs played games into My games", { skip }, async () => {
  const start = await startLink(chip.token, "steam");
  const returnTo = start.searchParams.get("openid.return_to")!;
  assert.match(returnTo, /\/connections\/steam\/return\?state=/);
  const answer = (sig: string, claimed = `https://steamcommunity.com/openid/id/${STEAM_ID}`, rt = returnTo) =>
    new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "id_res",
      "openid.op_endpoint": "https://steamcommunity.com/openid/login",
      "openid.claimed_id": claimed,
      "openid.identity": claimed,
      "openid.return_to": rt,
      "openid.response_nonce": "2026-11-08T00:00:00Zx",
      "openid.assoc_handle": "1234567890",
      "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
      "openid.sig": sig,
    });
  // A forged answer (Steam says is_valid:false): nothing linked, and the state is used up.
  const forged = await call(`${pathOf(returnTo)}&${answer("forged")}`);
  assert.equal(forged.status, 400);
  assert.match(forged.text, /Steam didn(&#39;|')t confirm it/);
  assert.match(forged.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal((await call(`${pathOf(returnTo)}&${answer("good")}`)).status, 400, "a state works once");

  const again = (await startLink(chip.token, "steam")).searchParams.get("openid.return_to")!;
  // An answer meant for a different return address is refused without asking Steam.
  const checks = seen.checkAuth;
  assert.equal((await call(`${pathOf(again)}&${answer("good", undefined, "https://evil.example/connections/steam/return")}`)).status, 400);
  assert.equal(seen.checkAuth, checks);
  const third = (await startLink(chip.token, "steam")).searchParams.get("openid.return_to")!;
  const asked = await call(`${pathOf(third)}&${answer("good", `https://steamcommunity.com/openid/id/${STEAM_ID}`, third)}`);
  // It names the Glofly account it's for, and nothing is linked until Link is pressed.
  assert.match(asked.text, new RegExp(`@${chip.username}`));
  assert.equal((await call("/connections", { token: chip.token })).json.accounts.length, 0);
  const ok = await confirmLink(asked);
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.text, /Steam is linked/);
  // The token works once.
  const again2 = await fetch(URL_ + "/connections/confirm", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "token=" + /name="token" value="([^"]+)"/.exec(asked.text)![1] + "&answer=yes" });
  assert.equal(again2.status, 400);
  await wait(async () => (await call("/games/me", { token: chip.token })).json.games.some((g: any) => g.name === `Stardew ${tag}`), "Steam games");
  const games = (await call("/games/me", { token: chip.token })).json.games;
  const stardew = games.find((g: any) => g.name === `Stardew ${tag}`);
  assert.equal(stardew.seconds, 600 * 60);
  assert.equal(stardew.steam, true);
  assert.ok(!games.some((g: any) => g.name === `Never played ${tag}`), "unplayed games stay out");
  const view = (await call("/connections", { token: chip.token })).json.accounts.find((a: any) => a.provider === "steam");
  assert.equal(view.displayName, "Chip on Steam");
  assert.equal(view.gameCount, 1);
  assert.equal(JSON.stringify(view).includes(STEAM_ID) && !view.profileUrl.includes(STEAM_ID), false, "only the public page carries the id");

  // "Show in My games" off: Steam's time stops counting and Steam-only games leave the list.
  const off = await call("/connections/steam", { method: "PATCH", token: chip.token, body: { settings: { myGames: false } } });
  assert.equal(off.status, 200);
  assert.equal(off.json.account.settings.myGames, false);
  assert.ok(!(await call("/games/me", { token: chip.token })).json.games.some((g: any) => g.name === `Stardew ${tag}`));
  await call("/connections/steam", { method: "PATCH", token: chip.token, body: { settings: { myGames: true } } });
  assert.equal((await call("/connections/steam", { method: "PATCH", token: chip.token, body: { settings: { secret: 1 } } })).status, 400);

  // Signing in on Steam again from another Glofly account says so; Cancel changes nothing, Link
  // moves it (whoever can sign in to the Steam account owns it).
  const otherReturn = (await startLink(other.token, "steam")).searchParams.get("openid.return_to")!;
  const dup = await call(`${pathOf(otherReturn)}&${answer("good", `https://steamcommunity.com/openid/id/${STEAM_ID}`, otherReturn)}`);
  assert.match(dup.text, /linked to another Glofly account now/);
  assert.match((await confirmLink(dup, "no")).text, /wasn(&#39;|')t linked/);
  assert.ok((await call("/connections", { token: chip.token })).json.accounts.some((a: any) => a.provider === "steam"));
  const otherReturn2 = (await startLink(other.token, "steam")).searchParams.get("openid.return_to")!;
  const moved = await confirmLink(await call(`${pathOf(otherReturn2)}&${answer("good", `https://steamcommunity.com/openid/id/${STEAM_ID}`, otherReturn2)}`));
  assert.match(moved.text, /Steam is linked/);
  assert.ok(!(await call("/connections", { token: chip.token })).json.accounts.some((a: any) => a.provider === "steam"));
  assert.ok(!(await call("/games/me", { token: chip.token })).json.games.some((g: any) => g.name === `Stardew ${tag}`), "moved away: Steam's games go too");
  assert.equal((await call("/connections/steam", { method: "DELETE", token: other.token })).status, 204);
  // Back to Chip for the rest.
  const back = (await startLink(chip.token, "steam")).searchParams.get("openid.return_to")!;
  await confirmLink(await call(`${pathOf(back)}&${answer("good", `https://steamcommunity.com/openid/id/${STEAM_ID}`, back)}`));
  await wait(async () => (await call("/games/me", { token: chip.token })).json.games.some((g: any) => g.name === `Stardew ${tag}`), "Steam games again");

  // Unlinking takes Steam's games out.
  assert.equal((await call("/connections/steam", { method: "DELETE", token: chip.token })).status, 204);
  assert.ok(!(await call("/games/me", { token: chip.token })).json.games.some((g: any) => g.name === `Stardew ${tag}`));
});

test("Twitch: link, listen, went-live tells friends, signatures are checked", { skip }, async () => {
  const start = await startLink(chip.token, "twitch");
  const state = start.searchParams.get("state")!;
  const redirect = start.searchParams.get("redirect_uri")!;
  assert.equal(start.searchParams.get("scope"), "", "asks for nothing beyond who you are");
  assert.equal((await call(`${pathOf(redirect)}?code=bad&state=${state}`)).status, 502);
  const s2 = (await startLink(chip.token, "twitch")).searchParams.get("state")!;
  // Twitch's state can't be used for Kick.
  assert.equal((await call(`/connections/kick/return?code=good-code&state=${s2}`)).status, 400);
  const s3 = (await startLink(chip.token, "twitch")).searchParams.get("state")!;
  const revokedBefore = seen.revoked;
  const linked = await confirmLink(await call(`${pathOf(redirect)}?code=good-code&state=${s3}`));
  assert.equal(linked.status, 200, linked.text);
  assert.match(linked.text, /Twitch is linked/);
  await wait(async () => seen.revoked > revokedBefore, "the user token revoked");
  await wait(async () => (await pool.query("select subscription_ids from stream_watches where provider = 'twitch' and channel_id = $1", [TWITCH_ID])).rows[0]?.subscription_ids.length === 2, "EventSub subscriptions");

  // Twitch's handshake.
  const challenge = await twitchHook("webhook_callback_verification", { challenge: "pls-echo", subscription: { id: "x", type: "stream.online", condition: { broadcaster_user_id: TWITCH_ID } } });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.text, "pls-echo");

  // Wrong secret, stale timestamp: refused.
  const online = { subscription: { id: "s", type: "stream.online", condition: { broadcaster_user_id: TWITCH_ID } }, event: { broadcaster_user_id: TWITCH_ID, broadcaster_user_login: `chip${tag}`, started_at: "2026-11-08T20:00:00Z" } };
  assert.equal((await twitchHook("notification", online, { secret: "nope" })).status, 403);
  assert.equal((await twitchHook("notification", online, { at: new Date(Date.now() - 20 * 60_000) })).status, 403);
  assert.equal((await call("/connections/friends-live", { token: maya.token })).json.streams.length, 0);

  twitchLive = true;
  assert.equal((await twitchHook("notification", online)).status, 204);
  await wait(async () => (await call("/connections/friends-live", { token: maya.token })).json.streams.length === 1, "Maya sees Chip live");
  const stream = (await call("/connections/friends-live", { token: maya.token })).json.streams[0];
  assert.equal(stream.userId, chip.id);
  assert.equal(stream.source, "twitch");
  assert.equal(stream.title, "Speedrun night @everyone");
  assert.equal(stream.game, "Celeste");
  assert.equal(stream.url, `https://www.twitch.tv/chip${tag}`);
  assert.equal((await call("/connections/friends-live", { token: other.token })).json.streams.length, 0, "not friends: nothing");

  // "Show LIVE on my profile" off hides it from friends.
  await call("/connections/twitch", { method: "PATCH", token: chip.token, body: { settings: { showLive: false, chosen: [maya.id, other.id] } } });
  assert.equal((await call("/connections/friends-live", { token: maya.token })).json.streams.length, 0);
  const view = (await call("/connections", { token: chip.token })).json.accounts.find((a: any) => a.provider === "twitch");
  assert.deepEqual(view.settings.chosen, [maya.id], "only friends can be chosen");
  await call("/connections/twitch", { method: "PATCH", token: chip.token, body: { settings: { showLive: true } } });

  // Muting someone's live alerts.
  assert.equal((await call(`/connections/muted-live/${chip.id}`, { method: "PUT", token: maya.token, body: { muted: true } })).status, 200);
  assert.deepEqual((await pool.query("select muted_live_alerts from users where id = $1", [maya.id])).rows[0].muted_live_alerts, [chip.id]);
  await call(`/connections/muted-live/${chip.id}`, { method: "PUT", token: maya.token, body: { muted: true } });
  assert.equal((await pool.query("select muted_live_alerts from users where id = $1", [maya.id])).rows[0].muted_live_alerts.length, 1, "kept once");
  await call(`/connections/muted-live/${chip.id}`, { method: "PUT", token: maya.token, body: { muted: false } });

  // Offline.
  twitchLive = false;
  assert.equal((await twitchHook("notification", { subscription: { id: "s", type: "stream.offline", condition: { broadcaster_user_id: TWITCH_ID } }, event: { broadcaster_user_id: TWITCH_ID } })).status, 204);
  await wait(async () => (await call("/connections/friends-live", { token: maya.token })).json.streams.length === 0, "offline");

  // A channel nobody here listens to is ignored.
  const stranger = { ...online, event: { ...online.event, broadcaster_user_id: "999999999" } };
  assert.equal((await twitchHook("notification", stranger)).status, 204);
  assert.equal((await pool.query("select 1 from stream_watches where channel_id = '999999999'")).rowCount, 0);

  // Unlinking stops listening.
  assert.equal((await call("/connections/twitch", { method: "DELETE", token: chip.token })).status, 204);
  assert.equal((await pool.query("select 1 from stream_watches where provider = 'twitch' and channel_id = $1", [TWITCH_ID])).rowCount, 0);
  assert.equal(seen.eventsubDeleted.filter((id) => id.endsWith(tag)).length, 2);
});

test("Kick: link with PKCE, RSA-signed live notices", { skip }, async () => {
  const start = await startLink(maya.token, "kick");
  assert.equal(start.searchParams.get("code_challenge_method"), "S256");
  const challenge = start.searchParams.get("code_challenge")!;
  const linked = await confirmLink(await call(`/connections/kick/return?code=kick-code&state=${start.searchParams.get("state")}`));
  assert.equal(linked.status, 200, linked.text);
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(seen.pkce).digest("base64url"), challenge, "the verifier matches the challenge");
  const view = (await call("/connections", { token: maya.token })).json.accounts.find((a: any) => a.provider === "kick");
  assert.equal(view.login, `maya-${tag}`, "the channel's own address from Kick");
  assert.equal(view.profileUrl, `https://kick.com/maya-${tag}`);
  await wait(async () => seen.kickSubs > 0, "Kick subscription");

  const live = { broadcaster: { user_id: Number(KICK_ID), channel_slug: `maya-${tag}` }, is_live: true, title: "Cozy farming", started_at: "2026-11-08T21:00:00Z" };
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.equal((await kickHook(live, { key: wrongKey })).status, 403);
  assert.equal((await kickHook(live, { at: new Date(Date.now() - 30 * 60_000) })).status, 403);
  assert.equal((await kickHook(live)).status, 204);
  await wait(async () => (await call("/connections/friends-live", { token: chip.token })).json.streams.length === 1, "Chip sees Maya live");
  const s = (await call("/connections/friends-live", { token: chip.token })).json.streams[0];
  assert.equal(s.source, "kick");
  assert.equal(s.title, "Cozy farming");
  assert.equal(s.url, `https://kick.com/maya-${tag}`);
  assert.equal((await kickHook({ ...live, is_live: false })).status, 204);
  await wait(async () => (await call("/connections/friends-live", { token: chip.token })).json.streams.length === 0, "Kick offline");
});

test("restricted (family) accounts can't link", { skip }, async () => {
  await pool.query("update users set restricted = true where id = $1", [other.id]);
  assert.equal((await call("/connections/twitch/start", { method: "POST", token: other.token })).status, 403);
  await pool.query("update users set restricted = false where id = $1", [other.id]);
});

// ───────────── Constellation Live alerts ─────────────

let cid = "";
const nebulaMessages = async (token: string, conversationId: string) => (await call(`/conversations/${conversationId}/messages`, { token, headers: { "x-glofly-features": "threads" } })).json.messages as any[];

test("Live alerts: Twitch channel posts a card with a role ping; YouTube videos post once", { skip }, async () => {
  const made = await call("/constellations", { method: "POST", token: chip.token, body: { name: `Alerts ${tag}`, template: "gaming" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  cid = made.json.constellation.id;
  const text = made.json.constellation.nebulas.find((n: any) => n.kind === "text");
  const voice = made.json.constellation.nebulas.find((n: any) => n.kind === "voice");
  assert.ok(voice, "the gaming template has a voice nebula");
  const role = await call(`/constellations/${cid}/roles`, { method: "POST", token: chip.token, body: { name: `Fans${tag}`, color: "violet", permissions: [] } });
  assert.ok(role.status < 300, JSON.stringify(role.json));
  const roleId = role.json.constellation.roles.find((r: any) => r.name === `Fans${tag}`).id as string;
  // Maya joins with the role.
  const link = await call(`/constellations/${cid}/links`, { method: "POST", token: chip.token, body: { lifetime: "7d" } });
  assert.ok(link.status < 300, JSON.stringify(link.json));
  const joined = await call(`/constellations/links/${link.json.link.code}/join`, { method: "POST", token: maya.token });
  assert.ok(joined.status < 300, JSON.stringify(joined.json));
  const gave = await call(`/constellations/${cid}/members/${maya.id}/roles`, { method: "PUT", token: chip.token, body: { roleIds: [roleId] } });
  assert.ok(gave.status < 300, JSON.stringify(gave.json));

  // Members can't set alerts up.
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { token: maya.token })).status, 403);
  const list = await call(`/constellations/${cid}/live-alerts`, { token: chip.token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.alerts, []);

  // Bad input.
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: "evil.com/x y", nebulaId: text.id } })).status, 400);
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: "nobody_here", nebulaId: text.id } })).status, 400);
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: `kroof${tag}`, nebulaId: voice.id } })).status, 400, "posts only in text nebulas");
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: `kroof${tag}`, nebulaId: text.id, watchNebulaId: text.id } })).status, 400, "Watch together needs a voice nebula");
  const foreignRole = randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-4$3-a$4-$5").slice(0, 36);
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: `kroof${tag}`, nebulaId: text.id, ping: foreignRole } })).status, 400);

  const add = await call(`/constellations/${cid}/live-alerts`, {
    method: "POST",
    token: chip.token,
    body: { site: "twitch", channel: `https://twitch.tv/kroof${tag}`, nebulaId: text.id, ping: roleId, message: "{streamer} is live: {title}", watchNebulaId: voice.id },
  });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal(add.json.alert.channelName, `Kroof${tag}`);
  assert.equal(add.json.alert.channelUrl, `https://www.twitch.tv/kroof${tag}`);
  assert.equal((await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "twitch", channel: `kroof${tag}`, nebulaId: text.id } })).status, 409);

  // Kroof goes live.
  twitchLive = true;
  const online = { subscription: { id: "s", type: "stream.online", condition: { broadcaster_user_id: KROOF_ID } }, event: { broadcaster_user_id: KROOF_ID, broadcaster_user_login: `kroof${tag}`, started_at: new Date().toISOString() } };
  assert.equal((await twitchHook("notification", online)).status, 204);
  let alert: any;
  await wait(async () => {
    alert = (await nebulaMessages(maya.token, text.conversationId)).find((m) => m.liveCard);
    return !!alert?.linkPreview;
  }, "the alert");
  assert.equal(alert.liveCard.site, "twitch");
  assert.equal(alert.liveCard.title, "Speedrun night @everyone");
  assert.equal(alert.liveCard.game, "Celeste");
  assert.equal(alert.liveCard.watchNebulaId, voice.id);
  assert.equal(alert.body, `@Fans${tag} Kroof${tag} is live: Speedrun night ＠everyone\nhttps://www.twitch.tv/kroof${tag}`);
  assert.deepEqual(alert.mentionRoles, [roleId], "the role ping counts");
  assert.ok(!alert.mentionEveryone, "a stream title can't ping everyone");
  assert.equal(alert.linkPreview.siteName, "Twitch");
  // A second "online" (Twitch retry, or the stream restarting) doesn't post again.
  await twitchHook("notification", { ...online, event: { ...online.event, started_at: new Date(Date.now() + 1000).toISOString() } });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal((await nebulaMessages(maya.token, text.conversationId)).filter((m) => m.liveCard).length, 1);
  twitchLive = false;

  // YouTube.
  const yt = await call(`/constellations/${cid}/live-alerts`, { method: "POST", token: chip.token, body: { site: "youtube", channel: `https://www.youtube.com/channel/${YT_ID}`, nebulaId: text.id } });
  assert.equal(yt.status, 201, JSON.stringify(yt.json));
  assert.equal(yt.json.alert.channelName, "Night Raiders TV & friends");
  const sub = seen.hub.find((p) => p.get("hub.topic")?.endsWith(YT_ID));
  assert.ok(sub, "subscribed with the hub");
  assert.equal(sub!.get("hub.mode"), "subscribe");
  const secret = sub!.get("hub.secret")!;
  // The hub's confirmation: only for channels Glofly asked for.
  const topic = encodeURIComponent(`https://www.youtube.com/xml/feeds/videos.xml?channel_id=${YT_ID}`);
  const ok = await call(`/hooks/youtube?hub.mode=subscribe&hub.topic=${topic}&hub.challenge=abc123&hub.lease_seconds=432000`);
  assert.equal(ok.text, "abc123");
  const other = encodeURIComponent(`https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC${"x".repeat(22)}`);
  assert.equal((await call(`/hooks/youtube?hub.mode=subscribe&hub.topic=${other}&hub.challenge=abc123`)).status, 404);
  const videoId = randomBytes(8).toString("base64url").slice(0, 11);
  const atom = (published: string) =>
    `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><id>yt:video:${videoId}</id><yt:videoId>${videoId}</yt:videoId><yt:channelId>${YT_ID}</yt:channelId><title>Raid recap &amp; tips</title><author><name>Night Raiders TV</name></author><published>${published}</published></entry></feed>`;
  const sendAtom = (xml: string, key = secret) =>
    fetch(`${URL_}/hooks/youtube`, { method: "POST", headers: { "content-type": "application/atom+xml", "x-hub-signature": "sha1=" + createHmac("sha1", key).update(xml).digest("hex") }, body: xml });
  // Forged: answered 204 but ignored.
  assert.equal((await sendAtom(atom(new Date().toISOString()), "wrong")).status, 204);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await nebulaMessages(chip.token, text.conversationId)).filter((m) => m.liveCard?.site === "youtube").length, 0);
  // An old video edited: ignored.
  await sendAtom(atom(new Date(Date.now() - 5 * 86_400_000).toISOString()));
  const fresh = atom(new Date().toISOString());
  assert.equal((await sendAtom(fresh)).status, 204);
  await wait(async () => (await nebulaMessages(chip.token, text.conversationId)).some((m) => m.liveCard?.site === "youtube"), "the YouTube alert");
  await sendAtom(fresh); // the hub sends title changes too
  await new Promise((r) => setTimeout(r, 400));
  const vids = (await nebulaMessages(chip.token, text.conversationId)).filter((m) => m.liveCard?.site === "youtube");
  assert.equal(vids.length, 1, "each video once");
  assert.equal(vids[0].liveCard.url, `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(vids[0].liveCard.title, "Raid recap & tips");
  assert.equal(vids[0].liveCard.kind, "video");

  // Removing the YouTube alert unsubscribes.
  assert.equal((await call(`/constellations/${cid}/live-alerts/${yt.json.alert.id}`, { method: "DELETE", token: chip.token })).status, 204);
  assert.ok(seen.hub.some((p) => p.get("hub.topic")?.endsWith(YT_ID) && p.get("hub.mode") === "unsubscribe"));
  assert.equal((await pool.query("select 1 from stream_watches where channel_id = $1", [YT_ID])).rowCount, 0);
});

test("Live alerts: members' streams post where the owner allows them", { skip }, async () => {
  const text = (await call(`/constellations/${cid}`, { token: chip.token })).json.constellation.nebulas.find((n: any) => n.kind === "text");
  assert.equal((await call(`/constellations/${cid}/live-alerts/members`, { method: "PUT", token: chip.token, body: { nebulaId: text.id } })).status, 200);
  // Maya links Kick again with "Also post in my constellations" on.
  const start = await startLink(maya.token, "kick");
  if ((await call("/connections", { token: maya.token })).json.accounts.every((a: any) => a.provider !== "kick")) {
    assert.equal((await confirmLink(await call(`/connections/kick/return?code=kick-code&state=${start.searchParams.get("state")}`))).status, 200);
  }
  await call("/connections/kick", { method: "PATCH", token: maya.token, body: { settings: { postInConstellations: true } } });
  const before = (await nebulaMessages(chip.token, text.conversationId)).filter((m) => m.liveCard?.site === "kick").length;
  const live = { broadcaster: { user_id: Number(KICK_ID), channel_slug: `maya-${tag}` }, is_live: true, title: "Members stream", started_at: new Date().toISOString() };
  assert.equal((await kickHook(live)).status, 204);
  await wait(async () => (await nebulaMessages(chip.token, text.conversationId)).filter((m) => m.liveCard?.site === "kick").length === before + 1, "the member's alert");
  await kickHook({ ...live, is_live: false });
});
