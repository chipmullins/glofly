import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { storage } from "../storage";
import { VOICE_MAX_BYTES, voiceFormat } from "./attachments";

// iPhones can't play Opus in WebM or Ogg (what the desktop and Android apps record), so the
// iPhone app asks for voice messages as AAC in MP4 (.m4a). The first request converts the file
// with ffmpeg and keeps the result next to the original (attachments/<chat>/<id>/voice.m4a);
// later ones are served from storage. Voice messages recorded on an iPhone are AAC already.
//
// The input is a voice message the server already checked (WebM/Ogg by its first bytes, at most
// VOICE_MAX_BYTES); ffmpeg only reads it from a pipe (no files, no network), with a time limit.

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const TIME_LIMIT_MS = 20_000;
const MAX_RUNNING = 2;
let running = 0;

async function readAll(stream: Readable, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > max) {
      stream.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function convert(input: Buffer, format: "webm" | "ogg"): Promise<Buffer | null> {
  return (async () => {
    const dir = await mkdtemp(join(tmpdir(), "glofly-voice-"));
    const out = join(dir, "voice.m4a");
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const p = spawn(
          FFMPEG,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "pipe,file",
            "-f",
            format,
            "-i",
            "pipe:0",
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-ac",
            "1",
            "-movflags",
            "+faststart",
            "-f",
            "ipod",
            "-y",
            out,
          ],
          { stdio: ["pipe", "ignore", "ignore"] },
        );
        const timer = setTimeout(() => p.kill("SIGKILL"), TIME_LIMIT_MS);
        p.on("error", () => {
          clearTimeout(timer);
          resolve(false);
        });
        p.on("close", (code) => {
          clearTimeout(timer);
          resolve(code === 0);
        });
        p.stdin.on("error", () => {});
        p.stdin.end(input);
      });
      if (!ok) return null;
      const data = await readFile(out);
      return data.length > 0 && data.length <= VOICE_MAX_BYTES * 2 ? data : null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })().catch(() => null);
}

/** The voice message as .m4a, or null if it isn't one or can't be converted (no ffmpeg, broken file). */
export async function voiceAsM4a(a: { id: string; conversationId: string }): Promise<Buffer | null> {
  const dir = `attachments/${a.conversationId}/${a.id}`;
  const saved = await storage.get(`${dir}/voice.m4a`);
  if (saved) return readAll(saved.stream, VOICE_MAX_BYTES * 2);
  const original = await storage.get(`${dir}/file.bin`);
  if (!original) return null;
  const data = await readAll(original.stream, VOICE_MAX_BYTES);
  if (!data) return null;
  const format = voiceFormat(data);
  if (format === "m4a") return data;
  if (!format || running >= MAX_RUNNING) return null;
  running++;
  try {
    const m4a = await convert(data, format);
    if (m4a) await storage.put(`${dir}/voice.m4a`, m4a, "audio/mp4");
    return m4a;
  } finally {
    running--;
  }
}
