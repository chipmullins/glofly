import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Request, RequestHandler, Response } from "express";

// Glofly in a browser (chat.glofly.app), Oct 2026.
//
// The desktop and phone apps keep their session token in the system's encrypted storage and send
// it as "Authorization: Bearer …". A web page has no safe place for a token (anything the page's
// own script can read, injected script could read too), so browsers get the session as a cookie
// the page can never see:
//
//   - httpOnly + Secure + SameSite=Strict, host-only on api.glofly.app (the __Host- prefix makes
//     the browser refuse it otherwise). It's sent only to this server, and only from glofly.app
//     pages (chat.glofly.app and api.glofly.app are the same "site").
//   - CORS allows exactly one origin, WEB_ORIGIN (https://chat.glofly.app), with credentials.
//     Any other page's requests get no CORS answer, so the browser won't let it read anything.
//   - CSRF: every request that changes something must also carry X-Glofly-CSRF, a value derived
//     from the session token that the page gets from /auth/login or /auth/me. A custom header
//     forces the browser's CORS check first, and another glofly.app page (the website, which
//     can't run script anyway) couldn't know the value. The Origin header must match too.
//   - The cookie only works for sessions made by the web app (platform "web"), and the live
//     connection only accepts it from WEB_ORIGIN.
//
// Unset WEB_ORIGIN (as on a PC by default) turns all of this off: no CORS, no cookies, exactly
// the server the apps had before. Bearer tokens work the same either way.

function originFrom(setting: string | undefined): string | null {
  if (!setting?.trim()) return null;
  try {
    const url = new URL(setting.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    console.error(`WEB_ORIGIN isn't a web address (${setting}). Glofly in a browser is off.`);
    return null;
  }
}

/** Where the web app lives (https://chat.glofly.app), or null if the web app is off. */
export const WEB_ORIGIN = originFrom(process.env.WEB_ORIGIN);
export const webEnabled = WEB_ORIGIN !== null;

// Secure cookies need https. A PC test over http://localhost uses a plain name (browsers only
// accept the __Host- prefix on Secure cookies).
const SECURE = WEB_ORIGIN?.startsWith("https:") ?? true;
export const SESSION_COOKIE = SECURE ? "__Host-glofly_session" : "glofly_session";

export const CSRF_HEADER = "x-glofly-csrf";

/** The CSRF value for a session: only someone who has the session token can work it out. */
export function csrfFor(token: string): string {
  return createHmac("sha256", token).update("glofly-csrf-v1").digest("base64url");
}

export function csrfMatches(token: string, sent: unknown): boolean {
  if (typeof sent !== "string" || sent.length > 100) return false;
  const want = Buffer.from(csrfFor(token));
  const got = Buffer.from(sent);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The session token from the cookie, if there is one that looks right. */
export function cookieToken(headers: IncomingHttpHeaders): string | null {
  if (!webEnabled) return null;
  const raw = headers.cookie;
  if (typeof raw !== "string" || raw.length > 8192) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
  }
  return null;
}

/** Is this request from the web app's own page? */
export const fromWebOrigin = (headers: IncomingHttpHeaders): boolean =>
  webEnabled && headers.origin === WEB_ORIGIN;

/**
 * Hands the browser its session cookie. "Keep me signed in": kept until the session expires
 * (renewed whenever the app loads); otherwise gone when the browser closes (and the server's
 * session ends after a day either way).
 */
export function setSessionCookie(res: Response, token: string, persistent: boolean, expiresAt: Date): void {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(SECURE ? ["Secure"] : []),
    ...(persistent ? [`Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))}`] : []),
  ];
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict${SECURE ? "; Secure" : ""}; Max-Age=0`,
  );
}

/** Does this request say it's the web app (X-Glofly-Platform: web)? */
export const saysWeb = (req: Request): boolean => req.headers["x-glofly-platform"] === "web";

const ALLOWED_HEADERS = "Content-Type, X-Glofly-CSRF, X-Glofly-Version, X-Glofly-Platform, X-Glofly-Features";
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";

/**
 * CORS for the web app only. Requests from any other page get no CORS headers at all, so their
 * browser keeps the answer from them (and refuses to send anything but the simplest requests).
 */
export const webCors: RequestHandler = (req, res, next) => {
  if (!webEnabled) return next();
  res.vary("Origin");
  // Glofly Control's routes are never for the web app.
  if (req.headers.origin !== WEB_ORIGIN || req.path === "/admin" || req.path.startsWith("/admin/")) return next();
  res.setHeader("Access-Control-Allow-Origin", WEB_ORIGIN!);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  // Lets the page read why it was refused (rate limits say when to try again).
  res.setHeader("Access-Control-Expose-Headers", "RateLimit, RateLimit-Policy, Retry-After");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
    return;
  }
  next();
};

/**
 * A cookie-signed-in request must come from the web app's page, and anything but reading must
 * carry the CSRF value. Answers 403 and returns false if not.
 */
export function cookieRequestAllowed(req: Request, res: Response, token: string): boolean {
  const origin = req.headers.origin;
  // Plain <img> and <audio> loads don't send Origin; anything that does must be the web app.
  if (origin !== undefined && origin !== WEB_ORIGIN) {
    res.status(403).json({ error: "forbidden", message: "Not allowed from this page." });
    return false;
  }
  const reading = req.method === "GET" || req.method === "HEAD";
  if (!reading && (origin !== WEB_ORIGIN || !csrfMatches(token, req.headers[CSRF_HEADER]))) {
    res.status(403).json({ error: "csrf", message: "Please reload Glofly and try again." });
    return false;
  }
  return true;
}
