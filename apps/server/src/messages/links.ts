import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import sharp from "sharp";
import type { LinkPreviewInfo } from "../db/schema";
import { storage } from "../storage";

// Link previews (0.5.0): the first link in a message gets a card with the page's title, site and
// picture. The server fetches the page (never the apps, so nobody's address goes to the site),
// only reads the bits it needs, and saves a small copy of the picture, served by Glofly.
//
// Fetching a link someone typed is the classic way to trick a server into reaching places it
// shouldn't (its own network, AWS's metadata address). So: only http and https on ports 80/443,
// every address the name points to must be on the public internet (checked at connect time,
// so a name can't change in between), at most 3 redirects (each checked again), 5 seconds,
// 512 KB of the page and 5 MB of picture, and nothing is ever run.

const UA = "Mozilla/5.0 (compatible; GloflyBot/1.0; +https://glofly.app)";
const TIME_LIMIT_MS = 5000;
const PAGE_MAX = 512 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_SIZE = 640;
/** Testing only (a page on this computer): LINK_PREVIEW_ALLOW_PRIVATE=1. Never on the live server. */
const ALLOW_PRIVATE = process.env.LINK_PREVIEW_ALLOW_PRIVATE === "1" && process.env.NODE_ENV !== "production";

/** The first http(s) link in a message, or null. */
export function firstLink(body: string): string | null {
  const m = body.match(/\bhttps?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  const url = m[0].replace(/[),.!?;:'"\]]+$/, "");
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- Is this address on the public internet? ----

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. AWS metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !v4Private(ip);
  if (kind !== 6) return false;
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return !v4Private(mapped[1]);
  if (v6 === "::" || v6 === "::1") return false;
  return !/^(fc|fd|fe8|fe9|fea|feb|ff|64:ff9b|100::|2001:db8|2001::|2002:)/.test(v6);
}

/** Resolves a host and refuses anything not on the public internet. */
async function publicAddress(host: string): Promise<{ address: string; family: number } | null> {
  const bare = host.replace(/^\[|\]$/g, "");
  const addresses = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await lookup(bare, { all: true }).catch(() => []);
  if (!addresses.length) return null;
  if (!ALLOW_PRIVATE && addresses.some((a) => !isPublicAddress(a.address))) return null;
  return addresses[0];
}

/** One request to a checked address (the name was checked; the connection uses that exact address). */
async function fetchOnce(
  url: URL,
  accept: string,
  max: number,
): Promise<{ status: number; type: string; location: string | null; body: Buffer } | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.port && url.port !== "80" && url.port !== "443" && !ALLOW_PRIVATE) return null;
  if (url.username || url.password) return null;
  const target = await publicAddress(url.hostname);
  if (!target) return null;
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = lib.request(
      url,
      {
        method: "GET",
        headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en" },
        timeout: TIME_LIMIT_MS,
        // Connect to the address that was checked, whatever the name says now.
        // (Node asks for a list when it tries IPv4 and IPv6 side by side.)
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          opts?.all
            ? cb(null, [{ address: target.address, family: target.family }])
            : cb(null, target.address, target.family)) as unknown as import("node:net").LookupFunction,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, type, location, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > max) {
            // Enough: a page's preview lives in its first part.
            chunks.push(c.subarray(0, Math.max(0, max - (size - c.length))));
            res.destroy();
            resolve({ status, type, location, body: Buffer.concat(chunks) });
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status, type, location, body: Buffer.concat(chunks) }));
        res.on("error", () => resolve(null));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    setTimeout(() => req.destroy(), TIME_LIMIT_MS + 500).unref();
    req.end();
  });
}

/** Follows up to 3 redirects, checking each address. */
async function safeFetch(start: string, accept: string, max: number) {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    return null;
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await fetchOnce(url, accept, max);
    if (!r) return null;
    if (r.status >= 300 && r.status < 400 && r.location) {
      try {
        url = new URL(r.location, url);
      } catch {
        return null;
      }
      continue;
    }
    return r.status >= 200 && r.status < 300 ? { ...r, url } : null;
  }
  return null;
}

// ---- Reading the page ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decode(s: string): string {
  return s
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
      return m;
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content\s*=\s*("([^"]*)"|'([^']*)')/i);
    const value = content ? decode(content[2] ?? content[3] ?? "") : "";
    if (value) return value;
  }
  return null;
}

export type FoundPreview = { info: LinkPreviewInfo; image: Buffer | null };

/** A link's preview, or null if there's nothing worth showing. */
export async function previewFor(link: string): Promise<FoundPreview | null> {
  const page = await safeFetch(link, "text/html,application/xhtml+xml", PAGE_MAX);
  if (!page || !/text\/html|application\/xhtml/.test(page.type)) return null;
  const html = page.body.toString("utf8");
  const title = meta(html, ["og:title", "twitter:title"]) ?? decode(html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ?? "");
  if (!title) return null;
  const description = meta(html, ["og:description", "twitter:description", "description"]);
  const siteName = meta(html, ["og:site_name", "application-name"]) ?? page.url.hostname.replace(/^www\./, "");
  const imageLink = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);

  let image: Buffer | null = null;
  let size: { width: number; height: number } | null = null;
  if (imageLink) {
    try {
      const src = new URL(imageLink, page.url).toString();
      const pic = await safeFetch(src, "image/*", IMAGE_MAX);
      if (pic && pic.type.startsWith("image/") && !pic.type.includes("svg")) {
        const out = await sharp(pic.body, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer({ resolveWithObject: true });
        if (out.info.width >= 32 && out.info.height >= 32) {
          image = out.data;
          size = { width: out.info.width, height: out.info.height };
        }
      }
    } catch {
      image = null;
    }
  }
  return {
    info: {
      url: link.slice(0, 2000),
      title: title.slice(0, 200),
      description: description ? description.slice(0, 300) : null,
      siteName: siteName ? siteName.slice(0, 80) : null,
      image: size,
    },
    image,
  };
}

/** Where a message's preview picture is kept. */
export const previewImageKey = (conversationId: string, messageId: string) => `previews/${conversationId}/${messageId}.webp`;

export async function savePreviewImage(conversationId: string, messageId: string, image: Buffer): Promise<void> {
  await storage.put(previewImageKey(conversationId, messageId), image, "image/webp");
}
