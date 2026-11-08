// 0.9.3: talking to Steam, Twitch and Kick (only the server does; apps never get these keys).
//
// Steam:  STEAM_API_KEY (steamcommunity.com/dev/apikey). Sign-in is Steam's OpenID 2.0 page.
// Twitch: TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET (falls back to the IGDB app's, same Twitch
//         developer console). Its OAuth Redirect URL must include <PUBLIC_API_URL>/connections/twitch/return.
// Kick:   KICK_CLIENT_ID / KICK_CLIENT_SECRET (kick.com/settings/developer). Redirect URL
//         <PUBLIC_API_URL>/connections/kick/return; webhook URL <PUBLIC_API_URL>/hooks/kick.
// Each *_URL setting is only for testing against a stand-in on this computer.

import { createPublicKey, verify } from "node:crypto";

const env = (k: string) => process.env[k]?.trim() || "";
const base = (k: string, fallback: string) =>
  (env(k) || fallback).replace(/\/+$/, "");

export const STEAM = {
  key: env("STEAM_API_KEY"),
  openid: base("STEAM_OPENID_URL", "https://steamcommunity.com/openid/login"),
  api: base("STEAM_API_URL", "https://api.steampowered.com"),
};
export const TWITCH = {
  id: env("TWITCH_CLIENT_ID") || env("IGDB_CLIENT_ID"),
  secret: env("TWITCH_CLIENT_SECRET") || env("IGDB_CLIENT_SECRET"),
  auth: base("TWITCH_ID_URL", "https://id.twitch.tv"),
  api: base("TWITCH_API_URL", "https://api.twitch.tv/helix"),
};
export const KICK = {
  id: env("KICK_CLIENT_ID"),
  secret: env("KICK_CLIENT_SECRET"),
  auth: base("KICK_ID_URL", "https://id.kick.com"),
  api: base("KICK_API_URL", "https://api.kick.com/public/v1"),
};

export const steamConfigured = () => STEAM.key.length > 0;
export const twitchConfigured = () =>
  TWITCH.id.length > 0 && TWITCH.secret.length > 0;
export const kickConfigured = () =>
  KICK.id.length > 0 && KICK.secret.length > 0;

const TIMEOUT = 8000;
async function getJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "error",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ───────────── Steam ─────────────

