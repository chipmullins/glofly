import { isIP } from "node:net";
import type { RequestHandler } from "express";
import { verifyDeviceRequest } from "./devices";

// Control only answers from the admin's own network(s). On the live server Caddy already
// refuses /admin from anywhere else (ADMIN_IPS in deploy/.env); this is the same check
// again inside the server, in case Caddy is ever misconfigured.
//
// ADMIN_IPS: addresses or IPv4 ranges, separated by spaces or commas, e.g.
//   ADMIN_IPS=203.0.113.24
//   ADMIN_IPS=203.0.113.24 198.51.100.0/24
// Not set: only this computer (127.0.0.1 / ::1), which is right for developing.

const LOOPBACK = ["127.0.0.1", "::1"];

/** "::ffff:203.0.113.24" (IPv4 written as IPv6) → "203.0.113.24". */
export function cleanIp(ip: string | undefined): string {
  if (!ip) return "";
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function matches(ip: string, rule: string): boolean {
  if (rule.includes("/")) {
    const [base, bitsText] = rule.split("/");
    const bits = Number(bitsText);
    if (isIP(base) !== 4 || isIP(ip) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((ipv4ToNumber(ip) & mask) >>> 0) === ((ipv4ToNumber(base) & mask) >>> 0);
  }
  return cleanIp(rule) === ip;
}

export function allowedRules(): string[] {
  const raw = process.env.ADMIN_IPS?.trim();
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : LOOPBACK;
}

export function ipAllowed(ip: string): boolean {
  return allowedRules().some((rule) => matches(ip, rule));
}

/**
 * First thing on every /admin request. 0.9.0: a request signed by an approved phone (Control for
 * iPhone, see devices.ts) is let in from anywhere; everything else only from ADMIN_IPS.
 */
export const requireAdminNetwork: RequestHandler = async (req, res, next) => {
  const ip = cleanIp(req.ip);
  if (req.headers["x-control-device"] !== undefined) {
    const verdict = await verifyDeviceRequest(req, ip);
    if (!verdict.ok) {
      res.status(401).json({ error: "phone_not_approved", message: verdict.message });
      return;
    }
    res.locals.adminIp = ip;
    res.locals.adminDevice = verdict.device;
    next();
    return;
  }
  if (!ipAllowed(ip)) {
    res.status(403).json({
      error: "not_allowed_network",
      message: "Glofly Control only works from your home network.",
    });
    return;
  }
  res.locals.adminIp = ip;
  next();
};
