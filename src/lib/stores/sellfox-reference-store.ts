"use client";

/**
 * 赛狐引用数据会话级 Store（zustand）。
 *
 * 目标：店铺 / 站点 / 业务员在登录会话内只加载一次，跨页面切换零请求、下拉零 spinner。
 * 分层：只放跨页稳定的引用数据；列表/详情仍由各页自己管理，不塞进全局 store。
 *
 * 关键机制：
 * - scopeKey 变化（workspace/account/marketplace 或权限三态变化）时静默重载，禁止旧 scope 数据闪现；
 * - ensureLoaded 并发去重（同一 scopeKey 只发一次请求）；
 * - refresh 后台静默刷新（stale-while-revalidate），失败保留旧值；
 * - 不持久化到 sessionStorage：避免同步后失效遗漏导致陈旧，刷新页重拉一次成本可接受。
 */
import { create } from "zustand";
import { readApiResource } from "@/lib/hooks/api-resource-cache";

export type ReferenceStoreItem = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string | null };
export type ReferenceSiteItem = { marketplace: string; code: string; label: string; storeCount: number };
export type ReferencePersonItem = { name: string; storeCount: number; stores: string[] };

export type ReferenceCacheStatus = "hit" | "miss" | "bypass" | null;

export type SellfoxReferenceState = {
  scopeKey: string | null;
  stores: ReferenceStoreItem[];
  sites: ReferenceSiteItem[];
  salespersons: ReferencePersonItem[];
  status: "idle" | "loading" | "ready" | "error";
  version: string | null;
  loadedAt: number | null;
  error: string | null;
  cacheStatus: ReferenceCacheStatus;
  ensureLoaded: (scopeKey: string) => Promise<void>;
  refresh: () => Promise<void>;
  invalidate: () => void;
};

type Payload = {
  stores?: ReferenceStoreItem[];
  sites?: ReferenceSiteItem[];
  salespersons?: ReferencePersonItem[];
  version?: string;
  cache?: { status?: ReferenceCacheStatus };
};

const ENDPOINT = "/api/sellfox/reference-data";

let inflight: Promise<void> | null = null;
let inflightScope: string | null = null;

async function fetchReference(scopeKey: string): Promise<Payload> {
  const url = `${ENDPOINT}?scope=${encodeURIComponent(scopeKey)}`;
  // 走客户端统一取数层：获得网络错误/5xx 有限重试；TTL 交给本 store 的会话级缓存管理（ttlMs=0）。
  const result = await readApiResource<Payload>(`sellfox:reference:${scopeKey}`, url, {}, { ttlMs: 0, retries: 1 });
  if (!result.ok) throw result.error;
  return result.value;
}

export const useSellfoxReferenceStore = create<SellfoxReferenceState>((set, get) => ({
  scopeKey: null,
  stores: [],
  sites: [],
  salespersons: [],
  status: "idle",
  version: null,
  loadedAt: null,
  error: null,
  cacheStatus: null,

  ensureLoaded: async (scopeKey: string) => {
    const state = get();
    if (state.scopeKey === scopeKey && (state.status === "ready" || inflightScope === scopeKey)) {
      if (inflightScope === scopeKey && inflight) return inflight;
      return; // 已加载，零请求
    }
    if (inflightScope === scopeKey && inflight) return inflight;
    // scope 变化：先清空旧数据，禁止旧账号/店铺数据闪现。
    set({ scopeKey, status: "loading", error: null, stores: [], sites: [], salespersons: [], version: null, loadedAt: null });
    const task = (async () => {
      try {
        const payload = await fetchReference(scopeKey);
        set({
          scopeKey,
          stores: payload.stores ?? [],
          sites: payload.sites ?? [],
          salespersons: payload.salespersons ?? [],
          version: payload.version ?? null,
          cacheStatus: payload.cache?.status ?? null,
          status: "ready",
          loadedAt: Date.now(),
          error: null,
        });
      } catch (error) {
        set({ status: "error", error: error instanceof Error ? error.message : "unknown" });
      } finally {
        if (inflightScope === scopeKey) { inflight = null; inflightScope = null; }
      }
    })();
    inflight = task;
    inflightScope = scopeKey;
    return task;
  },

  refresh: async () => {
    const { scopeKey } = get();
    if (!scopeKey) return;
    // 后台静默刷新：失败保留旧值，不改 status（stale-while-revalidate）。
    try {
      const payload = await fetchReference(scopeKey);
      set({
        stores: payload.stores ?? [],
        sites: payload.sites ?? [],
        salespersons: payload.salespersons ?? [],
        version: payload.version ?? null,
        cacheStatus: payload.cache?.status ?? null,
        status: "ready",
        loadedAt: Date.now(),
        error: null,
      });
    } catch {
      // 保留旧值，不翻转 status。
    }
  },

  invalidate: () => {
    set({ status: "idle", scopeKey: null, loadedAt: null });
  },
}));

/** 供 provider 计算的稳定 scopeKey：与 API 侧三态分片口径一致。 */
export function referenceScopeKey(input: {
  organizationId: string;
  workspaceId: string;
  accountId?: string | null;
  marketplace?: string | null;
  storeScope?: string[] | "all" | "none";
}): string {
  const storePart = input.storeScope === "all" || input.storeScope === undefined
    ? "all"
    : input.storeScope === "none"
      ? "__NO_SELLFOX_STORE__"
      : [...input.storeScope].sort().join(",");
  return [input.organizationId, input.workspaceId, input.accountId ?? "", input.marketplace ?? "", storePart].join("|");
}

export const useStores = () => useSellfoxReferenceStore((s) => s.stores);
export const useSites = () => useSellfoxReferenceStore((s) => s.sites);
export const useSalespersons = () => useSellfoxReferenceStore((s) => s.salespersons);
