"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { sellfoxSiteLabel, siteCodeOf } from "@/lib/sellfox/marketplace-site";

type SiteGroup = {
  marketplaceId: string; code: string; label: string; sellerCount: number; asinCount: number;
};
type SellerGroup = {
  sellerAccountId: string; sellerName: string; marketplaceId: string; code: string; label: string;
  asinCount: number; skuCount: number;
  available: number; inbound: number; reserved: number; unfulfillable: number;
  snapshotCapturedAt: string | null; freshness: "FRESH" | "STALE" | "NOT_SYNCED";
};
type AsinRow = {
  asin: string; sellerSku: string; title: string; imageFileId: string | null;
  available: number; inbound: number; reserved: number; unfulfillable: number;
  saleQuantity: number; orderCount: number;
};
type AsinBody = {
  sellerAccountId?: string; marketplaceId?: string;
  asins?: AsinRow[]; snapshotCapturedAt?: string | null;
  coverage?: { asins: number; inventoryRows: number; orderRows: number; truncated: boolean };
  salesBasis?: string; error?: string;
};
type Body = {
  sites?: SiteGroup[]; sellers?: SellerGroup[];
  coverage?: { sites: number; sellers: number; asins: number; inventoryRows: number; truncated: boolean };
  error?: string;
};

const SITE_FLAG: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", MX: "🇲🇽", BR: "🇧🇷", UK: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹",
  ES: "🇪🇸", NL: "🇳🇱", SE: "🇸🇪", PL: "🇵🇱", BE: "🇧🇪", IE: "🇮🇪", JP: "🇯🇵", AU: "🇦🇺",
  SG: "🇸🇬", IN: "🇮🇳", AE: "🇦🇪", SA: "🇸🇦", TR: "🇹🇷",
};
const SALES_NOTE = "销量＝订单商品表按 ASIN 汇总的累计件数（按订单口径），不是按日销量快照，也不等于店铺级销售流量；下单时间与库存快照时间可能不同步，仅作参考。";

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

