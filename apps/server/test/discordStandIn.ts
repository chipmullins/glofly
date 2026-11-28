// Communities round 2: a stand-in for Discord (REST, OAuth2, the CDN and the Gateway) so the
// bridge can be tested in a sandbox that can't reach Discord. Run it first, then the dev server
// pointed at it, then test/discord.e2e.ts:
//
//   npx tsx test/discordStandIn.ts                       (port 4790)
//   DISCORD_API_URL=http://localhost:4790/api/v10 DISCORD_GATEWAY_URL=ws://localhost:4790/gateway \
//   DISCORD_CDN_URL=http://localhost:4790/cdn DISCORD_AUTHORIZE_URL=http://localhost:4790/oauth2/authorize \
//   DISCORD_CLIENT_ID=123456789012345678 DISCORD_CLIENT_SECRET=stand-in-secret DISCORD_BOT_TOKEN=stand-in-bot-token-0123456789 \
//   npx tsx --env-file=../../.env src/index.ts
//
// Test hooks: POST /_test/dispatch { t, d } sends a Gateway event; POST /_test/channel { channel }
// adds a channel to the server and sends CHANNEL_CREATE (0.12.0 auto-bridge); GET /_test/log lists what the
// bridge did in "Discord" (webhook posts, edits, deletes); GET /_test/state.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore ws has no types installed here
import { WebSocketServer } from "ws";