/** Steam's sign-in page: comes back to returnTo with Steam's answer. */
export function steamSignInUrl(returnTo: string, realm: string): string {
  const q = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM.openid}?${q}`;
}

/**
 * Checks Steam's answer with Steam itself (OpenID check_authentication) and returns the 64-bit
 * Steam id it vouches for, or null. The answer must be for our own return address.
 */
export async function steamVerify(
  params: URLSearchParams,
  expectedReturnTo: string,
): Promise<string | null> {
  if (params.get("openid.mode") !== "id_res") return null;
  const returnTo = params.get("openid.return_to") ?? "";
  if (returnTo !== expectedReturnTo) return null;
  const claimed = params.get("openid.claimed_id") ?? "";
  const m = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
    claimed,
  );
  if (!m) return null;
  const check = new URLSearchParams(params);
  check.set("openid.mode", "check_authentication");
  try {
    const res = await fetch(STEAM.openid, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: check.toString(),
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "error",
    });
    const text = await res.text();
    return res.ok && /(^|\n)is_valid:true(\n|$)/.test(text) ? m[1] : null;
  } catch {
    return null;
  }
}

export type SteamGame = {
  appId: number;
  name: string;
  minutes: number;
  lastPlayed: number;
};

/** Their owned games and playtime (null: Steam couldn't be reached; [] also when their game details are private). */
export async function steamOwnedGames(
  steamId: string,
): Promise<SteamGame[] | null> {
  const q = new URLSearchParams({
    key: STEAM.key,
    steamid: steamId,
    include_appinfo: "1",
    include_played_free_games: "1",
    format: "json",
  });
  const r = await getJson<{
    response?: {
      games?: {
        appid?: unknown;
        name?: unknown;
        playtime_forever?: unknown;
        rtime_last_played?: unknown;
      }[];
    };
  }>(`${STEAM.api}/IPlayerService/GetOwnedGames/v1/?${q}`);
  if (!r) return null;
  return (r.response?.games ?? [])
    .filter((g) => typeof g.appid === "number" && typeof g.name === "string")
    .map((g) => ({
      appId: g.appid as number,
      name: (g.name as string).slice(0, 120),
      minutes:
        typeof g.playtime_forever === "number"
          ? Math.max(0, Math.floor(g.playtime_forever))
          : 0,
      lastPlayed:
        typeof g.rtime_last_played === "number" ? g.rtime_last_played : 0,
    }))
    .slice(0, 5000);
}

export type SteamPlayer = {
  steamId: string;
  name: string;
  profileUrl: string | null;
  playing: string | null;
  publicGames: boolean;
};

/** Up to 100 Steam players at once: their name, page and what they're playing right now. */
export async function steamPlayers(
  steamIds: string[],
): Promise<SteamPlayer[] | null> {
  if (!steamIds.length) return [];
  const q = new URLSearchParams({
    key: STEAM.key,
    steamids: steamIds.slice(0, 100).join(","),
    format: "json",
  });
  const r = await getJson<{
    response?: {
      players?: {
        steamid?: unknown;
        personaname?: unknown;
        profileurl?: unknown;
        gameextrainfo?: unknown;
        communityvisibilitystate?: unknown;
      }[];
    };
  }>(`${STEAM.api}/ISteamUser/GetPlayerSummaries/v2/?${q}`);
  if (!r) return null;
  return (r.response?.players ?? [])
    .filter((p) => typeof p.steamid === "string")
    .map((p) => ({
      steamId: p.steamid as string,
      name:
        typeof p.personaname === "string"
          ? p.personaname.slice(0, 64)
          : "Steam player",
      profileUrl:
        typeof p.profileurl === "string" &&
        /^https:\/\/steamcommunity\.com\//.test(p.profileurl)
          ? p.profileurl
          : null,
      playing:
        typeof p.gameextrainfo === "string"
          ? p.gameextrainfo.slice(0, 64)
          : null,
      publicGames: p.communityvisibilitystate === 3,
    }));
}

// ───────────── Twitch ─────────────

export function twitchSignInUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: TWITCH.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "",
    state,
    force_verify: "true",
  });
  return `${TWITCH.auth}/oauth2/authorize?${q}`;
}

/** Trades the sign-in code for who they are on Twitch (the user token is used once and dropped). */
export async function twitchWhoIs(
  code: string,
  redirectUri: string,
): Promise<{ id: string; login: string; displayName: string } | null> {
  const t = await getJson<{ access_token?: unknown }>(
    `${TWITCH.auth}/oauth2/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH.id,
        client_secret: TWITCH.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    },
  );
  if (typeof t?.access_token !== "string") return null;
  const me = await getJson<{
    data?: { id?: unknown; login?: unknown; display_name?: unknown }[];
  }>(`${TWITCH.api}/users`, {
    headers: {
      "Client-Id": TWITCH.id,
      Authorization: `Bearer ${t.access_token}`,
    },
  });
  const u = me?.data?.[0];
  // Revoke the user token right away: Glofly only needed to know who they are.
  void fetch(`${TWITCH.auth}/oauth2/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: TWITCH.id,
      token: t.access_token,
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => undefined);
  if (!u || typeof u.id !== "string" || typeof u.login !== "string")
    return null;
  return {
    id: u.id,
    login: u.login,
    displayName:
      typeof u.display_name === "string"
        ? u.display_name.slice(0, 64)
        : u.login,
  };
}

let twitchApp: { token: string; until: number } | null = null;
/** Glofly's own Twitch app token (EventSub, streams). */
export async function twitchAppToken(): Promise<string | null> {
  if (twitchApp && twitchApp.until > Date.now() + 60_000)
    return twitchApp.token;
  const r = await getJson<{ access_token?: unknown; expires_in?: unknown }>(
    `${TWITCH.auth}/oauth2/token?${new URLSearchParams({ client_id: TWITCH.id, client_secret: TWITCH.secret, grant_type: "client_credentials" })}`,
    { method: "POST" },
  );
  if (typeof r?.access_token !== "string") return null;
  twitchApp = {
    token: r.access_token,
    until:
      Date.now() +
      (typeof r.expires_in === "number" ? r.expires_in : 3600) * 1000,
  };
  return twitchApp.token;
}

async function twitchApp_<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await twitchAppToken();
  if (!token) return null;
  return getJson<T>(`${TWITCH.api}${path}`, {
    ...init,
    headers: {
      "Client-Id": TWITCH.id,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** A Twitch channel by name (constellation Live alerts). */
export async function twitchUserByLogin(
  login: string,
): Promise<{ id: string; login: string; displayName: string } | null> {
  const r = await twitchApp_<{
    data?: { id?: unknown; login?: unknown; display_name?: unknown }[];
  }>(`/users?${new URLSearchParams({ login: login.toLowerCase() })}`);
  const u = r?.data?.[0];
  return u && typeof u.id === "string" && typeof u.login === "string"
    ? {
        id: u.id,
        login: u.login,
        displayName:
          typeof u.display_name === "string" ? u.display_name : u.login,
      }
    : null;
}

/** What a Twitch channel is streaming right now (null: not live or not reachable). */
export async function twitchStream(
  userId: string,
): Promise<{
  title: string;
  game: string | null;
  startedAt: string;
  viewers: number | null;
  thumbnail: string | null;
} | null> {
  const r = await twitchApp_<{
    data?: {
      title?: unknown;
      game_name?: unknown;
      started_at?: unknown;
      viewer_count?: unknown;
      thumbnail_url?: unknown;
    }[];
  }>(`/streams?${new URLSearchParams({ user_id: userId })}`);
  const s = r?.data?.[0];
  if (!s) return null;
  return {
    title: typeof s.title === "string" ? s.title.slice(0, 140) : "",
    game:
      typeof s.game_name === "string" && s.game_name
        ? s.game_name.slice(0, 80)
        : null,
    startedAt:
      typeof s.started_at === "string"
        ? s.started_at
        : new Date().toISOString(),
    viewers: typeof s.viewer_count === "number" ? s.viewer_count : null,
    thumbnail:
      typeof s.thumbnail_url === "string" &&
      /^https:\/\/static-cdn\.jtvnw\.net\//.test(s.thumbnail_url)
        ? s.thumbnail_url.replace("{width}", "640").replace("{height}", "360")
        : null,
  };
}

const TWITCH_TYPES = ["stream.online", "stream.offline"] as const;

/**
 * Makes sure a channel has its stream.online and stream.offline subscriptions. `have` holds the
 * ones Glofly knows about ("stream.online:<id>"); only the missing ones are made, and one Twitch
 * already has (it answers 409) is looked up instead. Returns what exists now (may be partial).
 */
export async function twitchSubscribe(
  userId: string,
  callback: string,
  secret: string,
  have: string[] = [],
): Promise<string[]> {
  const out = have.filter((x) =>
    TWITCH_TYPES.some((t) => x.startsWith(`${t}:`)),
  );
  for (const type of TWITCH_TYPES) {
    if (out.some((x) => x.startsWith(`${type}:`))) continue;
    const r = await twitchApp_<{ data?: { id?: unknown }[] }>(
      "/eventsub/subscriptions",
      {
        method: "POST",
        body: JSON.stringify({
          type,
          version: "1",
          condition: { broadcaster_user_id: userId },
          transport: { method: "webhook", callback, secret },
        }),
      },
    );
    let id = r?.data?.[0]?.id;
    if (typeof id !== "string") {
      const list = await twitchApp_<{
        data?: {
          id?: unknown;
          type?: unknown;
          status?: unknown;
          transport?: { callback?: unknown };
        }[];
      }>(`/eventsub/subscriptions?${new URLSearchParams({ user_id: userId })}`);
      id = list?.data?.find(
        (x) =>
          x.type === type &&
          x.transport?.callback === callback &&
          (x.status === "enabled" ||
            x.status === "webhook_callback_verification_pending"),
      )?.id;
    }
    if (typeof id === "string") out.push(`${type}:${id}`);
  }
  return out;
}

/** `entry` is "stream.online:<id>" (or a bare id from before). */
export async function twitchUnsubscribe(entry: string): Promise<void> {
  const token = await twitchAppToken();
  if (!token) return;
  const id = entry.includes(":") ? entry.slice(entry.indexOf(":") + 1) : entry;
  await fetch(
    `${TWITCH.api}/eventsub/subscriptions?${new URLSearchParams({ id })}`,
    {
      method: "DELETE",
      headers: { "Client-Id": TWITCH.id, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT),
    },
  ).catch(() => undefined);
}

// ───────────── Kick ─────────────

export function kickSignInUrl(
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const q = new URLSearchParams({
    client_id: KICK.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "user:read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${KICK.auth}/oauth/authorize?${q}`;
}

