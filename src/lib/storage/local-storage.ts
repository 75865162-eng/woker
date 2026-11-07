import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { StorageDriver, StoredObject } from "@/lib/storage/types";
import { collectBoundedBuffer } from "./bounded-buffer";

const uploadRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "uploads");

function resolveStoragePath(key: string) {
  const normalizedKey = key.replaceAll("\\", "/");
  const target = path.resolve(uploadRoot, normalizedKey);

  if (!target.startsWith(uploadRoot + path.sep) && target !== uploadRoot) {
    throw new Error("Invalid storage key.");
  }

  return target;
}

export const localStorageDriver: StorageDriver = {
  async putFile({ key, file }): Promise<StoredObject> {
    const buffer = Buffer.from(await file.arrayBuffer());
    return this.putBuffer({ key, buffer, contentType: file.type || undefined });
  },

  async putBuffer({ key, buffer, contentType }): Promise<StoredObject> {
    const target = resolveStoragePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);

    return {
      key,
      size: buffer.byteLength,
      contentType,
    };
  },

  async getBuffer(key) {
    return readFile(resolveStoragePath(key));
  },

  async getBoundedBuffer(key, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("STORAGE_READ_LIMIT_INVALID");
    const stream = createReadStream(resolveStoragePath(key), { highWaterMark: Math.min(64 * 1024, maxBytes + 1) });
    try { return await collectBoundedBuffer(stream, maxBytes); }
    finally { stream.destroy(); }
  },

  getLocalPath(key) {
    return resolveStoragePath(key);
  },

  getPublicPath(key) {
    return resolveStoragePath(key);
  },

  async delete(key) {
    await rm(resolveStoragePath(key), { force: true });
  },

  async deletePrefix(keyPrefix) {
    await rm(resolveStoragePath(keyPrefix), { force: true, recursive: true });
  },
};
