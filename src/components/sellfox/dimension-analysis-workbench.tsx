"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SellfoxTabs } from "@/components/sellfox/sellfox-nav";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { sellfoxSiteLabel, siteCodeOf } from "@/lib/sellfox/marketplace-site";
import type { AsinRow, Dimension } from "@/lib/sellfox/dimension-analysis";

type StoreLink = { storeId: string; externalId: string; name: string; marketplace: string };
type PersonLink = { name: string; storeCount: number; mskuCount: number; stores: StoreLink[]; sites: string[] };
type SiteLink = { marketplace: string; code: string; label: string; storeCount: number; personCount: number; mskuCount: number; stores: StoreLink[]; people: string[] };
type StorePersonView = {
  externalId: string; name: string; marketplace: string; code: string; label: string;
  country: string; status: string; personCount: number; mskuCount: number; people: string[];
};
type Coverage = { stores: number; people: number; sites: number; snapshotRows: number; asins: number };
type Body = {
  dimension?: Dimension;
  salespeople?: PersonLink[];
  stores?: StorePersonView[];
  sites?: SiteLink[];
  asinByStore?: Record<string, AsinRow[]>;
  coverage?: Coverage;
  cache?: { status: "hit" | "miss" | "bypass"; cachedAt: string | null };
  error?: string;
};

const DIM_TABS: { id: Dimension; label: string }[] = [
  { id: "salesperson", label: "业务员" },
  { id: "store", label: "店铺" },
  { id: "site", label: "站点" },
];

/** 站点代码 → 国旗 emoji；仅用于展示，无对应则留空。 */
const SITE_FLAG: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", MX: "🇲🇽", BR: "🇧🇷", UK: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NL: "🇳🇱", SE: "🇸🇪", PL: "🇵🇱", BE: "🇧🇪", IE: "🇮🇪", JP: "🇯🇵", AU: "🇦🇺",
  SG: "🇸🇬", IN: "🇮🇳", AE: "🇦🇪", SA: "🇸🇦", TR: "🇹🇷",
};

/** 从店铺名剥离末尾站点后缀（如 "Coco店-US" → "Coco店"），得到账号/分组名。 */
function accountOf(name: string, code: string): string {
  const trimmed = (name || "").trim();
  const suffix = `-${code || ""}`.toUpperCase();
  if (code && trimmed.toUpperCase().endsWith(suffix) && trimmed.length > suffix.length) {
    return trimmed.slice(0, trimmed.length - suffix.length).trim();
  }
  // 兜底：剥离任意 -XX 两位站点后缀。
  return trimmed.replace(/-[A-Z]{2}$/i, "").trim() || trimmed || "未命名";
}

function list(values: string[] | undefined, empty = "-"): string {
  if (!values || !values.length) return empty;
  return values.join("、");
}

