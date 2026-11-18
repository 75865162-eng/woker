import type { ExportFormat } from "./types";

/**
 * 生成报告的短时下载存储。仅存在于当前 Node 进程内存，带容量上限与 TTL，
 * 不做持久化、不写业务表、不跨实例共享。进程重启即失效，符合报告临时下载定位。
 */

type Entry = {
  bytes: Uint8Array;
  fileName: string;
  format: ExportFormat;
  createdAt: number;
};

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 200;
const store = new Map<string, Entry>();
let counter = 0;

function purgeExpired(now: number) {
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

export function putReport(input: {
  bytes: Uint8Array;
  fileName: string;
  format: ExportFormat;
  organizationId: string;
  userId: string;
}): string {
  const now = Date.now();
  purgeExpired(now);
  counter += 1;
  const id = `${now.toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  store.set(id, {
    bytes: input.bytes,
    fileName: input.fileName,
    format: input.format,
    createdAt: now,
  });
  return id;
}

export function getReport(id: string): Entry | undefined {
  const entry = store.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(id);
    return undefined;
  }
  return entry;
}
