import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db } from "../db";
import { attachments, type VoiceInfo } from "../db/schema";
import { storage } from "../storage";

// Photos and files shared in chats.
//
// Photos are decoded and re-saved as WebP in two sizes (a preview for the chat and a
// full-size version), which drops hidden data like the GPS location phones add.
// Everything else is stored exactly as sent and only ever offered as a download.

export { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE } from "@glofly/shared";
/** Uploads waiting to be sent, per person. Stops someone filling the server with unsent files. */
export const UNSENT_PER_PERSON = 20;
const UNSENT_KEEP_MS = 60 * 60 * 1000; // unsent uploads are removed after an hour

const FULL_SIZE = 2560; // longest side of the full-size photo
const PREVIEW_SIZE = 720; // longest side of the preview shown in the chat

export type AttachmentKind = "image" | "file";
export type Variant = "preview" | "full" | "file";

export type AttachmentInfo = {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Voice messages only */
  voice: VoiceInfo | null;
};

// Voice messages: Opus audio recorded in Glofly, up to 5 minutes (about 1–2 MB).
export { VOICE_MAX_MS, VOICE_MAX_BYTES, VOICE_PEAKS_MAX } from "@glofly/shared";

/**
 * WebM (desktop), Ogg (Android) or MP4/AAC (iPhones can't record Opus), by the bytes the file
 * starts with.
 */
