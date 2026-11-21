"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { formatSiteStore, sellfoxSiteLabel } from "@/lib/sellfox/marketplace-site";

type SiteGroup = {
  marketplaceId: string; code: string; label: string; sellerCount: number; skuCount: number; asinCount: number;
};
type SellerGroup = {
  sellerAccountId: string; sellerName: string; marketplaceId: string; code: string; label: string;
  skuCount: number; asinCount: number;
  snapshotCapturedAt: string | null; freshness: "FRESH" | "STALE" | "NOT_SYNCED";
};
type CatalogItemRow = {
  sellerSku: string; asin: string; title: string; imageFileId: string | null;
  listingStatus: string | null; fulfillmentType: string | null;
  available: number | null; inbound: number | null; reserved: number | null; unfulfillable: number | null;
  saleQuantity: number; orderCount: number;
};
type ItemBody = {
  sellerAccountId?: string; marketplaceId?: string;
  items?: CatalogItemRow[]; snapshotCapturedAt?: string | null;
  coverage?: { skus: number; catalogRows: number; inventoryRows: number; orderRows: number; truncated: boolean };
  salesBasis?: string; error?: string;
};
type Body = {
  sites?: SiteGroup[]; sellers?: SellerGroup[];
  coverage?: { sites: number; sellers: number; skus: number; asins: number; catalogRows: number; truncated: boolean };
  error?: string;
};

const SITE_FLAG: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", MX: "🇲🇽", BR: "🇧🇷", UK: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NL: "🇳🇱", SE: "🇸🇪", PL: "🇵🇱", BE: "🇧🇪", IE: "🇮🇪", JP: "🇯🇵", AU: "🇦🇺",
  SG: "🇸🇬", IN: "🇮🇳", AE: "🇦🇪", SA: "🇸🇦", TR: "🇹🇷",
};
const SALES_NOTE = "销量＝订单商品表按 Seller SKU 汇总的累计件数（按订单口径），不是按日销量快照，也不等于店铺级销售流量；下单时间与在线商品快照时间可能不同步，仅作参考。库存四列来自 FBA 库存快照，未同步显示“-”，不补 0。";

function accountOf(name: string, code: string): string {
  const trimmed = (name || "").trim();
  const suffix = `-${code || ""}`.toUpperCase();
  if (code && trimmed.toUpperCase().endsWith(suffix) && trimmed.length > suffix.length) {
    return trimmed.slice(0, trimmed.length - suffix.length).trim();
  }
  return trimmed.replace(/-[A-Z]{2}$/i, "").trim() || trimmed || "未命名";
}
function freshnessLabel(value: string): string {
  return value === "FRESH" ? "新鲜" : value === "STALE" ? "已过期" : "未同步";
}
function freshnessColor(value: string): string {
  return value === "FRESH" ? "var(--success-ink)" : value === "STALE" ? "var(--warning-ink)" : "var(--muted)";
}
function num(value: number | null | undefined): string {
  return value == null ? "-" : value.toLocaleString("zh-CN");
}
function statusLabel(value: string | null): string {
  if (!value) return "-";
  const map: Record<string, string> = { ACTIVE: "在售", INACTIVE: "停售", ARCHIVED: "已归档", DRAFT: "草稿" };
  return map[value.toUpperCase()] ?? value;
}