export function AmazonInventoryWorkbench() {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(() => normalizeWorkspaceScope());
  const [siteFilter, setSiteFilter] = useState("");
  const [shopFilter, setShopFilter] = useState("");
  const [body, setBody] = useState<Body | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [asinCache, setAsinCache] = useState<Record<string, AsinBody>>({});
  const [asinLoading, setAsinLoading] = useState("");

  useEffect(() => {
    setScope(normalizeWorkspaceScope());
    setReady(true);
    const changed = () => {
      setScope(normalizeWorkspaceScope());
      setBody(null); setAsinCache({}); setExpanded(null);
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
    fetch(`/api/amazon/inventory-workbench?${params}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Body;
        if (!response.ok) throw new Error(data.error || "读取 FBA 库存分组失败");
        return data;
      })
      .then((data) => { if (!controller.signal.aborted) setBody(data); })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setBody(null);
        setError(reason instanceof Error ? reason.message : "读取 FBA 库存分组失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [headers, ready, nonce, scope.accountId, scope.marketplace, scope.workspaceId]);

  const sites = body?.sites ?? [];
  const sellers = body?.sellers ?? [];
  const coverage = body?.coverage ?? { sites: 0, sellers: 0, asins: 0, inventoryRows: 0, truncated: false };

  const siteOptions = sites.map((s) => ({ value: s.marketplaceId, label: s.label || s.code }));
  const shopOptions = sellers
    .filter((s) => !siteFilter || s.marketplaceId === siteFilter)
    .map((s) => ({ value: `${s.sellerAccountId}::${s.marketplaceId}`, label: `${s.sellerName || s.sellerAccountId}（${s.label || s.code}）` }));

  const visibleSellers = sellers.filter((s) =>
    (!siteFilter || s.marketplaceId === siteFilter) &&
    (!shopFilter || `${s.sellerAccountId}::${s.marketplaceId}` === shopFilter)
  );

  const loadAsins = useCallback(async (seller: SellerGroup) => {
    const key = `${seller.sellerAccountId}::${seller.marketplaceId}`;
    if (asinCache[key]) return;
    const params = new URLSearchParams({ workspaceId: scope.workspaceId, sellerAccountId: seller.sellerAccountId, marketplaceId: seller.marketplaceId });
    setAsinLoading(key);
    try {
      const response = await fetch(`/api/amazon/inventory-workbench/asins?${params}`, { headers, cache: "no-store" });
      const data = await response.json() as AsinBody;
      if (!response.ok) throw new Error(data.error || "读取 ASIN 明细失败");
      setAsinCache((prev) => ({ ...prev, [key]: data }));
    } catch (reason) {
      setAsinCache((prev) => ({ ...prev, [key]: { error: reason instanceof Error ? reason.message : "读取 ASIN 明细失败" } }));
    } finally {
      setAsinLoading("");
    }
  }, [asinCache, headers, scope.workspaceId]);

  const toggleStore = (seller: SellerGroup) => {
    const key = `${seller.sellerAccountId}::${seller.marketplaceId}`;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    void loadAsins(seller);
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
        <a href="/amazon/catalog">在线商品与库存</a>
        <a href="/amazon/inventory" aria-current="page">FBA 库存</a>
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
        <button type="button" className="sf-btn" onClick={() => { setBody(null); setAsinCache({}); setExpanded(null); setNonce((n) => n + 1); }}>刷新</button>
        <span className="sf-label">覆盖 {coverage.sites} 站点 / {coverage.sellers} 店铺 / {coverage.asins} ASIN</span>
      </div>
      <p className="sf-notice" role="note">{SALES_NOTE}</p>
      {coverage.truncated ? <p className="sf-notice" role="status">库存快照超出单次读取上限，已按可售优先展示前段；请缩小店铺/站点范围查看完整数据。未展示的行不做补 0。</p> : null}
      {body?.error ? <p className="sf-notice" role="alert">{body.error}</p> : null}
      {error ? <p className="sf-notice" role="alert">{error}</p> : null}

      {!loading && groups.length === 0 ? (
        <div className="sf-table-wrap"><table><tbody><tr><td><div className="sf-empty" role="status"><strong>当前工作区暂无已发布的 FBA 库存快照</strong>先在「同步中心」完成库存同步与发布；页面不补 0、不臆造。</div></td></tr></tbody></table></div>
      ) : null}

      {!loading && groups.length > 0 ? (
        <div className="sf-group-table">
          {groups.map(([account, rows]) => (
            <section className="sf-group" key={account}>
              <div className="sf-group-head"><strong>账号：{account}</strong><span className="sf-muted">{rows.length} 个站点店铺 · {rows.reduce((n, s) => n + s.asinCount, 0)} 个 ASIN</span></div>
              <div className="sf-table-wrap">
                <table>
                  <thead><tr><th>店铺 / 站点</th><th>Freshness</th><th>ASIN 数</th><th>SKU 数</th><th>可售</th><th>在途</th><th>预留</th><th>不可售</th><th>快照时间</th><th>操作</th></tr></thead>
                  <tbody>
                    {rows.map((s) => {
                      const key = `${s.sellerAccountId}::${s.marketplaceId}`;
                      const isExpanded = expanded === key;
                      return (
                        <FragmentRow key={key}>
                          <tr className={isExpanded ? "sf-row-expanded" : undefined}>
                            <td><span className="sf-stack"><strong>{s.sellerName || s.sellerAccountId}</strong><small className="sf-muted">ID {s.sellerAccountId}</small></span></td>
                            <td><span className="sf-site-cell" style={{ color: freshnessColor(s.freshness) }}>{SITE_FLAG[s.code] || "🏳️"} {freshnessLabel(s.freshness)}</span></td>
                            <td className="sf-num">{num(s.asinCount)}</td>
                            <td className="sf-num">{num(s.skuCount)}</td>
                            <td className="sf-num">{num(s.available)}</td>
                            <td className="sf-num">{num(s.inbound)}</td>
                            <td className="sf-num">{num(s.reserved)}</td>
                            <td className="sf-num">{num(s.unfulfillable)}</td>
                            <td className="sf-muted">{s.snapshotCapturedAt ? new Date(s.snapshotCapturedAt).toLocaleString("zh-CN") : "未同步"}</td>
                            <td><button type="button" className="sf-link" aria-expanded={isExpanded} onClick={() => toggleStore(s)}>{isExpanded ? "收起 ASIN" : "查看 ASIN"}</button></td>
                          </tr>
                          {isExpanded ? (
                            <tr className="sf-asin-row"><td colSpan={10}>
                              <div className="sf-asin-panel">
                                <p className="sf-muted">{s.sellerName || s.sellerAccountId} · {sellfoxSiteLabel(s.marketplaceId)}（{siteCodeOf(s.marketplaceId)}） · 快照 {s.snapshotCapturedAt ? new Date(s.snapshotCapturedAt).toLocaleString("zh-CN") : "未同步"}</p>
                                {asinLoading === key && !asinCache[key] ? <div className="sf-empty" role="status">读取 ASIN 明细中…</div> : null}
                                {asinCache[key]?.error ? <p className="sf-notice" role="alert">{asinCache[key].error}</p> : null}
                                {asinCache[key] && !asinCache[key].error ? (() => {
                                  const d = asinCache[key];
                                  const list = d.asins ?? [];
                                  return (
                                    <>
                                      <p className="sf-muted">共 {list.length} 个 ASIN（仅本店铺已发布库存）；{d.salesBasis || SALES_NOTE}</p>
                                      {list.length ? (
                                        <div className="sf-table-wrap"><table>
                                          <thead><tr><th>主图</th><th>ASIN</th><th>标题</th><th>Seller SKU</th><th>可售</th><th>在途</th><th>预留</th><th>不可售</th><th>销量(订单口径)</th><th>订单行</th></tr></thead>
                                          <tbody>
                                            {list.map((a) => (
                                              <tr key={a.asin}>
                                                <td>{a.imageFileId ? (
                                                  // eslint-disable-next-line @next/next/no-img-element
                                                  <img className="sf-thumb" alt="" loading="lazy" referrerPolicy="no-referrer" src={`/api/operations/products/images/${encodeURIComponent(a.imageFileId)}?${new URLSearchParams({ workspaceId: scope.workspaceId, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId })}`} />
                                                ) : <span className="sf-muted">-</span>}</td>
                                                <td><span className="sf-mono">{a.asin}</span></td>
                                                <td><span className="sf-stack"><span>{a.title || "标题未同步"}</span></span></td>
                                                <td><span className="sf-muted">{a.sellerSku || "-"}</span></td>
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
                                      ) : <div className="sf-empty"><strong>该店铺暂无已发布库存 ASIN</strong>不补 0、不臆造。</div>}
                                      {d.coverage?.truncated ? <p className="sf-notice" role="status">本店铺库存行超出单次上限，已按可售优先展示前段；缩小范围查看完整数据。</p> : null}
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

/** 让一个店铺的“行 + 展开 ASIN 行”成对渲染，避免被 React 当作两个独立 tr。 */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
