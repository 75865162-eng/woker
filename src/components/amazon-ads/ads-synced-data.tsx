"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

type EntityRecord = {
  id: string;
  profileId: string;
  entityType: string;
  externalId: string;
  parentExternalId: string | null;
  state: string | null;
  payload: unknown;
  sourceUpdatedAt: string | null;
  sourceTaskId: string;
  syncedAt: string;
};

type ReportFact = {
  id: string;
  profileId: string;
  reportType: string;
  adProduct: string;
  reportDate: string;
  campaignId: string | null;
  adGroupId: string | null;
  targetingId: string | null;
  advertisedAsin: string | null;
  searchTerm: string | null;
  placement: string | null;
  impressions: string;
  clicks: string;
  spend: string;
  orders: string;
  sales: string;
  units: string;
  currencyCode?: string | null;
  attributionWindow: string | null;
  apiVersion: string;
  rawDimensions: unknown;
  sourceTaskId: string;
  syncedAt: string;
};

type DataResponse<T> = { rows: T[]; page: number; pageSize: number; from?: string; to?: string; error?: string };
type DataKind = "entities" | "reports";
const pageSize = 100;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdsSyncedData({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<DataKind>("entities");
  const [entityType, setEntityType] = useState("");
  const [reportType, setReportType] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DataResponse<EntityRecord | ReportFact> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
    if (kind === "entities" && entityType.trim()) params.set("entityType", entityType.trim());
    if (kind === "reports") {
      params.set("from", from);
      params.set("to", to);
      if (reportType.trim()) params.set("reportType", reportType.trim());
    }
    setLoading(true);
    setError("");
    fetch(`/api/integrations/amazon/ads/data?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as DataResponse<EntityRecord | ReportFact>;
        if (!response.ok) throw new Error(body.error || `读取失败（${response.status}）`);
        if (!Array.isArray(body.rows)) throw new Error("Ads 数据接口返回格式无效。");
        setData(body);
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "无法读取已同步数据。");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, entityType, reportType, from, to, page, reloadKey]);

  function changeKind(next: DataKind) {
    setKind(next);
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const isLastPage = rows.length < pageSize;

  return <div className="ads-synced-view">
    <header className="ads-synced-heading">
      <div>
        <button type="button" className="ads-link ads-synced-back" onClick={onBack}><ArrowLeft size={15} />返回演示工作台</button>
        <h1>已同步 Ads 数据</h1>
        <p>读取当前工作区 PostgreSQL 中已保存的 Amazon Ads 事实；此页面不会发起 Amazon 请求。</p>
      </div>
      <button type="button" className="ads-synced-refresh" onClick={() => setReloadKey(value => value + 1)} disabled={loading} title="重新读取已保存数据" aria-label="重新读取已保存数据"><RefreshCw size={15} /></button>
    </header>

    <div className="ads-synced-notice" role="status">
      <strong>真实数据视图</strong>
      <span>只展示服务端已保存记录。它与演示 Fixture 隔离；当前页不会用演示数据补空。表中的 Profile 标识是数据库内部关联键，不是 Amazon Profile ID。现有接口尚未提供总量、统一币种/时区和完整 freshness 信封。</span>
    </div>

    <div className="ads-synced-toolbar">
      <div className="ads-synced-tabs" role="tablist" aria-label="已同步数据类型">
        <button type="button" role="tab" aria-selected={kind === "entities"} onClick={() => changeKind("entities")}>账户结构</button>
        <button type="button" role="tab" aria-selected={kind === "reports"} onClick={() => changeKind("reports")}>日报事实</button>
      </div>
      {kind === "entities" ? <label>实体类型<input aria-label="实体类型筛选" value={entityType} placeholder="例如 SP:campaign" onChange={event => { setEntityType(event.target.value); setPage(1); }} /></label> : <><label>报告类型<input aria-label="报告类型筛选" value={reportType} placeholder="例如 campaigns" onChange={event => { setReportType(event.target.value); setPage(1); }} /></label><div className="ads-synced-dates"><label>开始日期<input aria-label="报表开始日期" type="date" value={from} max={to} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label><label>结束日期<input aria-label="报表结束日期" type="date" value={to} min={from} onChange={event => { setTo(event.target.value); setPage(1); }} /></label></div></>}
      <span className="ads-synced-page">第 {page} 页 · 每页最多 {pageSize} 条</span>
    </div>

    {error && <p className="ads-synced-error" role="alert">{error}</p>}
    {loading && <div className="ads-synced-empty" role="status">正在读取数据库记录…</div>}
    {!loading && !error && rows.length === 0 && <div className="ads-synced-empty"><strong>{kind === "entities" ? "没有已保存的广告结构" : "此日期范围内没有已保存的日报"}</strong><span>同步读取 adapter 尚未就绪时，不会产生真实 Ads 数据；已保存数据为空不代表 Amazon 账户中没有数据。</span></div>}

    {!loading && !error && rows.length > 0 && (kind === "entities" ? <div className="ads-table-scroll ads-synced-table"><table className="ads-simple-table"><thead><tr><th>类型</th><th title="不是 Amazon Ads Profile ID">内部 Profile ID</th><th>Amazon ID</th><th>上级 ID</th><th>状态</th><th>来源更新时间</th><th>来源任务</th><th>本地同步时间</th><th>原始字段</th></tr></thead><tbody>{(rows as EntityRecord[]).map(row => <tr key={row.id}><td>{row.entityType}</td><td>{row.profileId}</td><td>{row.externalId}</td><td>{row.parentExternalId ?? "—"}</td><td>{row.state ?? "—"}</td><td>{formatDate(row.sourceUpdatedAt)}</td><td>{row.sourceTaskId}</td><td>{formatDate(row.syncedAt)}</td><td><details><summary>查看字段</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : <div className="ads-table-scroll ads-synced-table"><table className="ads-simple-table"><thead><tr><th>报表 / 广告产品</th><th title="不是 Amazon Ads Profile ID">内部 Profile ID</th><th>报告日</th><th>Campaign / Ad Group</th><th>搜索词 / ASIN / 广告位</th><th>曝光</th><th>点击</th><th>花费</th><th>订单</th><th>销售额</th><th>归因 / API</th><th>来源任务</th><th>同步时间</th><th>原始维度</th></tr></thead><tbody>{(rows as ReportFact[]).map(row => <tr key={row.id}><td>{row.reportType} / {row.adProduct}</td><td>{row.profileId}</td><td>{row.reportDate}</td><td>{row.campaignId ?? "—"}<br />{row.adGroupId ?? "—"}</td><td>{row.searchTerm ?? row.advertisedAsin ?? row.placement ?? "—"}</td><td>{row.impressions}</td><td>{row.clicks}</td><td>{row.spend}{row.currencyCode ? ` ${row.currencyCode}` : ""}</td><td>{row.orders}</td><td>{row.sales}{row.currencyCode ? ` ${row.currencyCode}` : ""}</td><td>{row.attributionWindow ?? "—"}<br />{row.apiVersion}</td><td>{row.sourceTaskId}</td><td>{formatDate(row.syncedAt)}</td><td><details><summary>查看维度</summary><pre>{JSON.stringify(row.rawDimensions, null, 2)}</pre></details></td></tr>)}</tbody></table></div>)}

    <footer className="ads-synced-pagination"><span>当前页 {rows.length} 条；总量暂未由现有接口提供。</span><div><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1 || loading}>上一页</button><button type="button" onClick={() => setPage(value => value + 1)} disabled={isLastPage || loading}>下一页</button></div></footer>
  </div>;
}
