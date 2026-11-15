"use client";

/**
 * 全站取数 / 缓存融合桥接层。
 *
 * 背景：本项目的 50 个业务工作台里有 296 处直接 `fetch`，没有统一请求封装，
 * 逐页改写既不现实也会破坏已有的 loading / abort / 错误处理。这里在 PageFrame
 * 挂载时对浏览器 `window.fetch` 做一层**可撤销、只增不改语义**的包装，把统一的
 * 拉取逻辑与缓存逻辑真正贯通到所有业务页面，而不是只停留在框架层。
 *
 * 融合的 Wimoor 语义：
 *  - request.js cancelMap 同 URL 取消 → 并发请求去重（dedupeRequest）
 *  - Vuex dict / keep-alive 的短期复用 → JSON GET 短 TTL 缓存
 *  - 单据保存后列表自动刷新 → 任意写操作成功后自动失效缓存
 *  - 切换店铺/工作区清缓存 → page-cache 已订阅 workspaceScopeChangedEventName
 *  - 全局「刷新」按钮 → PageEvents.refresh / invalidate 主动失效
 *
 * 安全边界（任何一条不满足都直接透传原始 fetch，零行为变化）：
 *  - 仅同源 `/api/` 的 GET，且响应为 JSON、200、体积 < 512KB
 *  - 跳过显式 no-store / reload / no-cache、带 AbortSignal、带 x-erp-no-cache 的请求
 *  - 跳过认证、导出、下载、流式、同步任务、轮询、日志、上传导入等易变接口
 *  - 缓存的是响应文本，每次消费都新建 Response，避免多个消费者争抢同一个 body
 */
import {
  dedupeRequest,
  getPageCache,
  invalidatePageCache,
  setPageCache,
} from "./page-cache";
import { PageEvents } from "./page-bus";

/** 短 TTL：兼顾切 tab 复用与数据新鲜度；任何写操作都会立即清空。 */
export const PAGE_FETCH_CACHE_TTL_MS = 15_000;
const MAX_CACHEABLE_BODY = 512 * 1024;

type CachedPayload = {
  body: string;
  status: number;
  statusText: string;
  headers: [string, string][];
};

export type PageFetchBridgeStats = {
  installed: boolean;
  intercepted: number;
  cacheHits: number;
  deduped: number;
  bypassed: number;
  invalidations: number;
};

const stats: PageFetchBridgeStats = {
  installed: false,
  intercepted: 0,
  cacheHits: 0,
  deduped: 0,
  bypassed: 0,
  invalidations: 0,
};

let originalFetch: typeof globalThis.fetch | null = null;
let refCount = 0;
let invalidateListener: (() => void) | null = null;
/** 非 JSON 的原始 Response 只允许被一个消费者读取，其余并发者各自回源。 */
const claimedResponses = new WeakSet<Response>();

const VOLATILE_PATH = /\/(auth|login|logout|csrf|health|heartbeat|export|download|stream|sse|events|sync|jobs|poll|logs?|upload|import|presign|token|nonce)\b/i;
const BINARY_SUFFIX = /\.(csv|xlsx|xls|zip|pdf|png|jpe?g|webp)$/i;

export function getPageFetchBridgeStats(): PageFetchBridgeStats {
  return { ...stats };
}

/** 验收用只读探针：控制台 `window.__erpPageFetchBridge` 可查看实时拦截/命中统计。 */
if (typeof window !== "undefined") {
  Object.defineProperty(window, "__erpPageFetchBridge", {
    configurable: true,
    get: () => getPageFetchBridgeStats(),
  });
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method ?? "GET").toUpperCase();
}

/** init.headers 与 Request 对象自带的 headers 合并，避免漏掉作用域头。 */
function collectHeaders(input: RequestInfo | URL, init?: RequestInit): Headers | null {
  try {
    const headers = new Headers(init?.headers);
    if (typeof input !== "string" && !(input instanceof URL) && input.headers) {
      input.headers.forEach((value, key) => { if (!headers.has(key)) headers.set(key, value); });
    }
    return headers;
  } catch {
    return null;
  }
}

/**
 * 本项目用 x-workspace-id / x-account-id / x-marketplace 等头区分数据作用域，
 * 同一 URL 在不同作用域返回不同结果，必须纳入缓存键，否则会串数据。
 */
const SCOPE_HEADERS = [
  "x-workspace-id", "x-account-id", "x-marketplace", "x-credential-revision",
  "x-current-path", "authorization",
];

