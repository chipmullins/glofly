import { createReadStream } from "node:fs";
import { mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Where uploaded files (profile photos, and soon chat attachments) are kept.
//
// While developing, files go in a folder on this computer. On the live server
// (STORAGE_BUCKET set) they go in a private Amazon S3 bucket instead; nothing
// else in the server knows the difference.

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
    const path = this.pathFor(key);
    await rm(path, { force: true });
    // Tidy up folders left empty (rmdir refuses folders that still have files in them).
    let dir = dirname(path);
    while (dir.startsWith(this.root + sep)) {
      try {
        await rmdir(dir);
      } catch {
        break;
      }
      dir = dirname(dir);
    }
  }
}

function checkKey(key: string): string {
  if (!SAFE_KEY.test(key)) throw new Error(`Unsafe storage key: ${key}`);
  return key;
}

/**
 * Private S3 bucket. The server reads and writes it with the EC2 machine's own
 * AWS role (no keys in .env); files are only ever handed out through the
 * server's signed-in routes, never by public bucket links.
 */
class S3Storage implements Storage {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    // Region + credentials come from the machine (AWS_REGION, instance role).
    // S3_ENDPOINT is only for testing against a stand-in S3 on this computer.
    const endpoint = process.env.S3_ENDPOINT?.trim();
    this.client = new S3Client(endpoint ? { endpoint, forcePathStyle: true } : {});
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: checkKey(key), Body: data, ContentType: contentType })
    );
  }

  async get(key: string): Promise<{ stream: Readable; size: number } | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      if (!(out.Body instanceof Readable)) return null;
      return { stream: out.Body, size: out.ContentLength ?? 0 };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    // S3 has no folders to tidy, and deleting a missing file isn't an error.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
  }
}

// Live server: STORAGE_BUCKET=<bucket name>. Otherwise a local folder:
// UPLOADS_DIR can point somewhere else; by default it's apps/server/uploads (git-ignored).
const bucket = process.env.STORAGE_BUCKET?.trim();
export const storage: Storage = bucket
  ? new S3Storage(bucket)
  : new LocalDiskStorage(process.env.UPLOADS_DIR ?? "uploads");
export const storageKind = bucket ? `S3 bucket ${bucket}` : "local uploads folder";
