import { Router, type Request } from "express";

// Communities round (Nov 2026): the public API docs page, GET /docs/api (no script, strict CSP).
// For server owners and bot makers: constellation API keys, the bot API, webhooks, linked game
// servers, reading messages for bridges, and Sign in with Glofly. Keep it in step with
// integrations/*.ts, oauth/routes.ts and the shared integrations.ts types.

export const docsRouter = Router();

const base = (req: Request) => (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
const web = () => (process.env.WEB_ORIGIN || "https://chat.glofly.app").replace(/\/+$/, "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

docsRouter.get("/docs/api", (req, res) => {
  const api = esc(base(req));
  const chat = esc(web());
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.type("html").send(page(api, chat));
});

function page(api: string, chat: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Glofly API</title>
<style>
:root{--ink:#24170f;--muted:#6b5547;--line:#e8d9cb;--card:#fff;--bg:#fbf5ef;--accent:#f47a1f;--code:#2a1d16}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
header{background:#1c1210;color:#f5ede6;padding:40px 24px 32px}
header .in,main{max-width:860px;margin:0 auto}
header h1{margin:0 0 6px;font-size:32px}
header p{margin:0;color:#d9c7b8}
nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
nav a{color:#ffd2a3;text-decoration:none;border:1px solid #4a3a30;border-radius:999px;padding:4px 12px;font-size:14px}
main{padding:12px 24px 80px}
h2{margin:44px 0 8px;font-size:24px;border-bottom:2px solid var(--line);padding-bottom:6px}
h3{margin:26px 0 6px;font-size:18px}
p,li{color:var(--ink)}
.muted{color:var(--muted)}
code{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#f1e4d7;border-radius:6px;padding:1px 5px}
pre{background:var(--code);color:#f5ede6;border-radius:12px;padding:14px 16px;overflow:auto}
pre code{background:none;padding:0;color:inherit}
table{border-collapse:collapse;width:100%;margin:10px 0;font-size:15px}
th,td{text-align:left;border-bottom:1px solid var(--line);padding:8px 6px;vertical-align:top}
th{color:var(--muted);font-weight:600}
.note{background:#fff;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;padding:12px 16px;margin:14px 0}
a{color:#b4530e}
</style></head>
<body>
<header><div class="in">
<h1>Glofly API</h1>
<p>For game servers, bots, bridges and sites that sign people in with Glofly. Version 1.</p>
<nav>
<a href="#keys">API keys</a><a href="#bot">Bot API</a><a href="#interactions">Commands &amp; buttons</a>
<a href="#reading">Reading messages</a><a href="#links">Linked game servers</a><a href="#webhooks">Webhooks</a>
<a href="#signin">Sign in with Glofly</a><a href="#security">Security</a>
</nav>
</div></header>
<main>

<h2 id="keys">API keys</h2>
<p>A constellation's Owner (or someone who can edit its settings) makes keys in <b>Constellation settings → Integrations</b>. Each key:</p>
<ul>
<li>works for that one constellation only, and only for the permissions picked for it;</li>
<li>is shown once (<code>gfk_</code> + 43 characters). Glofly keeps only a hash, so a lost key can't be shown again: reset it;</li>
<li>gets its own <b>bot member</b> with a role you pick (it can only act on roles and people below that role);</li>
<li>can be limited to exact IP addresses and given an end date. Every use shows in Integrations → Activity.</li>
</ul>
<p>Send it on every request:</p>
<pre><code>Authorization: Bot gfk_…</code></pre>
<p>Base address: <code>${api}/api/v1</code>. Requests and answers are JSON. Errors look like <code>{ "error": "missing_scope", "message": "…" }</code>.</p>
<table>
<tr><th>Permission</th><th>What it allows</th></tr>
<tr><td><code>members:read</code></td><td>Look up members and roles.</td></tr>
<tr><td><code>link</code></td><td>Give players a one-time code to link their Glofly account to your game server.</td></tr>
<tr><td><code>messages:write</code></td><td>Post in the nebulas picked for the key.</td></tr>
<tr><td><code>roles:write</code></td><td>Give and take roles below the bot's own role.</td></tr>
<tr><td><code>commands</code></td><td>Add slash commands members can use.</td></tr>
<tr><td><code>messages:read</code></td><td>Read messages in the nebulas picked for the key (bridges). Members of those nebulas always see a notice.</td></tr>
</table>
<p><b>Rate limits:</b> 120 requests a minute per key, 600 a minute for all of a constellation's keys together. Over the limit you get <code>429</code> with <code>Retry-After</code>.</p>

<h2 id="bot">Bot API</h2>
<h3>GET /api/v1/me</h3>
<p>The bot, its constellation and permissions.</p>
<pre><code>{ "bot": { "id": "…", "name": "Whitelist" },
  "constellation": { "id": "…", "name": "Cozy RP", "frozen": false },
  "scopes": ["members:read", "link"], "postNebulaIds": [] }</code></pre>
<h3>GET /api/v1/roles <span class="muted">members:read</span></h3>
<pre><code>{ "roles": [{ "id": "…", "name": "Police", "color": "blue", "position": 40, "everyone": false, "label": false }] }</code></pre>
<p><code>label: true</code> marks roles members pick themselves (they're labels and never give permissions).</p>
<h3>GET /api/v1/members/:userId <span class="muted">members:read</span></h3>
<pre><code>{ "member": { "id": "…", "username": "riley", "displayName": "Riley", "bot": false,
  "joinedAt": "…", "timedOutUntil": null,
  "roles": [{ "id": "…", "name": "Whitelisted", "position": 10, "label": false }] } }</code></pre>
<p><code>404</code> if they aren't a member.</p>
<h3>POST /api/v1/nebulas/:nebulaId/messages <span class="muted">messages:write</span></h3>
<pre><code>{ "text": "Server restarting in 5 minutes",
  "replyToId": null,
  "buttons": [{ "id": "apply", "label": "Apply", "style": "primary" }] }</code></pre>
<p>Up to 4000 characters and 5 buttons (ids: letters, digits, <code>_</code> and <code>-</code>, up to 64; styles <code>primary</code>, <code>secondary</code>, <code>danger</code>). Messages go through the same checks as a person's: read-only nebulas, AutoMod, a paused constellation. Answers <code>201 { "ok": true, "messageId": "…" }</code>.</p>
<h3>PUT / DELETE /api/v1/members/:userId/roles/:roleId <span class="muted">roles:write</span></h3>
<p>Gives or takes a role. Only roles below the bot's role, and only for people ranked below the bot.</p>

<h2 id="interactions">Slash commands and buttons</h2>
<p>First tell Glofly where to send them (an <code>https</code> address on the public internet):</p>
<pre><code>PUT /api/v1/interactions   { "url": "https://bot.example.com/glofly" }
→ { "secret": "…" }   keep this: every delivery is signed with it</code></pre>
<p>Then register commands (this replaces the bot's list; names are lowercase letters, digits and <code>-</code>):</p>
<pre><code>PUT /api/v1/commands   { "commands": [{ "name": "whitelist", "description": "Ask to be whitelisted" }] }</code></pre>
<p>When a member uses <code>/whitelist apply</code> or clicks one of your buttons, Glofly POSTs:</p>
<pre><code>{ "id": "…", "type": "command",            // or "button"
  "constellationId": "…", "nebulaId": "…", "messageId": "…",
  "user": { "id": "…", "username": "riley", "displayName": "Riley" },
  "roleIds": ["…"],                         // the member's roles, for your own checks
  "command": { "name": "whitelist", "text": "apply" },
  "button": { "id": "apply" },
  "createdAt": "…" }</code></pre>
<p>Answer with any <code>2xx</code> within 5 seconds, then do the work and post a reply through the API.</p>

<h2 id="reading">Reading messages (bridges)</h2>
<p>With <code>messages:read</code> a key can read only the nebulas picked for it. Never DMs or group chats, never lantern messages (they fade on purpose). Everyone in those nebulas sees <i>“Messages here are also shared with &lt;key name&gt;”</i>.</p>
<h3>GET /api/v1/nebulas/:nebulaId/messages?after=&lt;messageId&gt;&amp;limit=50</h3>
<p>Oldest first, up to 100. Without <code>after</code>: the latest <code>limit</code> messages. Replies in threads and forum posts carry their <code>threadId</code>.</p>
<pre><code>{ "messages": [{ "id": "…", "nebulaId": "…",
  "author": { "id": "…", "username": "riley", "displayName": "Riley", "bot": false },
  "text": "gg", "replyToId": null, "threadId": null, "attachments": [{ "kind": "image", "name": "clip.png" }],
  "gif": false, "createdAt": "…", "editedAt": null }] }</code></pre>
<h3>Pushes</h3>
<p>If the key has an interactions address, Glofly also POSTs <code>message.created</code>, <code>message.edited</code> and <code>message.deleted</code> there (signed the same way). The bot's own posts are not sent back to it.</p>
<pre><code>{ "id": "…", "type": "message.created", "constellationId": "…", "nebulaId": "…",
  "messageId": "…", "message": { …as above… },   // null for message.deleted
  "createdAt": "…" }</code></pre>

<h2 id="links">Linked game servers (FiveM, RedM, Minecraft)</h2>
<p>Let players join your game server with their Glofly account. Needs the <code>link</code> permission.</p>
<h3>POST /api/v1/links/lookup</h3>
<pre><code>{ "game": "fivem",                          // "fivem", "redm" or "minecraft"
  "identity": "license:0123…(40 hex)",      // Minecraft: the player's UUID (online-mode servers)
  "playerName": "Riley_Carter",
  "identities": ["discord:123…", "fivem:456"] }   // optional, saved with the link</code></pre>
<p>Not linked yet: show the player the code. It works once, for 10 minutes; asking again gives the same code until it runs out.</p>
<pre><code>{ "linked": false, "code": "482-913", "expiresAt": "…" }</code></pre>
<p>The player opens Glofly → <b>Settings → Linked game servers → Enter a code</b> and confirms. Ask again and you get:</p>
<pre><code>{ "linked": true, "allowed": true,
  "user": { "id": "…", "username": "riley", "displayName": "Riley" },
  "owner": false, "roles": [{ "id": "…", "name": "Whitelisted", "position": 10 }],
  "timedOutUntil": null }</code></pre>
<p>Someone who left, was banned or can't join right now: <code>{ "linked": true, "allowed": false, "reason": "not_member" | "banned" | "account_locked" }</code>, with no name. Players can unlink at any time; then they get a new code.</p>
<div class="note">Your server only ever sees the Glofly name and the roles in your constellation. Never email, friends or messages.</div>

<h2 id="webhooks">Webhooks</h2>
<h3>Incoming: post into a nebula from anywhere</h3>
<pre><code>POST ${api}/hooks/&lt;id&gt;/&lt;token&gt;
{ "text": "Server is back up" }      // Discord-style { "content": "…" } works too</code></pre>
<p>Up to 30 a minute. Treat the address like a password; reset it in Integrations if it leaks.</p>
<h3>Outgoing: Glofly tells your server</h3>
<p>Events: <code>member.joined</code>, <code>member.left</code>, <code>member.roles</code>. Never message contents.</p>
<pre><code>{ "id": "…", "type": "member.roles", "constellationId": "…", "createdAt": "…",
  "data": { "user": { "id": "…", "username": "riley", "displayName": "Riley" }, "roleIds": ["…"] } }</code></pre>
<p>Answer <code>2xx</code> within 5 seconds. Failed deliveries are tried twice more (10 s, 60 s); after 50 failures in a row the webhook switches itself off.</p>

<h3 id="verify">Checking the signature</h3>
<p>Every webhook, interaction and push carries <code>Glofly-Signature: t=&lt;unix time&gt;,v1=&lt;hex&gt;</code>, where <code>v1 = HMAC-SHA256(secret, t + "." + raw body)</code>. Check it, compare in constant time, and refuse anything older than 5 minutes.</p>
<pre><code>import { createHmac, timingSafeEqual } from "node:crypto";

function fromGlofly(header, rawBody, secret) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) &gt; 300) return false;
  const want = createHmac("sha256", secret).update(m[1] + "." + rawBody).digest();
  return timingSafeEqual(want, Buffer.from(m[2], "hex"));
}</code></pre>
<p>Other headers: <code>Glofly-Event</code> (the type) and <code>Glofly-Delivery</code> (a unique id, so you can ignore repeats).</p>

<h2 id="signin">Sign in with Glofly</h2>
<p>Glofly is an OpenID Connect provider. Register your app in Glofly on a computer: <b>Settings → Developer</b>. You get a client id (<code>gfa_…</code>) and, for apps with a server, a secret (<code>gfs_…</code>, shown once).</p>
<table>
<tr><th>Discovery</th><td><code>${api}/.well-known/openid-configuration</code></td></tr>
<tr><th>Authorize</th><td><code>${chat}/oauth/authorize</code></td></tr>
<tr><th>Token</th><td><code>${api}/oauth/token</code></td></tr>
<tr><th>User info</th><td><code>${api}/oauth/userinfo</code></td></tr>
<tr><th>Keys (ES256)</th><td><code>${api}/oauth/jwks</code></td></tr>
<tr><th>Revoke</th><td><code>${api}/oauth/revoke</code></td></tr>
</table>
<ul>
<li>Authorization code flow with <b>PKCE (S256) only</b>. Return addresses must match exactly: <code>https://…</code>, <code>http://localhost…</code> while developing, or your app's own scheme (<code>myapp://…</code>).</li>
<li>Scopes: <code>openid profile</code> (name, username, picture), <code>email</code> (the person can say no), <code>roles</code> (their roles in constellations they pick, as the <code>constellations</code> claim).</li>
<li>Codes last 60 seconds and work once. Access tokens last 1 hour; refresh tokens 60 days and change on every use (using an old one signs the person out of your app).</li>
<li>People see and disconnect your app in <b>Settings → Connected apps</b>. Glofly can switch an app off.</li>
</ul>
<pre><code>${chat}/oauth/authorize?response_type=code&amp;client_id=gfa_…
  &amp;redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&amp;scope=openid%20profile
  &amp;state=…&amp;code_challenge=…&amp;code_challenge_method=S256</code></pre>

<h2 id="security">Security and fair use</h2>
<ul>
<li>Keep keys, secrets and webhook addresses on your server. Never put them in a game client, a plugin's public config, a web page or a screenshot. Reset anything that leaks.</li>
<li>Glofly never asks for a key, a code or a password in a chat, and neither should your bot.</li>
<li>Only ask for the permissions you use. Members can see which bots are in a constellation and which nebulas are shared.</li>
<li>Don't store messages you read for longer than your bridge needs them, and tell your community what the bridge does.</li>
<li>Found a security problem? Email <a href="mailto:support@glofly.app">support@glofly.app</a>.</li>
</ul>
</main></body></html>`;
}
