"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildResourceKey, readApiResource, invalidateApiResource,
  type FetchLike,
} from "./api-resource-cache";

export type UseApiResourceOptions<T> = {
  /** 请求 URL。 */
  url: string;
  /** scope headers（workspace/account/marketplace）。变化时自动换 key 重新读取。 */
  headers?: HeadersInit;
  /** 附加查询参数，参与缓存键。 */
  query?: Record<string, string | number | undefined>;
  /** 缓存有效期毫秒。运行任务类数据用 0（仅并发合并，不跨次缓存）。默认 0。 */
  ttlMs?: number;
  /** 失败重试次数（仅网络/5xx）。默认 1。 */
  retries?: number;
  /** 是否挂载后立即读取。默认 true。 */
  enabled?: boolean;
  /** 可注入 fetch（测试/自定义）。 */
  fetcher?: FetchLike;
  /** 初始数据。 */
  initialData?: T;
};

export type UseApiResourceResult<T> = {
  data: T | undefined;
  loading: boolean;
  error: string;
  /** 手动重新读取（强制绕过当前缓存一次：先失效 key 再读）。 */
  reload: () => Promise<void>;
  /** 仅失效缓存（不立即读取）。 */
  invalidate: () => void;
};

/**
 * 客户端统一获取 Hook（SWR-style 薄封装）。
 *
 * 与现有组件 `data / loading / error / load()` 模式兼容，迁移成本低：
 *   const { data, loading, error, reload } = useApiResource<Overview>({
 *     url: "/api/integrations/amazon/ads/reports",
 *     headers: workspaceScopeHeaders(),
 *   });
 *
 * 能力来自纯核心 api-resource-cache：scope+key 缓存复用、同 key 并发合并、
 * 失败有限重试、手动失效。卸载时 abort 在途请求且不写状态。
 */
export function useApiResource<T>(options: UseApiResourceOptions<T>): UseApiResourceResult<T> {
  const { url, headers, query, ttlMs = 0, retries = 1, enabled = true, fetcher, initialData } = options;

  const key = buildResourceKey(url, headers, query);
  const [data, setData] = useState<T | undefined>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  // 用 ref 保存最新 options，避免把对象依赖塞进 effect 导致反复触发。
  const optsRef = useRef({ headers, ttlMs, retries, fetcher });
  optsRef.current = { headers, ttlMs, retries, fetcher };
  const keyRef = useRef(key);
  keyRef.current = key;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const read = useCallback(async (signal: AbortSignal, bypassCache: boolean) => {
    if (bypassCache) invalidateApiResource(keyRef.current);
    const o = optsRef.current;
    setLoading(true);
    const result = await readApiResource<T>(keyRef.current, url, {
      headers: o.headers,
      signal,
    }, {
      ttlMs: o.ttlMs,
      retries: o.retries,
      fetcher: o.fetcher,
    });
    if (!mountedRef.current || signal.aborted) return;
    if (result.ok) {
      setData(result.value);
      setError("");
    } else {
      if (result.error.name !== "AbortError") setError(result.error.message);
    }
    setLoading(false);
  }, [url]);

  // key 变化（scope / query / url 变化）→ 取消旧请求、读取新 key。
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void read(controller.signal, false);
    return () => controller.abort();
  }, [key, enabled, read]);

  const reload = useCallback(async () => {
    const controller = new AbortController();
    await read(controller.signal, true);
  }, [read]);

  const invalidate = useCallback(() => {
    invalidateApiResource(keyRef.current);
  }, []);

  return { data, loading, error, reload, invalidate };
}
