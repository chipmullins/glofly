import type { Request } from "express";

/** "::ffff:1.2.3.4" (IPv4 as Node sometimes reports it) → "1.2.3.4"; IPv6 lower case. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith("::ffff:") && v.includes(".") ? v.slice(7) : v;
}

/** The caller's address as the server sees it (Caddy's when TRUST_PROXY=1, see index.ts). */
export const clientIp = (req: Request): string => normalizeIp(req.ip ?? req.socket.remoteAddress ?? "");