export async function kickWhoIs(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<{ id: string; login: string; displayName: string } | null> {
  const t = await getJson<{ access_token?: unknown }>(
    `${KICK.auth}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KICK.id,
        client_secret: KICK.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    },
  );
  if (typeof t?.access_token !== "string") return null;
  const me = await getJson<{ data?: { user_id?: unknown; name?: unknown }[] }>(
    `${KICK.api}/users`,
    { headers: { Authorization: `Bearer ${t.access_token}` } },
  );
  const u = me?.data?.[0];
  void fetch(
    `${KICK.auth}/oauth/revoke?${new URLSearchParams({ token: t.access_token, token_hint_type: "access_token" })}`,
    { method: "POST", signal: AbortSignal.timeout(TIMEOUT) },
  ).catch(() => undefined);
  if (
    !u ||
    (typeof u.user_id !== "number" && typeof u.user_id !== "string") ||
    typeof u.name !== "string"
  )
    return null;
  const id = String(u.user_id);
  // Their channel's address (kick.com/<slug>) from Kick itself; the name in lower case otherwise.
  const ch = await kickApp_<{ data?: { slug?: unknown }[] }>(
    `/channels?${new URLSearchParams({ broadcaster_user_id: id })}`,
  );
  const slug =
    typeof ch?.data?.[0]?.slug === "string"
      ? (ch.data[0].slug as string)
      : u.name.toLowerCase().replace(/_/g, "-");
  return { id, login: slug.toLowerCase(), displayName: u.name.slice(0, 64) };
}

let kickApp: { token: string; until: number } | null = null;
export async function kickAppToken(): Promise<string | null> {
  if (kickApp && kickApp.until > Date.now() + 60_000) return kickApp.token;
  const r = await getJson<{ access_token?: unknown; expires_in?: unknown }>(
    `${KICK.auth}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: KICK.id,
        client_secret: KICK.secret,
        grant_type: "client_credentials",
      }).toString(),
    },
  );
  if (typeof r?.access_token !== "string") return null;
  kickApp = {
    token: r.access_token,
    until:
      Date.now() +
      (typeof r.expires_in === "number" ? r.expires_in : 3600) * 1000,
  };
  return kickApp.token;
}

