import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
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
// Node's BlockList understands every way of writing an address (IPv6 short forms, IPv4 written
// inside IPv6 like ::ffff:a9fe:a9fe), so a trick spelling can't slip a private address through.

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. AWS metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3], // multicast and reserved
];
const blocked4 = new BlockList();
for (const [net, bits] of BLOCKED_V4) blocked4.addSubnet(net, bits, "ipv4");
// IPv6: only global unicast (2000::/3) is public, minus documentation, 6to4, Teredo and NAT64.
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const blocked6 = new BlockList();
for (const [net, bits] of [
  ["2001:db8::", 32],
  ["2001::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
] as [string, number][])
  blocked6.addSubnet(net, bits, "ipv6");

/** An IPv4 address written inside IPv6 (::ffff:a.b.c.d or ::a.b.c.d, any spelling), or null. */
function embeddedV4(v6: string): string | null {
  const m = v6.toLowerCase().match(/^(?:0*:)*?(?:0*:)?(?::ffff:|::|0:0:0:0:0:ffff:|0:0:0:0:0:0:)((?:\d+\.){3}\d+|[0-9a-f]{1,4}:[0-9a-f]{1,4})$/);
  if (!m) return null;
  if (m[1].includes(".")) return m[1];
  const [hi, lo] = m[1].split(":").map((x) => parseInt(x, 16));
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !blocked4.check(ip, "ipv4");
  if (kind !== 6) return false;
  const v4 = embeddedV4(ip);
  if (v4) return isIP(v4) === 4 && !blocked4.check(v4, "ipv4");
  return global6.check(ip, "ipv6") && !blocked6.check(ip, "ipv6");
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

/**
 * The page's <meta> tags as name → content, read in one pass over the start of the page (where
 * they live). The patterns can't backtrack, so a hostile page can't make this slow.
 */
function metaTags(html: string): Map<string, string> {
  const head = html.slice(0, 64 * 1024);
  const end = head.search(/<\/head\s*>/i);
  const part = end >= 0 ? head.slice(0, end) : head;
  const tags = new Map<string, string>();
  const tag = /<meta\b[^>]{0,2000}>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = tag.exec(part)) && count++ < 400) {
    const attrs = new Map<string, string>();
    const attr = /([a-z:-]{1,40})\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/gi;
    let a: RegExpExecArray | null;
    while ((a = attr.exec(m[0]))) attrs.set(a[1].toLowerCase(), a[2] ?? a[3] ?? "");
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !tags.has(key)) tags.set(key, content);
  }
  return tags;
}

function meta(tags: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = decode(tags.get(name) ?? "");
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
  const tags = metaTags(html);
  const title = meta(tags, ["og:title", "twitter:title"]) ?? decode(html.slice(0, 64 * 1024).match(/<title[^>]{0,200}>([^<]{1,300})<\/title>/i)?.[1] ?? "");
  if (!title) return null;
  const description = meta(tags, ["og:description", "twitter:description", "description"]);
  const siteName = meta(tags, ["og:site_name", "application-name"]) ?? page.url.hostname.replace(/^www\./, "");
  const imageLink = meta(tags, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);

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
