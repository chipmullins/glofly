import type { Request, Response } from "express";
import { cleanCfxName, type CfxServerCard } from "@glofly/shared";
import { redis } from "../redis";

// Communities round (FiveM/RedM quick wins): the card under a cfx.re/join/<code> link.
//
// Looking a server up (name, players, FiveM or RedM) reads Cfx.re's public server list
// (servers-frontend.fivem.net). That isn't a documented API, so it's OFF until Glofly may use it:
// set CFX_SERVER_LOOKUP=on on the server. Off, the card only opens the link (no request leaves
// Glofly). Only the Glofly server ever asks Cfx.re (never the apps), always the same fixed address,
// with a short timeout, a size cap, no redirects, and a 2-minute cache per code.

const LOOKUP_URL = (code: string) => `https://servers-frontend.fivem.net/api/servers/single/${encodeURIComponent(code)}`;
const CACHE_SECONDS = 120;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 4000;

export const cfxLookupOn = () => (process.env.CFX_SERVER_LOOKUP ?? "").toLowerCase() === "on";

/** Reads the answer, stopping at MAX_BYTES. */
async function readCapped(r: globalThis.Response): Promise<string | null> {
  if (!r.body) return null;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The card's facts from Cfx.re's answer (null when it doesn't look right). */
export function cardFrom(code: string, raw: unknown): CfxServerCard {
  const data = ((raw as { Data?: unknown })?.Data ?? null) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return { code, lookup: true, found: false };
  const vars = (data.vars && typeof data.vars === "object" ? data.vars : {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : Number.NaN;
    return Number.isFinite(n) && n >= 0 && n < 100_000 ? Math.floor(n) : undefined;
  };
  const project = typeof vars.sv_projectName === "string" ? cleanCfxName(vars.sv_projectName) : "";
  const host = typeof data.hostname === "string" ? cleanCfxName(data.hostname) : "";
  const gameName = String(vars.gamename ?? data.gamename ?? "").toLowerCase();
  return {
    code,
    lookup: true,
    found: true,
    name: project || host || undefined,
    players: num(data.clients),
    maxPlayers: num(data.sv_maxclients ?? data.svMaxclients ?? vars.sv_maxClients),
    game: gameName === "rdr3" ? "redm" : "fivem",
  };
}

// GET /games/cfx/:code — the card for cfx.re/join/<code>.
export async function cfxCard(req: Request, res: Response): Promise<void> {
  const code = String(req.params.code ?? "").toLowerCase();
  if (!/^[a-z0-9]{4,12}$/.test(code)) {
    res.status(400).json({ error: "invalid", message: "That isn't a cfx.re join link." });
    return;
  }
  if (!cfxLookupOn()) {
    res.json({ code, lookup: false } satisfies CfxServerCard);
    return;
  }
  const key = `cfx:${code}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  let card: CfxServerCard = { code, lookup: true, found: false };
  try {
    const r = await fetch(LOOKUP_URL(code), {
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "Glofly (+https://glofly.app)" },
    });
    if (r.ok) {
      const text = await readCapped(r);
      if (text) card = cardFrom(code, JSON.parse(text));
    }
  } catch {
    // Cfx.re down, slow or odd: the card says it couldn't find the server.
  }
  await redis.set(key, JSON.stringify(card), { EX: CACHE_SECONDS }).catch(() => undefined);
  res.json(card);
}
