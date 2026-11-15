"use client";

import { fetchExtQuery } from "./ext-query";
import { readWorkspaceApiQuery } from "./workspace-api-cache";

type ExtQuery = { kind: string; query?: Record<string, string> };

/**
 * 路由 → 首屏会发出的查询（默认筛选值）。
 *
 * 指针停在链接上时先把这些查询取回来写进缓存，点进页面时 `useExt` 直接命中，
 * 不用再等一个 3G/DB 往返。参数必须和页面里的 `useExt(kind, query)` 完全一致，
 * 否则键对不上，等于白取一次。
 */
const ROUTE_EXT_QUERIES: Record<string, ExtQuery[]> = {
  "/operations/repricing": [{ kind: "repricing-bundle", query: { status: "PENDING" } }],
  "/operations/tax": [{ kind: "tax-invoices", query: { period: "" } }, { kind: "tax-periods" }],
  "/operations/reviews": [{ kind: "reviews", query: { sentiment: "", status: "" } }, { kind: "performance" }],
  "/operations/sales-plans": [{ kind: "sales-plans" }, { kind: "options" }],
  "/operations/multi-channel": [{ kind: "channel-accounts" }, { kind: "channel-orders", query: { channel: "" } }],
  "/operations/procurement-collab": [{ kind: "payment-requests" }, { kind: "exchange-orders" }, { kind: "quotations" }],
  "/operations/data-dictionary": [{ kind: "dictionaries" }, { kind: "custom-fields" }],
  "/operations/calculators": [{ kind: "calc-schemes" }],
};

/** 已经发起过预取的查询键：同一个键在一次会话里只取一次。 */
const prefetched = new Set<string>();

export function extQueryKey(query: ExtQuery) {
  return new URLSearchParams({ kind: query.kind, ...(query.query ?? {}) }).toString();
}

/**
 * 预取目标路由的首屏数据。只处理声明过的路由，其余路由交给 Next 的 RSC 预取。
 * 返回前不会抛错：预取失败只是退化成进页面时再取一次。
 */
export function prefetchRouteData(href: string) {
  const path = href.split("?")[0] || "/";
  const queries = ROUTE_EXT_QUERIES[path];
  if (!queries?.length) return;

  for (const query of queries) {
    const key = extQueryKey(query);
    if (prefetched.has(key) || readWorkspaceApiQuery(key)) continue;
    prefetched.add(key);
    // 与 `useExt` 共用同一个取数入口：页面抢先发起时，这里直接搭同一次请求。
    void fetchExtQuery(key).catch(() => {
      // 失败就把键放回，下次悬停还可以再试。
      prefetched.delete(key);
    });
  }
}