function fmtMoney(value: string | null): string {
  if (value == null || value === "") return "-";
  const n = Number(value);
  return Number.isFinite(n) ? `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : value;
}

export function DimensionAnalysisWorkbench() {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(() => normalizeWorkspaceScope());
  const [dimension, setDimension] = useState<Dimension>("store");
  const [siteFilter, setSiteFilter] = useState("");
  const [shopFilter, setShopFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
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

  const allStores = body?.stores ?? [];
  const allPeople = body?.salespeople ?? [];
  const allSites = body?.sites ?? [];
  const asinByStore = body?.asinByStore ?? {};
  const coverage = body?.coverage ?? { stores: 0, people: 0, sites: 0, snapshotRows: 0, asins: 0 };

  // 三个筛选联动：先按站点收窄店铺候选，再按业务员收窄，最终得到可见店铺集合。
  const siteOptions = allSites.map((s) => ({ value: s.marketplace, label: s.label || s.code }));
  const shopOptions = allStores
    .filter((s) => !siteFilter || s.marketplace === siteFilter)
    .filter((s) => !personFilter || s.people.includes(personFilter))
    .map((s) => ({ value: s.externalId, label: `${s.name || s.externalId}（${s.label || s.code}）` }));
  const personOptions = allPeople
    .filter((p) => !siteFilter || p.sites.includes(siteFilter))
    .filter((p) => !shopFilter || p.stores.some((st) => st.externalId === shopFilter))
    .map((p) => ({ name: p.name }));

  const visibleStores = allStores.filter((s) =>
    (!siteFilter || s.marketplace === siteFilter) &&
    (!shopFilter || s.externalId === shopFilter) &&
    (!personFilter || s.people.includes(personFilter))
  );

  const clearFilters = () => { setSiteFilter(""); setShopFilter(""); setPersonFilter(""); setExpandedStore(null); };
  const activeFilter = Boolean(siteFilter || shopFilter || personFilter);

  return (
    <section className="sellfox-ui">
      <SellfoxTabs current="/sellfox/dimensions" />
      <div className="sf-dims" role="tablist" aria-label="维度">
        {DIM_TABS.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-current={dimension === tab.id ? "page" : undefined} onClick={() => { setDimension(tab.id); setExpandedStore(null); }}>{tab.label}</button>
        ))}
      </div>
      <div className="sf-filter">
        <select aria-label="站点筛选" value={siteFilter} onChange={(e) => { setSiteFilter(e.target.value); setShopFilter(""); setExpandedStore(null); }}>
          <option value="">全部站点</option>
          {siteOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="店铺筛选" value={shopFilter} onChange={(e) => { setShopFilter(e.target.value); setExpandedStore(null); }}>
          <option value="">全部店铺</option>
          {shopOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="业务员筛选" value={personFilter} onChange={(e) => { setPersonFilter(e.target.value); setExpandedStore(null); }}>
          <option value="">全部业务员</option>
          {personOptions.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
        <button type="button" className="sf-btn" onClick={clearFilters}>清空筛选</button>
        <button type="button" className="sf-btn" onClick={() => setNonce((n) => n + 1)}>刷新</button>
        <span className="sf-label">覆盖 {coverage.people} 业务员 / {coverage.stores} 店铺 / {coverage.sites} 站点 / {coverage.asins} ASIN</span>
      </div>
      {body?.cache?.status === "hit" && body.cache.cachedAt ? (
        <p className="sf-notice" role="status">缓存更新于 {new Date(body.cache.cachedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}；点「刷新」获取实时口径。</p>
      ) : null}
      {error ? <p className="sf-notice" role="alert">{error}</p> : null}

      {/* 店铺维度：按账号分组，点店铺行内联展开该店铺 ASIN（只显示该店铺）。 */}
      {!loading && dimension === "store" ? (() => {
        const groups = new Map<string, StorePersonView[]>();
        for (const s of visibleStores) {
          const key = accountOf(s.name, s.code);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(s);
        }
        const groupList = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        if (!groupList.length) return <div className="sf-table-wrap"><table><tbody><tr><td><div className="sf-empty" role="status"><strong>暂无符合条件的店铺</strong>调整筛选或点「刷新」；不补 0、不臆造。</div></td></tr></tbody></table></div>;
        return (
          <div className="sf-group-table">
            {groupList.map(([account, rows]) => (
              <section className="sf-group" key={account}>
                <div className="sf-group-head"><strong>账号：{account}</strong><span className="sf-muted">{rows.length} 个站点店铺 · {rows.reduce((n, s) => n + (asinByStore[s.externalId]?.length ?? 0), 0)} 个 ASIN</span></div>
                <div className="sf-table-wrap">
                  <table>
                    <thead><tr><th>店铺名称</th><th>站点</th><th>关联业务员</th><th>ASIN 数</th><th>商品数</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {rows.map((s) => {
                        const asins = asinByStore[s.externalId] ?? [];
                        const expanded = expandedStore === s.externalId;
                        return (
                          <FragmentRow key={s.externalId}>
                            <tr className={expanded ? "sf-row-expanded" : undefined}>
                              <td><span className="sf-stack"><strong>{s.name || s.externalId}</strong><small className="sf-muted">ID {s.externalId}</small></span></td>
                              <td><span className="sf-site-cell">{SITE_FLAG[s.code] || "🏳️"} {s.label || s.code || s.marketplace}</span></td>
                              <td>{list(s.people)}</td>
                              <td className="sf-num">{asins.length}</td>
                              <td className="sf-num">{s.mskuCount}</td>
                              <td>{s.status || "-"}</td>
                              <td><button type="button" className="sf-link" aria-expanded={expanded} onClick={() => setExpandedStore(expanded ? null : s.externalId)}>{expanded ? "收起 ASIN" : "查看 ASIN"}</button></td>
                            </tr>
                            {expanded ? (
                              <tr className="sf-asin-row"><td colSpan={7}>
                                <div className="sf-asin-panel">
                                  <p className="sf-muted">{s.name || s.externalId} · 共 {asins.length} 个 ASIN（仅显示本店铺）</p>
                                  {asins.length ? (
                                    <div className="sf-table-wrap"><table>
                                      <thead><tr><th>图片</th><th>ASIN</th><th>标题</th><th>SKU / MSKU</th><th>销量</th><th>净销售额</th></tr></thead>
                                      <tbody>
                                        {asins.map((a) => (
                                          <tr key={a.asin}>
                                            {/* 赛狐快照图片为外部域名，沿用复刻页 sf-thumb 原生 img 范式 */}
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <td>{a.imageUrl ? <img className="sf-thumb" src={a.imageUrl} alt="" loading="lazy" /> : <span className="sf-muted">-</span>}</td>
                                            <td><span className="sf-mono">{a.asin}</span></td>
                                            <td><span className="sf-stack"><span>{a.title || "-"}</span>{a.parentAsin ? <small className="sf-muted">父 ASIN {a.parentAsin}</small> : null}</span></td>
                                            <td><span className="sf-muted">{a.sku || "-"}{a.msku && a.msku !== a.sku ? ` / ${a.msku}` : ""}</span></td>
                                            <td className="sf-num">{a.saleQuantity ?? "-"}</td>
                                            <td className="sf-num">{fmtMoney(a.netRevenue)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table></div>
                                  ) : <div className="sf-empty"><strong>该店铺暂无 ASIN 快照</strong>不补 0、不臆造。</div>}
                                </div>
                              </td></tr>
                            ) : null}
                          </FragmentRow>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        );
      })() : null}

      {/* 业务员维度：按业务员分组，列出其关联店铺。 */}
      {!loading && dimension === "salesperson" ? (() => {
        const groups = allPeople.filter((p) => !personFilter || p.name === personFilter).filter((p) =>
          (!siteFilter || p.sites.includes(siteFilter)) &&
          (!shopFilter || p.stores.some((st) => st.externalId === shopFilter))
        );
        if (!groups.length) return <div className="sf-table-wrap"><table><tbody><tr><td><div className="sf-empty" role="status"><strong>暂无符合条件的业务员</strong>调整筛选或点「刷新」。</div></td></tr></tbody></table></div>;
        return (
          <div className="sf-group-table">
            {groups.map((p) => (
              <section className="sf-group" key={p.name}>
                <div className="sf-group-head"><strong>业务员：{p.name}</strong><span className="sf-muted">{p.storeCount} 个店铺 · {p.mskuCount} 个商品</span></div>
                <div className="sf-table-wrap"><table>
                  <thead><tr><th>店铺名称</th><th>站点</th><th>ASIN 数</th></tr></thead>
                  <tbody>
                    {p.stores.filter((st) => !siteFilter || st.marketplace === siteFilter).filter((st) => !shopFilter || st.externalId === shopFilter).map((st) => {
                      const store = allStores.find((s) => s.externalId === st.externalId);
                      const code = store?.code || siteCodeOf(st.marketplace);
                      return <tr key={st.storeId}><td><span className="sf-stack"><strong>{st.name || st.externalId}</strong><small className="sf-muted">ID {st.externalId}</small></span></td><td>{SITE_FLAG[code] || "🏳️"} {sellfoxSiteLabel(st.marketplace) || st.marketplace}</td><td className="sf-num">{(asinByStore[store?.externalId ?? ""] ?? []).length}</td></tr>;
                    })}
                  </tbody>
                </table></div>
              </section>
            ))}
          </div>
        );
      })() : null}

      {/* 站点维度：按站点分组，列出其下店铺。 */}
      {!loading && dimension === "site" ? (() => {
        const groups = allSites.filter((s) => !siteFilter || s.marketplace === siteFilter).filter((s) =>
          !shopFilter || s.stores.some((st) => st.externalId === shopFilter)
        ).filter((s) => !personFilter || s.people.includes(personFilter));
        if (!groups.length) return <div className="sf-table-wrap"><table><tbody><tr><td><div className="sf-empty" role="status"><strong>暂无符合条件的站点</strong>调整筛选或点「刷新」。</div></td></tr></tbody></table></div>;
        return (
          <div className="sf-group-table">
            {groups.map((s) => (
              <section className="sf-group" key={s.marketplace}>
                <div className="sf-group-head"><strong>{SITE_FLAG[s.code] || "🏳️"} 站点：{s.label}</strong><span className="sf-muted">Marketplace ID {s.marketplace} · {s.storeCount} 店铺 · {s.personCount} 业务员</span></div>
                <div className="sf-table-wrap"><table>
                  <thead><tr><th>店铺名称</th><th>关联业务员</th><th>ASIN 数</th><th>商品数</th></tr></thead>
                  <tbody>
                    {s.stores.filter((st) => !shopFilter || st.externalId === shopFilter).map((st) => {
                      const store = allStores.find((x) => x.externalId === st.externalId);
                      return <tr key={st.storeId}><td><span className="sf-stack"><strong>{st.name || st.externalId}</strong><small className="sf-muted">ID {st.externalId}</small></span></td><td>{list(store?.people)}</td><td className="sf-num">{(asinByStore[st.externalId] ?? []).length}</td><td className="sf-num">{store?.mskuCount ?? "-"}</td></tr>;
                    })}
                  </tbody>
                </table></div>
              </section>
            ))}
          </div>
        );
      })() : null}

      {loading ? <div className="sf-table-wrap"><table><tbody><tr><td>加载中…</td></tr></tbody></table></div> : null}
      {!loading && activeFilter && dimension === "store" && visibleStores.length === 0 ? null : null}
    </section>
  );
}

/** 让一个店铺的“行 + 展开 ASIN 行”成对渲染，避免被 React 当作两个独立 tr。 */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
