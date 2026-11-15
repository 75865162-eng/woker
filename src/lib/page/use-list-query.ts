"use client";

/**
 * 统一列表取数 hook（原生 fetch，无新依赖）。
 *
 * 融合 Wimoor 原系统的四条规则：
 *  - 搜索输入防抖（原 request.js 的 debounce）
 *  - 同 URL 并发请求去重（原 cancelMap 的取消/复用语义）
 *  - 旧响应不得覆盖新响应（请求序号 epoch）
 *  - 页面不可见时暂停轮询（原系统只在激活 tab 刷新）
 * 缓存层用 page-cache.ts 的 30s TTL + 工作区作用域失效。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dedupeRequest,
  getPageCache,
  getPageCacheStats,
  invalidatePageCache,
  PAGE_CACHE_TTL_MS,
  setPageCache,
} from "./page-cache";
import { PageEvents, usePageEvent } from "./page-bus";

export type ListQueryParams = Record<string, string | number | boolean | undefined | null>;

export type UseListQueryOptions = {
  key: string;
  endpoint: string;
  params?: ListQueryParams;
  enabled?: boolean;
  debounceMs?: number;
  pollMs?: number;
  cacheTtlMs?: number;
  refreshToken?: number;
};

export type UseListQueryResult<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
  lastUpdatedAt: number | null;
  fromCache: boolean;
  cacheStats: ReturnType<typeof getPageCacheStats>;
};

/** 稳定序列化：对象字面量每渲染新建也不会造成 effect 死循环。 */
function stableParams(params: ListQueryParams | undefined): string {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    entries.push([key, String(value)]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function buildUrl(endpoint: string, paramsKey: string): string {
  const entries = JSON.parse(paramsKey) as [string, string][];
  if (!entries.length) return endpoint;
  const search = new URLSearchParams();
  for (const [key, value] of entries) search.set(key, value);
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${search.toString()}`;
}

export function useListQuery<T>(options: UseListQueryOptions): UseListQueryResult<T> {
  const {
    key,
    endpoint,
    params,
    enabled = true,
    debounceMs = 250,
    pollMs,
    cacheTtlMs = PAGE_CACHE_TTL_MS,
    refreshToken = 0,
  } = options;

  const paramsKey = useMemo(() => stableParams(params), [params]);
  const cacheKey = `${endpoint}:${paramsKey}`;
  const hookKey = `${key}:${cacheKey}`;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [nonce, setNonce] = useState(0);

  const epochRef = useRef(0);
  const forceRef = useRef(false);
  const prevRefreshToken = useRef(refreshToken);

  // refreshToken 变化 = 外部（提交/审核/切换作用域）要求强制绕过缓存重取。
  useEffect(() => {
    if (prevRefreshToken.current === refreshToken) return;
    prevRefreshToken.current = refreshToken;
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, [refreshToken]);

  const reload = useCallback(() => {
    invalidatePageCache(hookKey);
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, [hookKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const sequence = ++epochRef.current;
    const force = forceRef.current;

    // 命中缓存先立即出数据（原系统 keep-alive 切回页签不闪白屏）。
    const cached = force ? null : getPageCache<T>(cacheKey);
    if (cached !== null) {
      setData(cached);
      setFromCache(true);
      setLoading(false);
      setError(null);
    } else {
      setFromCache(false);
      setLoading(true);
    }

    const timer = setTimeout(() => {
      if (cancelled) return;
      setRefreshing(true);
      void dedupeRequest<T>(cacheKey, async () => {
        const response = await fetch(buildUrl(endpoint, paramsKey), {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          let detail = "";
          try { detail = (await response.text()).slice(0, 160); } catch { /* ignore */ }
          throw new Error(`取数失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
        }
        return (await response.json()) as T;
      })
        .then((result) => {
          if (cancelled || sequence !== epochRef.current) return;
          setPageCache(cacheKey, result, cacheTtlMs);
          setData(result);
          setError(null);
          setFromCache(false);
          setLastUpdatedAt(Date.now());
        })
        .catch((cause: unknown) => {
          if (cancelled || controller.signal.aborted || sequence !== epochRef.current) return;
          // 错误时保留上一次 data，避免整页空白。
          setError(cause instanceof Error ? cause.message : "取数失败，请稍后重试");
        })
        .finally(() => {
          forceRef.current = false;
          if (cancelled || sequence !== epochRef.current) return;
          setLoading(false);
          setRefreshing(false);
        });
    }, Math.max(0, debounceMs));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, endpoint, paramsKey, cacheKey, debounceMs, cacheTtlMs, nonce]);

  // 可选轮询：文档不可见时跳过，回到前台后由下一轮定时器恢复。
  useEffect(() => {
    if (!enabled || !pollMs || pollMs <= 0) return;
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      forceRef.current = true;
      setNonce((value) => value + 1);
    }, pollMs);
    return () => window.clearInterval(interval);
  }, [enabled, pollMs]);

  // 与统一 PageFrame 的工具条联动：全局「刷新 / 清空缓存 / 清除筛选」
  // 会广播事件，所有使用本 hook 的列表自动绕过缓存重新取数。
  const forceRefresh = useCallback(() => {
    if (!enabled) return;
    forceRef.current = true;
    setNonce((value) => value + 1);
  }, [enabled]);
  usePageEvent(PageEvents.refresh, forceRefresh);
  usePageEvent(PageEvents.invalidate, forceRefresh);
  usePageEvent(PageEvents.filterChange, forceRefresh);

  return {
    data,
    error,
    loading,
    refreshing,
    reload,
    lastUpdatedAt,
    fromCache,
    cacheStats: getPageCacheStats(),
  };
}
