import { SyncInputError } from "./policy";
import { isSellfoxSameOrigin } from "@/lib/sellfox/request-origin";
/** Bound allocations even when Content-Length is absent or forged. */
export async function boundedRequestText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new SyncInputError("请求过大。", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { void reader.cancel().catch(() => undefined); throw new SyncInputError("请求过大。", 413); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

/** Read before session helpers, which may parse a clone for workspace selectors. */
export async function boundedJsonObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  return (await boundedJsonObjectWithRaw(request, limit)).value;
}

/**
 * Same validation as boundedJsonObject but also returns the exact raw text that
 * was consumed. Callers that must authorize after body validation can rebuild an
 * equivalent Request from the raw text, avoiding a second (failing) body read.
 */
export async function boundedJsonObjectWithRaw(request: Request, limit: number): Promise<{ value: Record<string, unknown>; raw: string }> {
  // CSRF origin must be compared against the configured trusted public entry,
  // never request.url.origin (the internal reverse-proxy origin), otherwise
  // every same-site browser request behind Caddy/Nginx is rejected.
  // No Origin / non-browser clients pass, matching the middleware CSRF policy.
  if (!isSellfoxSameOrigin(request)) throw new SyncInputError("数据范围不可访问。", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SyncInputError("请求须使用 application/json。", 415);
  const raw = await boundedRequestText(request, limit);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new SyncInputError("请求须为 JSON 对象。", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("请求须为 JSON 对象。", 400);
  return { value: value as Record<string, unknown>, raw };
}
