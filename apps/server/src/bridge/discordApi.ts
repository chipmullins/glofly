// Communities round 2: talking to Discord for the bridge (REST API v10 and OAuth2). Glofly's own
// Discord application ("Glofly Bridge"), set in .env:
//
//   DISCORD_CLIENT_ID=…        Developer Portal → your application → OAuth2 → Client ID
//   DISCORD_CLIENT_SECRET=…    same page → Client Secret (Reset Secret to see it)
//   DISCORD_BOT_TOKEN=…        Bot → Reset Token (shown once)
//
// Without all three the bridge is off (Settings → Discord bridge says so). DISCORD_API_URL and
// DISCORD_GATEWAY_URL are only for testing with a stand-in (test/discord.e2e.ts).

const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() ?? "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET?.trim() ?? "";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
export const DISCORD_API = (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/+$/, "");
export const DISCORD_GATEWAY = process.env.DISCORD_GATEWAY_URL?.trim() || "wss://gateway.discord.gg/?v=10&encoding=json";
export const DISCORD_AUTHORIZE = process.env.DISCORD_AUTHORIZE_URL?.trim() || "https://discord.com/oauth2/authorize";
export const discordConfigured = /^\d{5,25}$/.test(CLIENT_ID) && CLIENT_SECRET.length > 10 && BOT_TOKEN.length > 20;
export const BOT_TOKEN_VALUE = BOT_TOKEN;
export const DISCORD_CLIENT_ID = CLIENT_ID;

/**
 * What the bot may do in a Discord server: see channels, read their history, send messages, embed
 * links, attach files, add reactions, and make webhooks (to post as Glofly people).
 */
export const BOT_PERMISSIONS = (
  (1n << 10n) | // View Channels
  (1n << 11n) | // Send Messages
  (1n << 16n) | // Read Message History
  (1n << 14n) | // Embed Links
  (1n << 15n) | // Attach Files
  (1n << 6n) | // Add Reactions
  (1n << 29n) // Manage Webhooks
).toString();

/** Gateway intents: servers, server messages, message content (a privileged intent: turn it on in the Developer Portal). */
export const INTENTS = (1 << 0) | (1 << 9) | (1 << 15);

export class DiscordError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One Discord REST call as the bot (one retry after a rate limit). */
export async function discord<T>(method: string, path: string, body?: unknown, auth: "bot" | "none" = "bot"): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(DISCORD_API + path, {
      method,
      headers: {
        ...(auth === "bot" ? { Authorization: `Bot ${BOT_TOKEN}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "DiscordBot (https://glofly.app, 1.0) Glofly-Bridge",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(10, Math.max(0.2, wait)) * 1000));
      continue;
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    if (!res.ok) throw new DiscordError(res.status, `Discord answered ${res.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** The "Add to Discord" address for a constellation (state ties the answer to it). */
export function inviteUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: "bot",
    permissions: BOT_PERMISSIONS,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    integration_type: "0",
  });
  return `${DISCORD_AUTHORIZE}?${p.toString()}`;
}

/**
 * Confirms an "Add to Discord" with Discord itself: the code is swapped for the server the person
 * added the bot to (never trusted from the address, which anyone could edit). Nothing else about
 * their account is kept; the token Discord gives back is thrown away.
 */
export async function guildFromCode(code: string, redirectUri: string): Promise<{ id: string; name: string; icon: string | null } | null> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { guild?: { id?: unknown; name?: unknown; icon?: unknown }; access_token?: string } | null;
  const g = j?.guild;
  if (!g || typeof g.id !== "string" || !/^\d{5,25}$/.test(g.id) || typeof g.name !== "string") return null;
  // We only needed to know the server: let the person's token go right away.
  if (j?.access_token)
    void fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: j.access_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    }).catch(() => undefined);
  return { id: g.id, name: g.name.slice(0, 100), icon: typeof g.icon === "string" ? g.icon : null };
}

export type DiscordChannel = { id: string; name: string; type: number; parent_id?: string | null; position?: number };
export type DiscordUser = { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
export type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  member?: { nick?: string | null };
  content: string;
  webhook_id?: string;
  mentions?: (DiscordUser & { member?: { nick?: string | null } })[];
  mention_roles?: string[];
  attachments?: { id: string; filename: string; size: number; url: string; content_type?: string }[];
  message_reference?: { message_id?: string };
  type?: number;
};

export const guildChannels = (guildId: string) => discord<DiscordChannel[]>("GET", `/guilds/${guildId}/channels`);

/** Only valid webhook usernames: 1–80 characters, no "discord"/"clyde" (Discord refuses those). */
export function webhookName(name: string): string {
  const clean = name.replace(/discord/gi, "d1scord").replace(/clyde/gi, "c1yde").replace(/[@#:`]/g, "").trim();
  return (clean || "Glofly member").slice(0, 70) + " · Glofly";
}
