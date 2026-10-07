import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

// Where uploaded files (profile photos, and soon chat attachments) are kept.
//
// While developing, files go in a folder on this computer. At launch this same
// interface gets an Amazon S3 version, and nothing else in the server changes.

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Null if there's no such file. */
  get(key: string): Promise<{ stream: Readable; size: number } | null>;
  remove(key: string): Promise<void>;
}

/** Keys look like "avatars/<userId>/<version>.webp": only safe characters, no "..". */
const SAFE_KEY = /^[a-z0-9-]+(\/[a-zA-Z0-9-]+)*\.[a-z0-9]+$/;

class LocalDiskStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Turns a key into a path, refusing anything that could escape the uploads folder. */
  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`Unsafe storage key: ${key}`);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error(`Unsafe storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<{ stream: Readable; size: number } | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      return { stream: createReadStream(path), size: info.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

// UPLOADS_DIR can point somewhere else; by default it's apps/server/uploads (git-ignored).
export const storage: Storage = new LocalDiskStorage(process.env.UPLOADS_DIR ?? "uploads");