function scopeSignature(headers: Headers): string {
  return SCOPE_HEADERS.map((key) => `${key}=${headers.get(key) ?? ""}`).join("|");
}

function isCacheableApiGet(url: URL, init: RequestInit | undefined, headers: Headers | null): boolean {
  if (requestMethod(init) !== "GET") return false;
  if (!url.pathname.startsWith("/api/")) return false;
  if (VOLATILE_PATH.test(url.pathname) || BINARY_SUFFIX.test(url.pathname)) return false;
  if (init?.signal) return false;
  const directive = init?.cache;
  if (directive === "no-store" || directive === "reload" || directive === "no-cache") return false;
  if (!headers) return false;
  if (headers.has("x-erp-no-cache") || headers.has("range")) return false;
  if (headers.get("accept")?.includes("text/event-stream")) return false;
  return true;
}

function toResponse(payload: CachedPayload): Response {
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers: payload.headers,
  });
}

async function readJsonPayload(response: Response): Promise<CachedPayload | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !contentType.toLowerCase().includes("application/json")) return null;
  const body = await response.clone().text();
  if (!body || body.length > MAX_CACHEABLE_BODY) return null;
  return {
    body,
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
  };
}

/**
 * 安装桥接层，返回卸载函数。用引用计数保证多标签 / StrictMode 下只替换一次。
 * 所有失败路径都回落到原始 fetch，业务代码无需感知。
 */
export function installPageFetchBridge(): () => void {
  if (typeof window === "undefined") return () => {};
  refCount += 1;

  if (!originalFetch) {
    originalFetch = window.fetch.bind(window);
    const native = originalFetch;
    stats.installed = true;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let url: URL | null = null;
      try {
        const raw = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        url = new URL(raw, window.location.href);
      } catch {
        url = null;
      }

      // 写操作：成功后清空全部页面缓存，等价于原系统「单据保存后列表自动刷新」。
      const method = requestMethod(init);
      if (url && url.origin === window.location.origin && method !== "GET" && url.pathname.startsWith("/api/")) {
        const response = await native(input as RequestInfo, init);
        if (response.ok) {
          invalidatePageCache();
          stats.invalidations += 1;
        }
        return response;
      }

      const requestHeaders = collectHeaders(input, init);
      if (!url || url.origin !== window.location.origin || !isCacheableApiGet(url, init, requestHeaders)) {
        stats.bypassed += 1;
        return native(input as RequestInfo, init);
      }

      stats.intercepted += 1;
      const cacheKey = `fetch:${url.pathname}${url.search}|${requestHeaders ? scopeSignature(requestHeaders) : ""}`;
      const cached = getPageCache<CachedPayload>(cacheKey);
      if (cached) {
        stats.cacheHits += 1;
        return toResponse(cached);
      }

      try {
        let executed = false;
        const result = await dedupeRequest<{ payload: CachedPayload | null; response?: Response }>(
          cacheKey,
          async () => {
            executed = true;
            const response = await native(input as RequestInfo, init);
            const payload = await readJsonPayload(response).catch(() => null);
            return payload ? { payload } : { payload: null, response };
          },
        );
        if (!executed) stats.deduped += 1;
        if (result.payload) {
          // dedupe 复用同一个 Promise 时，其它并发调用共享结果但各自新建 Response。
          setPageCache(cacheKey, result.payload, PAGE_FETCH_CACHE_TTL_MS);
          return toResponse(result.payload);
        }
        if (result.response && !claimedResponses.has(result.response)) {
          claimedResponses.add(result.response);
          return result.response;
        }
        // 非 JSON 响应（文件流等）不缓存，其余并发者各自回源，避免争抢 body。
        stats.bypassed += 1;
        return native(input as RequestInfo, init);
      } catch (error) {
        stats.bypassed += 1;
        throw error;
      }
    };

    // 全局刷新 / 失效指令到达时清空缓存，下一次取数一定是回源。
    invalidateListener = () => {
      invalidatePageCache();
      stats.invalidations += 1;
    };
    window.addEventListener(PageEvents.refresh, invalidateListener);
    window.addEventListener(PageEvents.invalidate, invalidateListener);
    window.addEventListener(PageEvents.filterChange, invalidateListener);
  }

  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
      stats.installed = false;
      if (invalidateListener) {
        window.removeEventListener(PageEvents.refresh, invalidateListener);
        window.removeEventListener(PageEvents.invalidate, invalidateListener);
        window.removeEventListener(PageEvents.filterChange, invalidateListener);
        invalidateListener = null;
      }
    }
  };
}
