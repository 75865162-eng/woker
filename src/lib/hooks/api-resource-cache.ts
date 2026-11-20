/**
 * 客户端统一获取层 —— 纯核心（与 React 解耦，便于完全单测）。
 *
 * 提供四项能力（对齐《逐页打开速度规划》第二批 §14）：
 *  1. scope+key 缓存复用：同 scope + 同 URL 在 TTL 内共享结果，跨组件不重复请求。
 *  2. 同 key 并发合并：多个组件同时请求同一 key 时，只发一个在途请求，共享 Promise。
 *  3. 失败有限重试：仅对网络错误 / 5xx 重试（默认 1 次），4xx 立即失败，退避可注入。
 *  4. 手动失效：invalidateApiResource 精确清除 key 或前缀。
 *
 * 安全约束：scope headers（workspace / account / marketplace）必须参与缓存键。
 * 调用方通过 buildResourceKey(url, headers) 构造 key；任何 scope 维度变化都会产生
 * 不同的 key，杜绝跨 workspace / 账号的数据串用。
 *
 * 注意：本模块只处理「只读 GET 资源」。运行任务类高频变更数据不应进长缓存，
 * 由调用方用较短 TTL 或 bypassCache 跳过（对齐规划 §5.2）。
 */

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  cache?: RequestCache;
}) => Promise<Response>;

export type ResourceCacheOptions = {
  /** 缓存有效期（毫秒）。默认 0 = 不缓存（仅并发合并）。 */
  ttlMs?: number;
  /** 失败重试次数（仅网络错误/5xx）。默认 1。 */
  retries?: number;
  /** 每次重试前的退避毫秒数，可注入便于测试。默认 200 * 2^attempt。 */
  backoffMs?: (attempt: number) => number;
  /** 可注入的 fetch，便于测试与自定义。默认全局 fetch。 */
  fetcher?: FetchLike;
  /** 测试用：注入单调时钟。默认 Date.now。 */
  now?: () => number;
};

type CacheEntry = { value: unknown; expiresAt: number };
type InflightEntry = { promise: Promise<unknown> };

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

/** 把 HeadersInit 归一化为稳定字符串（排序，忽略 content-type 等非 scope 头）。 */
function normalizeScopeHeaders(headers?: HeadersInit): string {
  if (!headers) return "";
  const pairs: Array<[string, string]> = [];
  const add = (k: string, v: string) => {
    const key = k.toLowerCase();
    // content-type / accept 等不参与数据范围，忽略；其余（x-workspace-id 等）纳入。
    if (key === "content-type" || key === "accept") return;
    pairs.push([key, v]);
  };
  if (headers instanceof Headers) {
    headers.forEach((v, k) => add(k, v));
  } else if (Array.isArray(headers)) {
    for (const [k, v] of headers) add(k, v);
  } else {
    for (const [k, v] of Object.entries(headers)) add(k, String(v));
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** 构造缓存键：URL + 归一化 scope headers。scope 任一维度变化 → key 变化。 */
export function buildResourceKey(url: string, headers?: HeadersInit, query?: Record<string, string | number | undefined>): string {
  let full = url;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) full = `${url}${url.includes("?") ? "&" : "?"}${qs}`;
  }
  const scope = normalizeScopeHeaders(headers);
  return scope ? `${full}|${scope}` : full;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type ResourceResult<T> =
  | { ok: true; value: T; fromCache: boolean; fromInflight: boolean }
  | { ok: false; error: Error };

/**
 * 读取一个只读资源，带缓存/合并/重试。
 * 同一 key 的请求在 in-flight 期间共享同一个 Promise（并发合并）。
 */
export async function readApiResource<T>(key: string, url: string, init: {
  headers?: HeadersInit;
  signal?: AbortSignal;
} = {}, options: ResourceCacheOptions = {}): Promise<ResourceResult<T>> {
  const ttlMs = options.ttlMs ?? 0;
  const retries = Math.max(0, options.retries ?? 1);
  const backoff = options.backoffMs ?? ((attempt: number) => 200 * Math.pow(2, attempt));
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? ((input, i) => fetch(input, i as RequestInit));

  // 1) 命中缓存且未过期 → 直接返回
  const cached = store.get(key);
  if (cached && cached.expiresAt > now()) {
    return { ok: true, value: cached.value as T, fromCache: true, fromInflight: false };
  }

  // 2) 同 key 已有在途请求 → 合并（注意：abort 只应由原始请求方控制）
  const active = inflight.get(key);
  if (active) {
    try {
      const value = await active.promise;
      return { ok: true, value: value as T, fromCache: false, fromInflight: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }

  // 3) 发起新请求（带有限重试）
  const promise = (async (): Promise<unknown> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        const response = await fetcher(url, {
          method: "GET",
          cache: "no-store",
          headers: init.headers,
          signal: init.signal,
        });
        if (!response.ok) {
          const err = new Error(`读取失败（${response.status}）`);
          // 4xx 等不可重试状态：立即抛出，且不被下方 catch 当作可重试错误处理。
          // 用一个标记区分「主动判定不可重试」与「fetch 抛异常」。
          if (!isRetryableStatus(response.status)) {
            (err as Error & { __noRetry?: boolean }).__noRetry = true;
          }
          throw err;
        }
        const value = (await response.json()) as T;
        if (ttlMs > 0) store.set(key, { value, expiresAt: now() + ttlMs });
        return value;
      } catch (cause) {
        const err = cause instanceof Error ? cause : new Error(String(cause));
        const noRetry = (err as Error & { __noRetry?: boolean }).__noRetry === true;
        if (err.name === "AbortError" || noRetry || attempt === retries) throw err;
        // 其余（网络错误 / 5xx）→ 退避后重试
      }
      await sleep(backoff(attempt));
    }
    throw new Error("读取失败");
  })();

  inflight.set(key, { promise });
  try {
    const value = await promise;
    return { ok: true, value: value as T, fromCache: false, fromInflight: false };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause : new Error(String(cause)) };
  } finally {
    inflight.delete(key);
  }
}

/** 精确失效某个 key。 */
export function invalidateApiResource(key: string): void {
  store.delete(key);
}

/** 按前缀批量失效（用于某 scope 或某域整体刷新）。 */
export function invalidateApiResourcePrefix(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

/** 仅供测试：清空所有缓存与在途记录。 */
export function __resetApiResourceCacheForTest(): void {
  store.clear();
  inflight.clear();
}

/** 仅供测试/诊断：当前缓存条目数。 */
export function __apiResourceCacheSize(): number {
  return store.size;
}