export function AmazonCatalogWorkbench() {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(() => normalizeWorkspaceScope());
  const [siteFilter, setSiteFilter] = useState("");
  const [shopFilter, setShopFilter] = useState("");
  const [body, setBody] = useState<Body | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [itemCache, setItemCache] = useState<Record<string, ItemBody>>({});
  const [itemLoading, setItemLoading] = useState("");

  useEffect(() => {
    setScope(normalizeWorkspaceScope());
    setReady(true);
    const changed = () => {
      setScope(normalizeWorkspaceScope());
      setBody(null); setItemCache({}); setExpanded(null);
    };
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
    const params = new URLSearchParams({ workspaceId: scope.workspaceId });
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    setLoading(true); setError("");
    fetch(`/api/amazon/catalog-workbench?${params}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Body;
        if (!response.ok) throw new Error(data.error || "读取在线商品分组失败");
        return data;
      })
      .then((data) => { if (!controller.signal.aborted) setBody(data); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setBody(null);
        setError(reason instanceof Error ? reason.message : "读取在线商品分组失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [headers, ready, nonce, scope.accountId, scope.marketplace, scope.workspaceId]);

  const sites = body?.sites ?? [];
  const sellers = body?.sellers ?? [];
  const coverage = body?.coverage ?? { sites: 0, sellers: 0, skus: 0, asins: 0, catalogRows: 0, truncated: false };

  const siteOptions = sites.map((s) => ({ value: s.marketplaceId, label: s.label || s.code }));
  const shopOptions = sellers
    .filter((s) => !siteFilter || s.marketplaceId === siteFilter)
    .map((s) => ({ value: `${s.sellerAccountId}::${s.marketplaceId}`, label: `${s.sellerName || s.sellerAccountId}（${s.label || s.code}）` }));

  const visibleSellers = sellers.filter((s) =>
    (!siteFilter || s.marketplaceId === siteFilter) &&
    (!shopFilter || `${s.sellerAccountId}::${s.marketplaceId}` === shopFilter)
  );

  const loadItems = useCallback(async (seller: SellerGroup) => {
    const key = `${seller.sellerAccountId}::${seller.marketplaceId}`;
    if (itemCache[key]) return;
    const params = new URLSearchParams({ workspaceId: scope.workspaceId, sellerAccountId: seller.sellerAccountId, marketplaceId: seller.marketplaceId });
    setItemLoading(key);
    try {
      const response = await fetch(`/api/amazon/catalog-workbench/items?${params}`, { headers, cache: "no-store" });
      const data = await response.json() as ItemBody;
      if (!response.ok) throw new Error(data.error || "读取在线商品明细失败");
      setItemCache((prev) => ({ ...prev, [key]: data }));
    } catch (reason) {
      setItemCache((prev) => ({ ...prev, [key]: { error: reason instanceof Error ? reason.message : "读取在线商品明细失败" } }));
    } finally {
      setItemLoading("");
    }
  }, [itemCache, headers, scope.workspaceId]);

  const toggleStore = (seller: SellerGroup) => {
    const key = `${seller.sellerAccountId}::${seller.marketplaceId}`;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    void loadItems(seller);
  };

  const clearFilters = () => { setSiteFilter(""); setShopFilter(""); setExpanded(null); };
  const groups = useMemo(() => {
    const map = new Map<string, SellerGroup[]>();
    for (const s of visibleSellers) {
      const key = accountOf(s.sellerName, s.code);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleSellers]);

  return (
    <section className="sellfox-ui">
      <nav className="sf-tabs" aria-label="亚马逊数据二级导航">
        <a href="/amazon/catalog" aria-current="page">在线商品与库存</a>
        <a href="/amazon/inventory">FBA 库存</a>
        <a href="/amazon/sales-traffic">销售与流量</a>
        <a href="/amazon/replenishment">补货计划</a>
      </nav>
      <div className="sf-filter" style={{ marginTop: "var(--space-3)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border)" }}>
        <select aria-label="站点筛选" value={siteFilter} onChange={(e) => { setSiteFilter(e.target.value); setShopFilter(""); setExpanded(null); }}>
          <option value="">全部站点</option>
          {siteOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="店铺筛选" value={shopFilter} onChange={(e) => { setShopFilter(e.target.value); setExpanded(null); }}>
          <option value="">全部店铺</option>
          {shopOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" className="sf-btn" onClick={clearFilters}>清空筛选</button>
        <button type="button" className="sf-btn" onClick={() => { setBody(null); setItemCache({}); setExpanded(null); setNonce((n) => n + 1); }}>刷新</button>
        <span className="sf-label">覆盖 {coverage.sites} 站点 / {coverage.sellers} 店铺 / {coverage.skus} SKU / {coverage.asins} ASIN</span>
      </div>
      <p className="sf-notice" role="note">{SALES_NOTE}</p>
      {coverage.truncated ? <p className="sf-notice" role="status">在线商品快照超出单次读取上限，已展示前段；请缩小店铺/站点范围查看完整数据。未展示的行不做补 0。</p> : null}
      {body?.error ? <p className="sf-notice" role="alert">{body.error}</p> : null}
      {error ? <p className="sf-notice" role="alert">{error}</p> : null}

      {!loading && groups.length === 0 ? (
        <div className="sf-table-wrap"><table><tbody><tr><td><div className="sf-empty" role="status"><strong>当前工作区暂无已发布的在线商品快照</strong>先在「同步中心」完成在线商品同步与发布；页面不补 0、不臆造。</div></td></tr></tbody></table></div>
      ) : null}

      {!loading && groups.length > 0 ? (
        <div className="sf-group-table">
          {groups.map(([account, rows]) => (
            <section className="sf-group" key={account}>
              <div className="sf-group-head"><strong>账号：{account}</strong><span className="sf-muted">{rows.length} 个站点店铺 · {rows.reduce((n, s) => n + s.skuCount, 0)} 个 SKU</span></div>
              <div className="sf-table-wrap">
                <table>
                  <thead><tr><th>店铺 / 站点</th><th>Freshness</th><th>SKU 数</th><th>ASIN 数</th><th>快照时间</th><th>操作</th></tr></thead>
                  <tbody>
                    {rows.map((s) => {
                      const key = `${s.sellerAccountId}::${s.marketplaceId}`;
                      const isExpanded = expanded === key;
                      return (
                        <FragmentRow key={key}>
                          <tr className={isExpanded ? "sf-row-expanded" : undefined}>
                            <td><span className="sf-stack"><strong>{formatSiteStore(s.marketplaceId, s.sellerName)}</strong></span></td>
                            <td><span className="sf-site-cell" style={{ color: freshnessColor(s.freshness) }}>{SITE_FLAG[s.code] || "🏳️"} {freshnessLabel(s.freshness)}</span></td>
                            <td className="sf-num">{num(s.skuCount)}</td>
                            <td className="sf-num">{num(s.asinCount)}</td>
                            <td className="sf-muted">{s.snapshotCapturedAt ? new Date(s.snapshotCapturedAt).toLocaleString("zh-CN") : "未同步"}</td>
                            <td><button type="button" className="sf-link" aria-expanded={isExpanded} onClick={() => toggleStore(s)}>{isExpanded ? "收起商品" : "查看商品"}</button></td>
                          </tr>
                          {isExpanded ? (
                            <tr className="sf-asin-row"><td colSpan={6}>
                              <div className="sf-asin-panel">
                                <p className="sf-muted">{formatSiteStore(s.marketplaceId, s.sellerName)} · {sellfoxSiteLabel(s.marketplaceId)} · 快照 {s.snapshotCapturedAt ? new Date(s.snapshotCapturedAt).toLocaleString("zh-CN") : "未同步"}</p>
                                {itemLoading === key && !itemCache[key] ? <div className="sf-empty" role="status">读取在线商品明细中…</div> : null}
                                {itemCache[key]?.error ? <p className="sf-notice" role="alert">{itemCache[key].error}</p> : null}
                                {itemCache[key] && !itemCache[key].error ? (() => {
                                  const d = itemCache[key];
                                  const list = d.items ?? [];
                                  return (
                                    <>
                                      <p className="sf-muted">共 {list.length} 个在线商品 SKU（仅本店铺已发布）；{d.salesBasis || SALES_NOTE}</p>
                                      {list.length ? (
                                        <div className="sf-table-wrap"><table>
                                          <thead><tr><th>主图</th><th>Seller SKU</th><th>ASIN</th><th>标题</th><th>刊登状态</th><th>履约方式</th><th>可售</th><th>在途</th><th>预留</th><th>不可售</th><th>销量(订单口径)</th><th>订单行</th></tr></thead>
                                          <tbody>
                                            {list.map((a) => (
                                              <tr key={a.sellerSku}>
                                                <td>{a.imageFileId ? (
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  <img className="sf-thumb" alt="" loading="lazy" referrerPolicy="no-referrer" src={`/api/operations/products/images/${encodeURIComponent(a.imageFileId)}?${new URLSearchParams({ workspaceId: scope.workspaceId, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId })}`} />
                                                ) : <span className="sf-muted">-</span>}</td>
                                                <td><span className="sf-mono">{a.sellerSku}</span></td>
                                                <td><span className="sf-mono">{a.asin || "-"}</span></td>
                                                <td><span className="sf-stack"><span>{a.title || "标题未同步"}</span></span></td>
                                                <td>{statusLabel(a.listingStatus)}</td>
                                                <td>{a.fulfillmentType || "-"}</td>
                                                <td className="sf-num">{num(a.available)}</td>
                                                <td className="sf-num">{num(a.inbound)}</td>
                                                <td className="sf-num">{num(a.reserved)}</td>
                                                <td className="sf-num">{num(a.unfulfillable)}</td>
                                                <td className="sf-num">{num(a.saleQuantity)}</td>
                                                <td className="sf-num">{num(a.orderCount)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table></div>
                                      ) : <div className="sf-empty"><strong>该店铺暂无已发布在线商品</strong>不补 0、不臆造。</div>}
                                      {d.coverage?.truncated ? <p className="sf-notice" role="status">本店铺在线商品行超出单次上限，已展示前段；缩小范围查看完整数据。</p> : null}
                                    </>
                                  );
                                })() : null}
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
      ) : null}

      {loading ? <div className="sf-table-wrap"><table><tbody><tr><td>加载中…</td></tr></tbody></table></div> : null}
    </section>
  );
}

/** 让一个店铺的“行 + 展开商品行”成对渲染，避免被 React 当作两个独立 tr。 */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
