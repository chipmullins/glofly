// 0.9.1 game pictures (IGDB) against a real server, with a stand-in for Twitch and IGDB on this
// computer (the real ones need Glofly's Twitch app and the internet). Start the server with:
//   IGDB_CLIENT_ID=test-client IGDB_CLIENT_SECRET=test-secret \
//   IGDB_TOKEN_URL=http://127.0.0.1:4791/token IGDB_API_URL=http://127.0.0.1:4791/v4 \
//   IGDB_IMAGE_URL=http://127.0.0.1:4791/img npx tsx src/index.ts
// then run with GLOFLY_E2E_URL=http://localhost:4000 GLOFLY_E2E_IGDB=1.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { clearSignupLimit } from "./e2eLimits";

const URL_ = process.env.GLOFLY_E2E_URL;
const skip = !URL_ || !process.env.GLOFLY_E2E_IGDB ? "set GLOFLY_E2E_URL and GLOFLY_E2E_IGDB (server pointed at the stand-in)" : false;
const H = { "content-type": "application/json", "x-glofly-version": "0.9.1" };
const tag = randomBytes(3).toString("hex");

// ---- the stand-in ----
const CATALOG = [
  { id: 1, name: "Stardew Valley", cover: { image_id: `co${tag}a` }, first_release_date: 1456444800 },
  { id: 2, name: "Starfield", cover: { image_id: `co${tag}b` }, first_release_date: 1693526400 },
  { id: 3, name: `Hades ${tag}`, cover: { image_id: `co${tag}c` }, first_release_date: 1600300800 },
];
const seen = { token: 0, queries: [] as string[], images: 0, badAuth: 0 };
let standIn: Server;

before(async () => {
  if (skip) return;
  const jpeg = await sharp({ create: { width: 528, height: 704, channels: 3, background: { r: 30, g: 90, b: 160 } } }).jpeg().toBuffer();
  standIn = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.startsWith("/token")) {
        seen.token++;
        const q = new URL(req.url, "http://x").searchParams;
        if (q.get("client_id") !== "test-client" || q.get("client_secret") !== "test-secret") {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: "tok", expires_in: 5000 }));
        return;
      }
      if (req.url === "/v4/games") {
        if (req.headers["client-id"] !== "test-client" || req.headers.authorization !== "Bearer tok") {
          seen.badAuth++;
          res.writeHead(401).end();
          return;
        }
        seen.queries.push(body);
        const m = /search "([^"]*)"/.exec(body);
        const term = (m?.[1] ?? "").toLowerCase();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(CATALOG.filter((g) => g.name.toLowerCase().includes(term))));
        return;
      }
      if (req.url?.startsWith("/img/t_cover_big/")) {
        seen.images++;
        res.writeHead(200, { "content-type": "image/jpeg" }).end(jpeg);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => standIn.listen(4791, "127.0.0.1", r));
  await clearSignupLimit();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const username = `igdb${tag}`;
  const r = await call("/auth/register", {
    method: "POST",
    body: { email: `${username}@example.com`, username, displayName: "Igdb", password: "glofly-e2e-" + tag, birthday: "1995-05-14", acceptTerms: true },
  });
  user = { id: r.json.user.id, token: r.json.token };
});

after(async () => {
  if (skip) return;
  await pool.query("delete from users where id = $1", [user.id]);
  await pool.query("delete from game_art where game_key like $1 or game_key in ('stardew valley', 'starfield')", [`%${tag}%`]);
  await pool.end();
  standIn.close();
});

let pool: pg.Pool;
let user: { id: string; token: string };
async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { ...H };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(URL_ + path, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json, headers: r.headers, raw: text };
}

test("Find a game: results with year and cover; nothing about the person goes to IGDB", { skip }, async () => {
  assert.equal((await call("/games/search?q=star")).status, 401, "signed in only");
  const r = await call("/games/search?q=star", { token: user.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.available, true);
  const sv = r.json.games.find((g: any) => g.name === "Stardew Valley");
  assert.deepEqual(sv, { key: "stardew valley", name: "Stardew Valley", year: 2016, cover: `co${tag}a` });
  assert.equal("igdbId" in sv, false);
  const last = seen.queries.at(-1)!;
  assert.match(last, /^search "star";/);
  assert.equal(last.includes(user.id) || last.includes("igdb"), false);
});

test("a search can't break out of IGDB's query", { skip }, async () => {
  await call(`/games/search?q=${encodeURIComponent('x"; fields *; where id > 0; "')}`, { token: user.token });
  const last = seen.queries.at(-1)!;
  assert.equal(last.split('"').length - 1, 2, `only the two quotes around the search: ${last}`);
  assert.equal(/;.*fields \*/.test(last.split('"')[1]), false);
});

test("cover pictures: fetched once, re-saved as WebP, odd ids refused", { skip }, async () => {
  const before = seen.images;
  const a = await fetch(`${URL_}/games/cover/co${tag}a`, { headers: { ...H, authorization: `Bearer ${user.token}` } });
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("content-type"), "image/webp");
  const meta = await sharp(Buffer.from(await a.arrayBuffer())).metadata();
  assert.deepEqual([meta.width, meta.height], [264, 352]);
  const b = await fetch(`${URL_}/games/cover/co${tag}a`, { headers: { ...H, authorization: `Bearer ${user.token}` } });
  assert.equal(b.status, 200);
  await b.arrayBuffer();
  assert.equal(seen.images - before, 1, "the second time comes from Glofly's own copy");
  for (const bad of ["..%2Fsecret", "CO1ABC", "a", "x".repeat(60)]) {
    const r = await fetch(`${URL_}/games/cover/${bad}`, { headers: { ...H, authorization: `Bearer ${user.token}` } });
    assert.equal(r.status, 404, bad);
  }
});

test("My games and the board pick up box art (looked up in the background)", { skip }, async () => {
  await pool.query(
    "insert into user_games (user_id, game_key, name, seconds) values ($1, $2, $3, 7200)",
    [user.id, `hades ${tag}`, `Hades ${tag}`],
  );
  const first = await call("/games/me", { token: user.token });
  assert.equal(first.json.games[0].cover, undefined, "not known yet");
  await new Promise((r) => setTimeout(r, 1500));
  const again = await call("/games/me", { token: user.token });
  assert.equal(again.json.games[0].cover, `co${tag}c`);

  const saved = await call("/users/me/profile", {
    method: "PATCH",
    token: user.token,
    body: { board: [{ kind: "games", games: [{ name: `Hades ${tag}`, cover: "spoofed" }, { name: "Stardew Valley" }, { name: `Nothing ${tag}` }] }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const games = saved.json.boardSource[0].games;
  assert.equal(games[0].cover, `co${tag}c`, "covers come from the server, never what an app sent");
  assert.equal(games[1].cover, `co${tag}a`, "remembered from the search");
  assert.equal(games[2].cover, undefined);
  const raw = await pool.query("select profile_board from users where id = $1", [user.id]);
  assert.equal(JSON.stringify(raw.rows[0].profile_board).includes("cover"), false, "covers aren't stored on the board");
  await new Promise((r) => setTimeout(r, 1000));
  const miss = await pool.query("select igdb_id, cover_id from game_art where game_key = $1", [`nothing ${tag}`]);
  assert.deepEqual(miss.rows[0], { igdb_id: null, cover_id: null }, "no match is remembered too (tried again after 30 days)");
  assert.equal(seen.badAuth, 0);
});
