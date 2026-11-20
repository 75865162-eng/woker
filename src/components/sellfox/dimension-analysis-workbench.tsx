"use client";

import { useEffect, useMemo, useState } from "react";
import { SellfoxTabs } from "@/components/sellfox/sellfox-nav";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { sellfoxSiteLabel } from "@/lib/sellfox/marketplace-site";
import type { Dimension } from "@/lib/sellfox/dimension-analysis";

type StoreLink = { storeId: string; externalId: string; name: string; marketplace: string };
type PersonLink = { name: string; storeCount: number; mskuCount: number; stores: StoreLink[]; sites: string[] };
type SiteLink = { marketplace: string; code: string; label: string; storeCount: number; personCount: number; mskuCount: number; stores: StoreLink[]; people: string[] };
type StorePersonView = {
  externalId: string; name: string; marketplace: string; code: string; label: string;
  country: string; status: string; personCount: number; mskuCount: number; people: string[];
};
type Coverage = { stores: number; people: number; sites: number; snapshotRows: number };
type Body = {
  dimension?: Dimension;
  salespeople?: PersonLink[];
  stores?: StorePersonView[];
  sites?: SiteLink[];
  coverage?: Coverage;
  cache?: { status: "hit" | "miss" | "bypass"; cachedAt: string | null };
  error?: string;
};

const DIM_TABS: { id: Dimension; label: string }[] = [
  { id: "salesperson", label: "业务员" },
  { id: "store", label: "店铺" },
  { id: "site", label: "站点" },
];

function list(values: string[] | undefined, empty = "-"): string {
  if (!values || !values.length) return empty;
  return values.join("、");
}

function storeList(stores: StoreLink[] | undefined): string {
  if (!stores || !stores.length) return "-";
  return stores.map((s) => `${sellfoxSiteLabel(s.marketplace) || s.marketplace}-${s.name}`).join("、");
}

export function DimensionAnalysisWorkbench() {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(() => normalizeWorkspaceScope());
  const [dimension, setDimension] = useState<Dimension>("salesperson");
  const [query, setQuery] = useState("");
  const [body, setBody] = useState<Body | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setScope(normalizeWorkspaceScope());
    setReady(true);
    const changed = () => { setScope(normalizeWorkspaceScope()); setBody(null); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, []);

  const headers = useMemo(() => ({
    "x-workspace-id": scope.workspaceId,
    ...(scope.accountId ? { "x-account-id": scope.accountId } : {}),
    ...(scope.marketplace ? { "x-marketplace": scope.marketplace } : {}),
  }), [scope]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("workspaceId", scope.workspaceId);
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    setLoading(true);
    setError("");
    fetch(`/api/sellfox/dimensions?${params}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Body;
        if (!response.ok) throw new Error(data.error || "读取维度名单失败");
        return data;
      })
      .then((data) => { if (!controller.signal.aborted) setBody(data); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setBody(null);
        setError(reason instanceof Error ? reason.message : "读取维度名单失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [headers, ready, nonce, scope.accountId, scope.marketplace, scope.workspaceId]);

  const coverage = body?.coverage ?? { stores: 0, people: 0, sites: 0, snapshotRows: 0 };
  const q = query.trim().toLowerCase();
  const match = (value: string) => !q || value.toLowerCase().includes(q);

  const people = (body?.salespeople ?? []).filter((p) => match(p.name) || p.stores.some((s) => match(s.name) || match(s.marketplace)));
  const stores = (body?.stores ?? []).filter((s) => match(s.name) || match(s.externalId) || match(s.label) || match(s.marketplace) || s.people.some(match));
  const sites = (body?.sites ?? []).filter((s) => match(s.label) || match(s.code) || match(s.marketplace));

  return (
    <section className="sellfox-ui">
      <SellfoxTabs current="/sellfox/dimensions" />
      <div className="sf-dims" role="tablist" aria-label="维度">
        {DIM_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-current={dimension === tab.id ? "page" : undefined} onClick={() => setDimension(tab.id)}>{tab.label}</button>
        ))}
      </div>
      <div className="sf-filter">
        <input aria-label="名单搜索" placeholder="搜索业务员 / 店铺 / 站点" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="sf-btn" onClick={() => setQuery("")}>清空</button>
        <button type="button" className="sf-btn" onClick={() => setNonce((n) => n + 1)}>刷新</button>
        <span className="sf-label">覆盖 {coverage.people} 业务员 / {coverage.stores} 店铺 / {coverage.sites} 站点 · {coverage.snapshotRows.toLocaleString("zh-CN")} 快照行</span>
      </div>
      {body?.cache?.status === "hit" && body.cache.cachedAt ? (
        <p className="sf-notice" role="status">缓存更新于 {new Date(body.cache.cachedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}；点「刷新」获取实时口径。</p>
      ) : null}
      {error ? <p className="sf-notice" role="alert">{error}</p> : null}
      <div className="sf-table-wrap">
        <table>
          <thead>
            <tr>
              {dimension === "salesperson" ? <><th>业务员</th><th>关联店铺数</th><th>关联商品数</th><th>关联店铺（站点-店铺）</th><th>关联站点</th></> : null}
              {dimension === "store" ? <><th>店铺</th><th>店铺 ID</th><th>站点</th><th>国家</th><th>状态</th><th>关联业务员</th><th>关联商品数</th></> : null}
              {dimension === "site" ? <><th>站点</th><th>Marketplace ID</th><th>关联店铺数</th><th>关联业务员数</th><th>关联商品数</th><th>关联店铺</th><th>关联业务员</th></> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7}>加载中</td></tr> : null}
            {!loading && dimension === "salesperson" ? people.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td><td className="sf-num">{p.storeCount}</td><td className="sf-num">{p.mskuCount}</td>
                <td>{storeList(p.stores)}</td><td>{list(p.sites.map(sellfoxSiteLabel))}</td>
              </tr>
            )) : null}
            {!loading && dimension === "store" ? stores.map((s) => (
              <tr key={s.externalId}>
                <td>{s.name || "-"}</td><td>{s.externalId}</td><td>{s.label || s.marketplace || "-"}</td>
                <td>{s.country || "-"}</td><td>{s.status || "-"}</td>
                <td>{list(s.people)}</td><td className="sf-num">{s.mskuCount}</td>
              </tr>
            )) : null}
            {!loading && dimension === "site" ? sites.map((s) => (
              <tr key={s.marketplace}>
                <td>{s.label}</td><td>{s.marketplace}</td><td className="sf-num">{s.storeCount}</td>
                <td className="sf-num">{s.personCount}</td><td className="sf-num">{s.mskuCount}</td>
                <td>{storeList(s.stores)}</td><td>{list(s.people)}</td>
              </tr>
            )) : null}
            {!loading && !error && ((dimension === "salesperson" && people.length === 0) || (dimension === "store" && stores.length === 0) || (dimension === "site" && sites.length === 0)) ? (
              <tr><td colSpan={7}><div className="sf-empty" role="status"><strong>暂无名单</strong>本地快照尚无该维度的关联数据；不补 0、不臆造。</div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