export function voiceFormat(data: Buffer): "webm" | "ogg" | "m4a" | null {
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return "webm";
  if (data.length >= 4 && data.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (data.length >= 12 && data.toString("latin1", 4, 8) === "ftyp") return "m4a";
  return null;
}

/** Where each version of an attachment is kept. */
export function keysFor(a: { id: string; conversationId: string; kind: AttachmentKind }): string[] {
  const dir = `attachments/${a.conversationId}/${a.id}`;
  // voice.m4a: a voice message turned into AAC for iPhones (only exists once one asked for it).
  return a.kind === "image" ? [`${dir}/preview.webp`, `${dir}/full.webp`] : [`${dir}/file.bin`, `${dir}/voice.m4a`];
}

export function keyFor(
  a: { id: string; conversationId: string; kind: AttachmentKind },
  variant: Variant,
): string | null {
  const dir = `attachments/${a.conversationId}/${a.id}`;
  if (a.kind === "image" && (variant === "preview" || variant === "full")) return `${dir}/${variant}.webp`;
  if (a.kind === "file" && variant === "file") return `${dir}/file.bin`;
  return null;
}

// Programs, scripts and shortcuts can harm a computer when opened, so Glofly doesn't pass
// them along (the same approach Gmail and Outlook take). Zip them if you really need to.
const BLOCKED_EXTENSIONS = new Set([
  "exe",
  "msi",
  "msix",
  "msixbundle",
  "appx",
  "appxbundle",
  "appinstaller",
  "bat",
  "cmd",
  "com",
  "cpl",
  "scr",
  "pif",
  "vb",
  "vbs",
  "vbe",
  "js",
  "jse",
  "mjs",
  "ws",
  "wsf",
  "wsc",
  "wsh",
  "ps1",
  "ps1xml",
  "ps2",
  "psc1",
  "psm1",
  "psd1",
  "hta",
  "jar",
  "lnk",
  "url",
  "reg",
  "dll",
  "sys",
  "drv",
  "ocx",
  "inf",
  "msc",
  "msp",
  "mst",
  "msh",
  "application",
  "gadget",
  "scf",
  "chm",
  "hlp",
  "iso",
  "img",
  "vhd",
  "vhdx",
  "library-ms",
  "settingcontent-ms",
  "search-ms",
  "diagcab",
  "xll",
  "sh",
  "app",
  "command",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "apk",
  "xbap",
  "website",
  "partial",
  "py",
  "pyw",
]);

const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const NAME_MAX = 120;

/**
 * A safe file name to show and to suggest when saving: no folders, no hidden characters
 * (like the right-to-left trick that makes "photo‮gpj.exe" look like "photoexe.jpg"),
 * nothing Windows refuses.
 */
export function cleanFileName(raw: string): string {
  let name = raw
    .split(/[\\/]/)
    .pop()! // just the file name, never the folders it came from
    .normalize("NFC")
    .replace(HIDDEN_CHARS, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") // no hidden "dot files"
    .replace(/[. ]+$/, ""); // Windows drops trailing dots and spaces
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (!name) name = "file";
  if (name.length > NAME_MAX) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, NAME_MAX - ext.length).trimEnd() + ext;
  }
  return name;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** True for files Glofly won't pass along: programs, scripts and shortcuts. */
export function isBlocked(name: string, data: Buffer): boolean {
  if (BLOCKED_EXTENSIONS.has(extensionOf(name))) return true;
  // A Windows program renamed to look like something else still starts with "MZ".
  return data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a;
}

type Processed =
  | {
      kind: "image";
      preview: Buffer;
      full: Buffer;
      width: number;
      height: number;
    }
  | { kind: "file"; data: Buffer };

const IMAGE_FORMATS = ["jpeg", "png", "webp", "gif", "heif", "avif"];

/** Works out whether an upload is a photo; photos get cleaned and resized. */
export async function processUpload(data: Buffer): Promise<Processed> {
  let meta: sharp.Metadata | null = null;
  try {
    meta = await sharp(data, {
      limitInputPixels: 50_000_000,
      animated: true,
    }).metadata();
  } catch {
    meta = null; // not an image
  }
  if (!meta || !IMAGE_FORMATS.includes(meta.format ?? "")) return { kind: "file", data };

  const animated = (meta.pages ?? 1) > 1;
  const make = (size: number, quality: number) => {
    let image = sharp(data, { limitInputPixels: 50_000_000, animated });
    if (!animated) image = image.rotate(); // turn phone photos the right way up
    return image
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
  };
  try {
    const full = await make(FULL_SIZE, 85);
    const preview = await make(PREVIEW_SIZE, 80);
    return {
      kind: "image",
      full: full.data,
      preview: preview.data,
      width: full.info.width,
      height: full.info.pageHeight ?? full.info.height,
    };
  } catch {
    // Looked like a photo but couldn't be read: share it as a plain file instead.
    return { kind: "file", data };
  }
}

/** Saves an upload and records it as not yet sent. */
export async function storeUpload(
  conversationId: string,
  uploaderId: string,
  name: string,
  processed: Processed,
  voice: VoiceInfo | null = null,
): Promise<AttachmentInfo> {
  const id = randomUUID();
  const base = { id, conversationId, kind: processed.kind };
  const size = processed.kind === "image" ? processed.full.length : processed.data.length;
  if (processed.kind === "image") {
    await storage.put(keyFor(base, "preview")!, processed.preview, "image/webp");
    await storage.put(keyFor(base, "full")!, processed.full, "image/webp");
  } else {
    await storage.put(keyFor(base, "file")!, processed.data, "application/octet-stream");
  }
  try {
    await db.insert(attachments).values({
      id,
      conversationId,
      uploaderId,
      kind: processed.kind,
      name,
      size,
      width: processed.kind === "image" ? processed.width : null,
      height: processed.kind === "image" ? processed.height : null,
      voice: processed.kind === "file" ? voice : null,
    });
  } catch (err) {
    await removeFiles([base]);
    throw err;
  }
  return {
    id,
    kind: processed.kind,
    name,
    size,
    width: processed.kind === "image" ? processed.width : null,
    height: processed.kind === "image" ? processed.height : null,
    voice: processed.kind === "file" ? voice : null,
  };
}

export async function removeFiles(
  list: { id: string; conversationId: string; kind: AttachmentKind }[],
): Promise<void> {
  for (const a of list) {
    for (const key of keysFor(a)) {
      await storage.remove(key).catch((err) => console.error("Couldn't remove", key, err));
    }
  }
}

/** Attachments of some messages, in order, grouped by message. */
export async function attachmentsOf(messageIds: string[]): Promise<Map<string, AttachmentInfo[]>> {
  const map = new Map<string, AttachmentInfo[]>();
  if (!messageIds.length) return map;
  const rows = await db
    .select({
      messageId: attachments.messageId,
      id: attachments.id,
      kind: attachments.kind,
      name: attachments.name,
      size: attachments.size,
      width: attachments.width,
      height: attachments.height,
      voice: attachments.voice,
    })
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds))
    .orderBy(asc(attachments.position));
  for (const { messageId, ...info } of rows) {
    if (!messageId) continue;
    const list = map.get(messageId) ?? [];
    list.push(info);
    map.set(messageId, list);
  }
  return map;
}

/** How many uploads someone has waiting to be sent. */
export async function unsentCount(uploaderId: string): Promise<number> {
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.uploaderId, uploaderId), isNull(attachments.messageId)));
  return rows.length;
}

/** Removes uploads that were never sent. Runs every few minutes. */
export async function sweepUnsentUploads(): Promise<void> {
  const old = await db
    .delete(attachments)
    .where(
      and(isNull(attachments.messageId), lt(attachments.createdAt, new Date(Date.now() - UNSENT_KEEP_MS))),
    )
    .returning({
      id: attachments.id,
      conversationId: attachments.conversationId,
      kind: attachments.kind,
    });
  await removeFiles(old);
}

/** "photo.jpg" → "photo.webp", for saving a photo Glofly re-saved as WebP. */
export function webpName(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.webp`;
}