async function kickApp_<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await kickAppToken();
  if (!token) return null;
  return getJson<T>(`${KICK.api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** A Kick channel by its address name (constellation Live alerts). */
export async function kickChannelBySlug(
  slug: string,
): Promise<{ id: string; login: string; displayName: string } | null> {
  const r = await kickApp_<{
    data?: { broadcaster_user_id?: unknown; slug?: unknown }[];
  }>(`/channels?${new URLSearchParams({ slug: slug.toLowerCase() })}`);
  const c = r?.data?.[0];
  return c &&
    (typeof c.broadcaster_user_id === "number" ||
      typeof c.broadcaster_user_id === "string") &&
    typeof c.slug === "string"
    ? { id: String(c.broadcaster_user_id), login: c.slug, displayName: c.slug }
    : null;
}

export async function kickStream(
  broadcasterId: string,
): Promise<{
  title: string;
  game: string | null;
  startedAt: string;
  viewers: number | null;
  thumbnail: string | null;
} | null> {
  const r = await kickApp_<{
    data?: {
      stream_title?: unknown;
      category?: { name?: unknown };
      started_at?: unknown;
      viewer_count?: unknown;
      thumbnail?: unknown;
    }[];
  }>(
    `/livestreams?${new URLSearchParams({ broadcaster_user_id: broadcasterId })}`,
  );
  const s = r?.data?.[0];
  if (!s) return null;
  return {
    title:
      typeof s.stream_title === "string" ? s.stream_title.slice(0, 140) : "",
    game:
      typeof s.category?.name === "string"
        ? s.category.name.slice(0, 80)
        : null,
    startedAt:
      typeof s.started_at === "string"
        ? s.started_at
        : new Date().toISOString(),
    viewers: typeof s.viewer_count === "number" ? s.viewer_count : null,
    thumbnail:
      typeof s.thumbnail === "string" &&
      /^https:\/\/([a-z0-9-]+\.)*kick\.com\//.test(s.thumbnail)
        ? s.thumbnail
        : null,
  };
}

export async function kickSubscribe(
  broadcasterId: string,
): Promise<string[] | null> {
  const r = await kickApp_<{
    data?: { subscription_id?: unknown; error?: unknown }[];
  }>("/events/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      broadcaster_user_id: Number(broadcasterId),
      events: [{ name: "livestream.status.updated", version: 1 }],
      method: "webhook",
    }),
  });
  const id = r?.data?.[0]?.subscription_id;
  return typeof id === "string" ? [id] : null;
}

export async function kickUnsubscribe(subscriptionId: string): Promise<void> {
  const token = await kickAppToken();
  if (!token) return;
  await fetch(
    `${KICK.api}/events/subscriptions?${new URLSearchParams({ id: subscriptionId })}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT),
    },
  ).catch(() => undefined);
}

