"use client";

/**
 * 列表查询状态：URL 化 + sessionStorage 持久化。
 *
 * 对应 Wimoor 原系统（Vue）的行为：
 *  - 筛选条件写进地址栏，可分享、可回退（原系统 router query）
 *  - 每个列表页用 ckey 把筛选存在会话里，再次进入自动恢复（这里用 persistKey）
 * keep-alive 保活由 PersistentAppShell 多标签 iframe 承担，此处只管查询条件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type ListQueryState = {
  page: number;
  pageSize: number;
  sort?: string;
  order?: "asc" | "desc";
  filters: Record<string, string>;
};

export const DEFAULT_QUERY_STATE: ListQueryState = { page: 1, pageSize: 20, filters: {} };

const MANAGED_KEYS = ["page", "pageSize", "sort", "order"] as const;
const FILTER_PREFIX = "f_";
const STORAGE_PREFIX = "tiaotiao.erp.query.";

function boundedInt(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cleanFilters(input: Record<string, string> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (key && value !== "" && value !== undefined && value !== null) output[key] = String(value);
  }
  return output;
}

/** 从 URL 读取列表状态；`f_` 前缀的参数归入 filters。 */
export function readListQueryState(
  input: URLSearchParams | string,
  defaults: Partial<ListQueryState> = {},
): ListQueryState {
  const source = typeof input === "string" ? input.replace(/^\?/, "") : input.toString();
  const params = new URLSearchParams(source);
  const filters = cleanFilters({ ...(defaults.filters ?? {}), ...readFilterParams(params) });
  const orderRaw = params.get("order");
  return {
    page: boundedInt(params.get("page"), defaults.page ?? DEFAULT_QUERY_STATE.page, 1, 100000),
    pageSize: boundedInt(params.get("pageSize"), defaults.pageSize ?? DEFAULT_QUERY_STATE.pageSize, 1, 500),
    sort: params.get("sort") || defaults.sort || undefined,
    order: orderRaw === "asc" || orderRaw === "desc" ? orderRaw : defaults.order,
    filters,
  };
}

function readFilterParams(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    if (key.startsWith(FILTER_PREFIX) && key.length > FILTER_PREFIX.length) {
      result[key.slice(FILTER_PREFIX.length)] = value;
    }
  });
  return result;
}

/** 把状态写回 URLSearchParams；保留 base 中与列表无关的参数（view / tab / domain 等）。 */
export function writeListQueryState(state: ListQueryState, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base ? base.toString() : "");
  for (const key of MANAGED_KEYS) params.delete(key);
  const stale: string[] = [];
  params.forEach((_value, key) => {
    if (key.startsWith(FILTER_PREFIX)) stale.push(key);
  });
  for (const key of stale) params.delete(key);

  params.set("page", String(Math.max(1, state.page)));
  params.set("pageSize", String(Math.max(1, state.pageSize)));
  if (state.sort) params.set("sort", state.sort);
  if (state.order) params.set("order", state.order);
  for (const [key, value] of Object.entries(cleanFilters(state.filters))) {
    params.set(`${FILTER_PREFIX}${key}`, value);
  }
  return params;
}

/** 合并补丁；筛选变化时自动回到第 1 页，与 Wimoor 列表页行为一致。 */
export function mergeListQueryState(
  current: ListQueryState,
  patch: Partial<ListQueryState> & { filters?: Record<string, string> },
): ListQueryState {
  const filters = cleanFilters(patch.filters ? { ...current.filters, ...patch.filters } : current.filters);
  const filterChanged = Boolean(patch.filters) && Object.keys(patch.filters ?? {}).length > 0;
  return {
    page: filterChanged && patch.page === undefined ? 1 : (patch.page ?? current.page),
    pageSize: patch.pageSize ?? current.pageSize,
    sort: patch.sort !== undefined ? patch.sort || undefined : current.sort,
    order: patch.order !== undefined ? patch.order : current.order,
    filters,
  };
}

type UseListQueryStateOptions = {
  debounceMs?: number;
  persistKey?: string;
  defaults?: Partial<ListQueryState>;
};

/**
 * 受控列表状态 hook。写回用 history.replaceState，不触发 Next 整页刷新，
 * 也不会把筛选塞进浏览器历史栈（后退由 popstate 显式接管）。
 */
export function useListQueryState(options: UseListQueryStateOptions = {}) {
  const { debounceMs = 250, persistKey, defaults } = options;
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const urlString = searchParams?.toString() ?? "";

  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [state, setStateInternal] = useState<ListQueryState>(() =>
    readListQueryState(urlString, defaultsRef.current ?? {}),
  );
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(state);
  latestRef.current = state;

  const storageKey = persistKey ? `${STORAGE_PREFIX}${persistKey}` : null;

  const commit = useCallback(
    (next: ListQueryState, immediate: boolean) => {
      latestRef.current = next;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const apply = () => {
        timerRef.current = null;
        if (typeof window === "undefined") return;
        const params = writeListQueryState(next, new URLSearchParams(window.location.search));
        const query = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
        );
        if (storageKey) {
          try {
            sessionStorage.setItem(storageKey, JSON.stringify({
              filters: next.filters,
              pageSize: next.pageSize,
              sort: next.sort,
              order: next.order,
            }));
          } catch { /* 隐私模式 / 配额不足时静默降级 */ }
        }
      };
      if (immediate || debounceMs <= 0) apply();
      else timerRef.current = setTimeout(apply, debounceMs);
    },
    [debounceMs, storageKey],
  );

  const setState = useCallback((next: ListQueryState) => {
    setStateInternal(next);
    commit(next, false);
  }, [commit]);

  const patch = useCallback(
    (value: Partial<ListQueryState> & { filters?: Record<string, string> }) => {
      const next = mergeListQueryState(latestRef.current, value);
      setStateInternal(next);
      commit(next, false);
    },
    [commit],
  );

  const reset = useCallback(() => {
    const base = readListQueryState("", defaultsRef.current ?? {});
    const next: ListQueryState = { ...base, page: 1 };
    if (storageKey) {
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
    setStateInternal(next);
    commit(next, true);
  }, [commit, storageKey]);

  // 首次挂载：优先恢复会话里的筛选（原系统 ckey 语义），URL 有显式参数时以 URL 为准。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search);
    const hasUrlFilters = Array.from(current.keys()).some((key) => key.startsWith(FILTER_PREFIX));
    let restored: Partial<ListQueryState> | null = null;
    if (storageKey && !hasUrlFilters) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) restored = JSON.parse(raw) as Partial<ListQueryState>;
      } catch { /* 损坏的会话数据按无缓存处理 */ }
    }
    const initial = restored
      ? mergeListQueryState(readListQueryState(current, defaultsRef.current ?? {}), {
          filters: restored.filters ?? {},
          pageSize: restored.pageSize,
          sort: restored.sort,
          order: restored.order,
        })
      : readListQueryState(current, defaultsRef.current ?? {});
    setStateInternal(initial);
    setReady(true);
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readListQueryState(
        typeof window === "undefined" ? "" : window.location.search,
        defaultsRef.current ?? {},
      );
      setStateInternal(next);
      latestRef.current = next;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // 卸载前把待写入的筛选立即落盘，避免快速跳转丢失条件。
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (typeof window !== "undefined") {
        const params = writeListQueryState(latestRef.current, new URLSearchParams(window.location.search));
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      }
    }
  }, []);

  const searchString = useMemo(() => writeListQueryState(state).toString(), [state]);

  return { state, setState, patch, reset, ready, searchString, pathname };
}
