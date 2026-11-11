import { redis } from "../redis";
import { nebulaOfChat } from "./chats";

// Communities round 2 (big constellations): rate limits per nebula and per constellation, on top of
// each person's own (messages:send). A raid of many accounts, or one runaway bot integration, can't
// flood a nebula or the whole constellation. Refusals are counted per constellation per day for
// Glofly Control → Insights → Big constellations.

export const NEBULA_SEND_LIMIT = { per: 10, max: 150 }; // seconds, messages
export const CONSTELLATION_SEND_LIMIT = { per: 10, max: 600 };
const day = () => new Date().toISOString().slice(0, 10);
export const busyCountKey = (constellationId: string, d = day()) => `busy:refused:${constellationId}:${d}`;

async function bump(key: string, seconds: number): Promise<number> {
  const [n] = (await redis.multi().incr(key).expire(key, seconds, "NX").exec()) as unknown as [number];
  return Number(n);
}

/** Null when this nebula message may go out; otherwise why not (answer 429). */
export async function nebulaBusy(conversationId: string): Promise<string | null> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return null;
  const slot = Math.floor(Date.now() / 1000 / NEBULA_SEND_LIMIT.per);
  const inNebula = await bump(`busy:nebula:${nebula.id}:${slot}`, NEBULA_SEND_LIMIT.per * 2);
  const inConstellation = await bump(`busy:cx:${nebula.constellationId}:${slot}`, CONSTELLATION_SEND_LIMIT.per * 2);
  if (inNebula <= NEBULA_SEND_LIMIT.max && inConstellation <= CONSTELLATION_SEND_LIMIT.max) return null;
  await bump(busyCountKey(nebula.constellationId), 3 * 24 * 60 * 60);
  return inNebula > NEBULA_SEND_LIMIT.max
    ? `#${nebula.name} is very busy right now. Try again in a few seconds.`
    : "This constellation is very busy right now. Try again in a few seconds.";
}