let kickKey: { pem: string; at: number } | null = null;
/** Kick signs its webhooks; its public key, kept for a day (fetched again sooner if Kick changes it). */
async function kickPublicKey(refresh = false): Promise<string | null> {
  if (kickKey && !refresh && Date.now() - kickKey.at < 86_400_000)
    return kickKey.pem;
  const r = await getJson<{ data?: { public_key?: unknown } }>(
    `${KICK.api}/public-key`,
  );
  const pem = r?.data?.public_key;
  if (typeof pem !== "string") return kickKey?.pem ?? null;
  kickKey = { pem, at: Date.now() };
  return pem;
}

function kickVerify(pem: string, data: Buffer, signatureB64: string): boolean {
  try {
    return verify(
      "RSA-SHA256",
      data,
      createPublicKey(pem),
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

/** Is this webhook really from Kick? (RSA-SHA256 over "<id>.<timestamp>.<body>".) */
export async function kickSignatureOk(
  messageId: string,
  timestamp: string,
  body: Buffer,
  signatureB64: string,
): Promise<boolean> {
  if (!messageId || !timestamp || !signatureB64) return false;
  const pem = await kickPublicKey();
  if (!pem) return false;
  const data = Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), body]);
  if (kickVerify(pem, data, signatureB64)) return true;
  // Kick may have a new key: ask again (at most once a minute, see kickPublicKey).
  const fresh = await kickPublicKey(true);
  return !!fresh && fresh !== pem && kickVerify(fresh, data, signatureB64);
}
