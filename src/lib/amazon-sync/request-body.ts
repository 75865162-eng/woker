import { SyncInputError } from "./policy";
/** Bound allocations even when Content-Length is absent or forged. */
export async function boundedRequestText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new SyncInputError("请求过大。", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new SyncInputError("请求过大。", 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Read before session helpers, which may parse a clone for workspace selectors. */
export async function boundedJsonObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new SyncInputError("数据范围不可访问。", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SyncInputError("请求须使用 application/json。", 415);
  const text = await boundedRequestText(request, limit);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new SyncInputError("请求须为 JSON 对象。", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("请求须为 JSON 对象。", 400);
  return value as Record<string, unknown>;
}