const PORT = Number(process.env.STAND_IN_PORT ?? 4790);
export const GUILD = "111111111111111111";
export const OTHER_GUILD = "999999999999999999";
export const CHANNELS: { id: string; name: string; type: number; position: number; guild_id: string; parent_id?: string; permission_overwrites?: unknown[] }[] = [
  { id: "222222222222222222", name: "general", type: 0, position: 0, guild_id: GUILD },
  { id: "333333333333333333", name: "lfg", type: 0, position: 1, guild_id: GUILD },
  // Nov 28: a category, a text channel in it, and a voice channel (who's in voice).
  { id: "660000000000000000", name: "Hangout", type: 4, position: 2, guild_id: GUILD },
  { id: "661000000000000000", name: "🎮│memes", type: 0, position: 0, guild_id: GUILD, parent_id: "660000000000000000" },
  { id: "770000000000000000", name: "Lounge", type: 2, position: 1, guild_id: GUILD, parent_id: "660000000000000000" },
  { id: "444444444444444444", name: "elsewhere", type: 0, position: 0, guild_id: OTHER_GUILD },
];
const log: { method: string; path: string; body: unknown }[] = [];
const sockets = new Set<{ send: (s: string) => void }>();
let identified = 0;
const snow = () => String(BigInt("100000000000000000") + BigInt(Math.floor(Math.random() * 1e15)));
let png: Buffer;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = (() => {
    if (!raw) return null;
    // Nov 28: webhook posts with files (multipart): keep the JSON part and the file names.
    if ((req.headers["content-type"] ?? "").includes("multipart/form-data")) {
      const json = raw.match(/name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
      return { ...(json ? JSON.parse(json) : {}), _files: [...raw.matchAll(/filename="([^"]+)"/g)].map((x) => x[1]) };
    }
    if ((req.headers["content-type"] ?? "").includes("form")) return Object.fromEntries(new URLSearchParams(raw));
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  })();
  const json = (status: number, v: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(v));
  };
  const p = url.pathname;
  const m = req.method ?? "GET";
  if (p === "/_test/dispatch" && m === "POST") {
    const { t, d } = body as { t: string; d: unknown };
    for (const s of sockets) s.send(JSON.stringify({ op: 0, t, d, s: Date.now() % 100000 }));
    return json(200, { sent: sockets.size });
  }
  if (p === "/_test/channel" && m === "POST") {
    const { channel } = body as { channel: (typeof CHANNELS)[number] };
    CHANNELS.push(channel);
    for (const s of sockets) s.send(JSON.stringify({ op: 0, t: "CHANNEL_CREATE", d: channel, s: Date.now() % 100000 }));
    return json(200, { sent: sockets.size });
  }
  if (p === "/_test/log") return json(200, log);
  if (p === "/_test/state") return json(200, { identified, connected: sockets.size });
  if (p === "/_test/clear" && m === "POST") {
    log.length = 0;
    return json(200, {});
  }
  if (p.startsWith("/cdn/")) {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png);
  }
  if (!p.startsWith("/api/v10/")) return json(404, { message: "Unknown" });
  const path = p.slice("/api/v10".length);
  log.push({ method: m, path: path + url.search, body });
  if (path === "/oauth2/token" && m === "POST") {
    const f = body as Record<string, string>;
    if (f.code !== "good-code" || f.client_secret !== "stand-in-secret") return json(400, { error: "invalid_grant" });
    return json(200, { access_token: "person-token", token_type: "Bearer", guild: { id: GUILD, name: "Cozy RP", icon: null } });
  }
  if (path === "/oauth2/token/revoke") return json(200, {});
  const bot = req.headers.authorization === "Bot stand-in-bot-token-0123456789";
  let r: RegExpMatchArray | null;
  if ((r = path.match(/^\/guilds\/(\d+)\/channels$/)) && bot) return json(200, CHANNELS.filter((c) => c.guild_id === r![1]));
  if ((r = path.match(/^\/channels\/(\d+)$/)) && bot) {
    const c = CHANNELS.find((x) => x.id === r![1]);
    return c ? json(200, c) : json(404, { message: "Unknown Channel" });
  }
  if ((r = path.match(/^\/channels\/(\d+)\/webhooks$/)) && m === "POST" && bot) return json(200, { id: `7${r[1].slice(1)}`, token: "hook-token-" + r[1] });
  if (path.match(/^\/webhooks\/\d+$/) && m === "DELETE" && bot) return json(204, null);
  // Nov 28: the bot's own messages (the voice channel status) and server members.
  if ((r = path.match(/^\/channels\/(\d+)\/messages$/)) && m === "POST" && bot) return json(200, { id: snow(), channel_id: r[1] });
  if (path.match(/^\/channels\/\d+\/messages\/\d+$/) && bot) return m === "DELETE" ? json(204, null) : json(200, { id: path.split("/").pop() });
  if ((r = path.match(/^\/guilds\/\d+\/members\/(\d+)$/)) && bot)
    return json(200, { nick: null, user: { id: r[1], username: `member${r[1].slice(-2)}`, global_name: `Member ${r[1].slice(-2)}`, avatar: null } });
  if (path.match(/^\/users\/@me\/guilds\/\d+$/) && m === "DELETE" && bot) return json(204, null);
  if (path.match(/^\/webhooks\/\d+\/hook-token-\d+$/) && m === "POST") return json(200, { id: snow() });
  if (path.match(/^\/webhooks\/\d+\/hook-token-\d+\/messages\/\d+$/)) return m === "DELETE" ? json(204, null) : json(200, { id: path.split("/").pop() });
  return json(bot ? 404 : 401, { message: "Unknown" });
});

void (async () => {
  png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#5865f2" } }).png().toBuffer();
  const wss = new WebSocketServer({ server, path: "/gateway" });
  wss.on("connection", (ws: { send: (s: string) => void; on: (e: string, f: (x: unknown) => void) => void }) => {
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30_000 } }));
    ws.on("message", (raw: unknown) => {
      const msg = JSON.parse(String(raw)) as { op: number; d: { token?: string; intents?: number } };
      if (msg.op === 1) ws.send(JSON.stringify({ op: 11 }));
      if (msg.op === 2 && msg.d.token === "stand-in-bot-token-0123456789") {
        identified++;
        sockets.add(ws);
        ws.send(JSON.stringify({ op: 0, t: "READY", s: 1, d: { session_id: randomBytes(8).toString("hex"), user: { id: "555555555555555555" } } }));
      }
    });
    ws.on("close", () => sockets.delete(ws));
  });
  server.listen(PORT, () => console.log(`Discord stand-in on http://localhost:${PORT}`));
})();
