"use client";

import { useEffect, useState } from "react";
import { Database, Menu, RefreshCw } from "lucide-react";
import { AdsAccounts } from "./ads-accounts";
import { reportMetricFields, type ReportCompleteness } from "@/lib/amazon-ads/report-completeness";

type Profile = { profileRecordId: string; amazonProfileId: string; countryCode: string; marketplaceId: string | null; currencyCode: string | null; timezone: string | null; sellerAccountId: string | null; sellerName: string | null };
type Entity = { id: string; profileId: string; externalId: string; entityType: string; keywordText?: string | null; matchType?: string | null; expressionType?: string | null; targetingExpression?: unknown; campaignId?: string | null; adGroupId?: string | null; parentExternalId?: string | null; name: string | null; state: string | null; budgetAmount: string | null; budgetType: string | null; bid: string | null; targetingType: string | null; startDate: string | null; endDate: string | null; payload: unknown; syncedAt: string; sourceTaskId: string; sourceTask?: { status: string; stage: string } };
type EntityPage = { rows: Entity[]; total: number; source: string; syncedAt: string | null; warnings: string[]; freshness: { status: string }; scope: { profiles: Profile[] }; pagination: { hasMore: boolean } };
type DailyFact = { id: string; profileId: string; reportType: string; adProduct: string; reportDate: string; campaignId: string | null; impressions: string | null; clicks: string | null; spend: string | null; orders: string | null; sales: string | null; units: string | null; currencyCode: string | null; attributionWindow: string | null; apiVersion: string; sourceTaskId: string; versionId: string; publishedAt: string; syncedAt: string; ctr: string | null; cpc: string | null; acos: string | null; roas: string | null };
type MetricTotal = Pick<DailyFact, "reportType" | "adProduct" | "currencyCode" | "attributionWindow" | "apiVersion" | "impressions" | "clicks" | "spend" | "orders" | "sales" | "units" | "ctr" | "cpc" | "acos" | "roas"> & { completeness?: ReportCompleteness };
type ReportProfileFreshness = { profileRecordId: string; status: string; reportType: string | null; coveredFrom: string | null; coveredTo: string | null; lastSuccessAt: string | null; lastAttemptAt: string | null; lastTaskId: string | null; warningCodes: string[] };
type ReportPage = { rows: DailyFact[]; total: number; source: string; syncedAt: string | null; warnings: string[]; freshness: { status: string; profiles?: ReportProfileFreshness[] }; pagination: { hasMore: boolean }; dateRange: { from: string; to: string }; totals: MetricTotal[] };
type Task = { id: string; status: string; stage: string; processedCount: number; errorCode: string | null };
const base = "/amazon-ads/campaigns";
const groupBase = "/amazon-ads/ad-groups";
const pageSize = 25;
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
function entityPage(value: unknown): EntityPage {
  const body = value as EntityPage | null;
  if (!body || body.source !== "amazon_ads_postgres" || !Array.isArray(body.rows) || body.rows.length > 100
    || body.rows.some(row => !row || [row.id, row.profileId, row.externalId, row.entityType].some(field => typeof field !== "string" || !field))
    || !Number.isSafeInteger(body.total) || body.total < 0 || !Array.isArray(body.scope?.profiles)
    || body.scope.profiles.some(profile => !profile || typeof profile.profileRecordId !== "string" || typeof profile.amazonProfileId !== "string")
    || typeof body.pagination?.hasMore !== "boolean" || !Array.isArray(body.warnings) || body.warnings.some(warning => typeof warning !== "string")) throw new Error("本地广告数据响应格式无效。");
  return body;
}
function taskPage(value: unknown): Task {
  const body = value as { taskDetail?: Task };
  if (!body?.taskDetail || typeof body.taskDetail.id !== "string" || typeof body.taskDetail.status !== "string") throw new Error("任务响应格式无效。");
  return body.taskDetail;
}
function validCompleteness(value: ReportCompleteness | undefined) {
  if (value === undefined) return true;
  if (!value || value.basis !== "CURRENT_OBSERVED_FACTS" || typeof value.observedFactCount !== "string" || !/^\d{1,30}$/.test(value.observedFactCount)) return false;
  const observed = BigInt(value.observedFactCount);
  return reportMetricFields.every(field => {
    const metric = value.metrics?.[field];
    if (!metric || [metric.providedFactCount, metric.missingFactCount].some(count => typeof count !== "string" || !/^\d{1,30}$/.test(count))) return false;
    const count = BigInt(metric.providedFactCount), missing = BigInt(metric.missingFactCount);
    const expected = observed === BigInt(0) ? "NO_FACTS" : count === observed ? "COMPLETE" : count === BigInt(0) ? "MISSING" : "PARTIAL";
    return count + missing === observed && metric.status === expected;
  });
}
function reportPage(value: unknown): ReportPage {
  const body = value as ReportPage | null;
  const validMetrics = (row: MetricTotal) => row && ["impressions", "clicks", "spend", "orders", "sales", "units", "ctr", "cpc", "acos", "roas"].every(key => {
    const value = row[key as keyof MetricTotal];
    return value === null || typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value);
  });
  if (!body || body.source !== "AmazonAdsReportFact" || !Array.isArray(body.rows) || body.rows.length > 100
    || body.rows.some(row => !row || [row.id, row.profileId, row.reportType, row.adProduct, row.reportDate, row.apiVersion, row.versionId].some(field => typeof field !== "string" || !field))
    || body.rows.some(row => !validMetrics(row))
    || !Array.isArray(body.totals) || body.totals.some(row => !validMetrics(row) || !validCompleteness(row.completeness) || [row.reportType, row.adProduct, row.apiVersion].some(value => typeof value !== "string"))
    || !Number.isSafeInteger(body.total) || body.total < 0 || typeof body.pagination?.hasMore !== "boolean"
    || !Array.isArray(body.warnings) || body.warnings.some(value => typeof value !== "string") || typeof body.freshness?.status !== "string"
    || body.freshness.profiles !== undefined && (!Array.isArray(body.freshness.profiles) || body.freshness.profiles.some(profile => !profile || typeof profile.profileRecordId !== "string" || typeof profile.status !== "string" || (profile.reportType !== null && typeof profile.reportType !== "string") || [profile.coveredFrom, profile.coveredTo].some(day => day !== null && (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day))) || [profile.lastSuccessAt, profile.lastAttemptAt, profile.lastTaskId].some(field => field !== null && typeof field !== "string") || !Array.isArray(profile.warningCodes) || profile.warningCodes.some(code => typeof code !== "string")))
    || !body.dateRange || typeof body.dateRange.from !== "string" || typeof body.dateRange.to !== "string") throw new Error("已发布日报响应格式无效。");
  return body;
}

/** A changed request key hides old rows immediately, before effect cleanup runs. */
function useLocalRead<T>(url: string | null, parse: (body: unknown) => T) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const key = `${url}\n${revision}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
      setResult({ key, error: "本地广告数据读取超时，请重试。" });
    }, 15000);
    void fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录。" : response.status === 403 ? "没有权限查看此广告范围（403）。" : response.status === 404 ? "记录不存在或不可访问。" : `无法读取本地广告数据（${response.status}）。`);
      const body: unknown = await response.json().catch(() => { throw new Error("本地数据响应不是有效 JSON。"); });
      const data = parse(body);
      if (!controller.signal.aborted) setResult({ key, data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "无法读取本地广告数据。" });
    }).finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [url, key, parse]);
  const current = result?.key === key ? result : null;
  return { data: current?.data, error: current?.error, loading: !!url && !current, refresh: () => setRevision(value => value + 1) };
}
function url(params: Record<string, string>) {
  return `/api/integrations/amazon/ads/data?${new URLSearchParams({ kind: "entities", pageSize: String(pageSize), sortBy: "name", sortDirection: "asc", ...params })}`;
}
function ReadState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty: boolean; retry: () => void }) {
  return loading ? <p role="status" className="ads-synced-empty">正在读取本地广告数据…</p> : error ? <div role="alert" className="ads-synced-error">{error} <button type="button" onClick={retry}>重试</button></div> : empty ? <div className="ads-synced-empty"><strong>没有已保存的记录</strong><p>请检查筛选与同步状态；本地空结果不代表 Amazon 中没有广告。</p></div> : null;
}
function Metadata({ data }: { data?: EntityPage }) {
  return <div className="ads-synced-notice"><span>当前结构快照 · 表现指标尚未接入，不显示占位数值。日期筛选仅适用于日报，不适用于当前结构。</span>{data && <><span>来源：{data.source} · 结构域状态：{data.freshness?.status ?? "UNKNOWN"} · 最近结构成功：{date(data.syncedAt)}</span>{data.warnings.map(warning => <span key={warning}>{warning}</span>)}</>}</div>;
}
function Pagination({ page, data, loading, change }: { page: number; data?: { total: number; pagination: { hasMore: boolean } }; loading: boolean; change: (page: number) => void }) {
  return <footer className="ads-synced-pagination"><span>第 {page} 页 · 每页 {pageSize} 条 · 筛选总量 {data?.total ?? "—"}</span><div><button type="button" disabled={loading || page === 1} onClick={() => change(page - 1)}>上一页</button><button type="button" disabled={loading || !data?.pagination.hasMore} onClick={() => change(page + 1)}>下一页</button></div></footer>;
}
function TaskEvidence({ id, profileId }: { id: string; profileId: string }) {
  const [open, setOpen] = useState(false);
  const read = useLocalRead(open ? `/api/integrations/amazon/ads/sync?${new URLSearchParams({ taskId: id, profileId })}` : null, taskPage);
  return <div><button type="button" className="ads-link" aria-expanded={open} onClick={() => setOpen(value => !value)}>来源任务 {id}</button>{open && <section aria-label="来源任务详情"><ReadState {...read} empty={false} retry={read.refresh} />{read.data && <p>{read.data.id} · {read.data.status} / {read.data.stage} · 处理 {read.data.processedCount} · {read.data.errorCode ?? "无任务错误"}</p>}<p>任务详情沿用同步中心权限；查看广告结构不自动获得任务管理权限。</p></section>}</div>;
}
function RawEntity({ row }: { row: Entity }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>原始维度与来源</summary>{open && <><dl><dt>Amazon ID</dt><dd>{row.externalId}</dd><dt>本地同步</dt><dd>{date(row.syncedAt)}</dd><dt>来源状态</dt><dd>{row.sourceTask ? `${row.sourceTask.status} / ${row.sourceTask.stage}` : "未知"}</dd></dl><TaskEvidence id={row.sourceTaskId} profileId={row.profileId} /><pre>{JSON.stringify(row.payload, null, 2)}</pre></>}</details>;
}

function CampaignList({ navigate, groups = false, domain }: { navigate: (path: string) => void; groups?: boolean; domain?: typeof groupDomains[number] }) {
  const title = domain?.label ?? (groups ? "广告组" : "广告活动");
  const label = domain?.label ?? (groups ? "Ad Group" : "Campaign");
  const listBase = groups ? groupBase : base;
  const [campaignText, setCampaignText] = useState("");
  const [groupText, setGroupText] = useState("");
  const [filters, setFilters] = useState({ profile: "", seller: "", market: "", state: "", search: "", campaignId: "", adGroupId: "", sortBy: "name", sortDirection: "asc" });
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const params: Record<string, string> = { entityType: domain?.type ?? (groups ? "SP:ad-group" : "SP:campaign"), page: String(page), sortBy: filters.sortBy, sortDirection: filters.sortDirection };
  for (const [key, value] of Object.entries({ internalProfileId: filters.profile, sellerAccountId: filters.seller, marketplaceId: filters.market, state: filters.state, search: filters.search, campaignId: filters.campaignId, adGroupId: filters.adGroupId })) if (value) params[key] = value;
  const read = useLocalRead(url(params), entityPage);
  useEffect(() => {
    if (read.error) { setProfiles([]); return; }
    if (read.data && !filters.profile && !filters.seller && !filters.market) setProfiles(read.data.scope.profiles);
  }, [read.data, read.error, filters.profile, filters.seller, filters.market]);
  function change(patch: Partial<typeof filters>) { setPage(1); setFilters(value => ({ ...value, ...patch })); }
  const options = profiles.filter(profile => (!filters.seller || profile.sellerAccountId === filters.seller) && (!filters.market || profile.marketplaceId === filters.market));
  const profileById = new Map(read.data?.scope.profiles.map(profile => [profile.profileRecordId, profile]));
  return <>
    <header className="ads-synced-heading"><div><h1>{title}</h1><p>商品推广 SP · 服务端本地数据 · 只读</p></div><button type="button" aria-label={`刷新${title}`} disabled={read.loading} onClick={read.refresh}><RefreshCw size={16} /></button></header>
    <form className="ads-synced-toolbar" onSubmit={event => { event.preventDefault(); change({ search: text.trim(), campaignId: campaignText.trim(), adGroupId: groupText.trim() }); }}>
      <label>店铺<select aria-label={`${label} 店铺`} value={filters.seller} onChange={event => change({ seller: event.target.value, market: "", profile: "" })}><option value="">全部授权店铺</option>{Array.from(new Map(profiles.filter(profile => profile.sellerAccountId).map(profile => [profile.sellerAccountId!, profile.sellerName ?? profile.sellerAccountId!])).entries()).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>站点<select aria-label={`${label} 站点`} value={filters.market} onChange={event => change({ market: event.target.value, profile: "" })}><option value="">全部授权站点</option>{Array.from(new Map(profiles.filter(profile => profile.marketplaceId && (!filters.seller || profile.sellerAccountId === filters.seller)).map(profile => [profile.marketplaceId!, profile.countryCode])).entries()).map(([id, label]) => <option key={id} value={id}>{label} · {id}</option>)}</select></label>
      <label>Profile<select aria-label={`${label} Profile`} value={filters.profile} onChange={event => change({ profile: event.target.value })}><option value="">全部授权 Profile</option>{options.map(profile => <option key={profile.profileRecordId} value={profile.profileRecordId}>{profile.amazonProfileId} · {profile.countryCode}</option>)}</select></label>
      <label>状态<select aria-label={`${label} 状态`} value={filters.state} onChange={event => change({ state: event.target.value })}><option value="">全部状态</option>{["ENABLED", "PAUSED", "ARCHIVED", "OTHER", "USER_DELETED"].map(state => <option key={state}>{state}</option>)}</select></label>
      {(groups || domain) && <label>Campaign ID<input aria-label={`${label} Campaign ID`} maxLength={200} value={campaignText} onChange={event => setCampaignText(event.target.value)} placeholder="所属活动 Amazon ID" /></label>}
      {domain && !domain.type.includes("campaign-negative") && <label>Ad Group ID<input aria-label={`${label} Ad Group ID`} maxLength={200} value={groupText} onChange={event => setGroupText(event.target.value)} placeholder="所属广告组 Amazon ID" /></label>}
      <label>搜索<input aria-label={`${label} 搜索`} maxLength={120} placeholder={domain && !domain.target ? "关键词或 Amazon ID" : "名称或 Amazon ID"} value={text} onChange={event => setText(event.target.value)} /></label><button type="submit">搜索</button>
      <label>排序<select aria-label={`${label} 排序`} value={filters.sortBy} onChange={event => change({ sortBy: event.target.value })}>{[["name", "名称"], ["externalId", "Amazon ID"], ["state", "状态"], ...(!domain?.negative ? [[groups || domain ? "bid" : "budgetAmount", groups ? "默认竞价" : domain ? "竞价" : "预算"]] : []), ["syncedAt", "同步时间"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>方向<select aria-label={`${label} 排序方向`} value={filters.sortDirection} onChange={event => change({ sortDirection: event.target.value })}><option value="asc">升序</option><option value="desc">降序</option></select></label>
    </form>
    <Metadata data={read.data} /><ReadState {...read} empty={read.data?.rows.length === 0} retry={read.refresh} />
    {domain && read.data && !!read.data.rows.length && <div className="ads-table-scroll"><table className="ads-simple-table" aria-label={`本地${title}`}><thead><tr>{[domain.target ? "投放表达式 / Amazon ID" : "关键词 / Amazon ID", "Profile / 站点", domain.target ? "表达式类型" : "匹配类型", "状态", ...(!domain.negative ? ["竞价 / 币种"] : []), "所属对象", "同步时间", "来源"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{read.data.rows.map(row => {
      const profile = profileById.get(row.profileId);
      return <tr key={row.id}><td>{domain.target ? row.targetingExpression == null ? "表达式未知" : <pre>{JSON.stringify(row.targetingExpression, null, 2)}</pre> : row.keywordText ?? row.name ?? "—"}<br />{row.externalId}</td><td>{profile?.amazonProfileId ?? row.profileId}<br />{profile?.countryCode ?? "未知站点"}</td><td>{(domain.target ? row.expressionType : row.matchType) ?? "—"}</td><td>{row.state ?? "未知"}</td>{!domain.negative && <td>{row.bid ?? "—"} {profile?.currencyCode ?? "未知币种"}</td>}<td>{row.campaignId && <button type="button" className="ads-link" onClick={() => navigate(`${base}/${encodeURIComponent(row.profileId)}/${encodeURIComponent(row.campaignId!)}`)}>Campaign {row.campaignId}</button>}{!domain.type.includes("campaign-negative") && row.adGroupId && <><br /><button type="button" className="ads-link" onClick={() => navigate(`${groupBase}/${encodeURIComponent(row.profileId)}/${encodeURIComponent(row.adGroupId!)}`)}>Ad Group {row.adGroupId}</button></>}</td><td>{date(row.syncedAt)}</td><td><RawEntity row={row} /></td></tr>;
    })}</tbody></table></div>}
    {!domain && read.data && !!read.data.rows.length && <div className="ads-table-scroll"><table className="ads-simple-table" aria-label={`本地${title}`}><thead><tr>{[title, "Profile / 站点", "状态", groups ? "默认竞价 / 币种" : "预算 / 币种", groups ? "所属 Campaign ID" : "投放类型", "同步时间", "来源"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{read.data.rows.map(row => {
      const profile = profileById.get(row.profileId);
      return <tr key={row.id}><td><button type="button" className="ads-link" onClick={() => navigate(`${listBase}/${encodeURIComponent(row.profileId)}/${encodeURIComponent(row.externalId)}`)}>{row.name ?? row.externalId}</button><br />{row.externalId}</td><td>{profile?.amazonProfileId ?? row.profileId}<br />{profile?.countryCode ?? "未知站点"}</td><td>{row.state ?? "未知"}</td><td>{(groups ? row.bid : row.budgetAmount) ?? "—"} {profile?.currencyCode ?? "未知币种"}{!groups && <><br />{row.budgetType ?? "未知预算类型"}</>}</td><td>{groups ? row.campaignId ?? row.parentExternalId ?? "—" : row.targetingType ?? "—"}</td><td>{date(row.syncedAt)}</td><td><RawEntity row={row} /></td></tr>;
    })}</tbody></table></div>}
    <Pagination page={page} data={read.data} loading={read.loading} change={setPage} />
  </>;
}

const groupDomains = [
  { type: "SP:keyword", label: "关键词", negative: false, target: false },
  { type: "SP:target", label: "商品投放", negative: false, target: true },
  { type: "SP:negative-keyword", label: "广告组否定关键词", negative: true, target: false },
  { type: "SP:negative-target", label: "广告组否定商品投放", negative: true, target: true },
  { type: "", label: "广告商品", negative: false, target: false },
];
const campaignDomains = [
  { type: "SP:campaign-negative-keyword", label: "活动否定关键词", negative: true, target: false },
  { type: "SP:campaign-negative-target", label: "活动否定商品投放", negative: true, target: true },
];
function StructureList({ route, navigate }: { route: string; navigate: (path: string) => void }) {
  const negatives = [...groupDomains.filter(domain => domain.negative), ...campaignDomains];
  const [selected, setSelected] = useState(negatives[0].type);
  const domain = route === "keywords" ? groupDomains[0] : route === "targets" ? groupDomains[1] : negatives.find(domain => domain.type === selected)!;
  return <>{route === "negatives" && <nav className="ads-synced-toolbar" aria-label="否定投放层级与类型">{negatives.map(item => <button type="button" key={item.type} aria-pressed={selected === item.type} onClick={() => setSelected(item.type)}>{item.label}</button>)}</nav>}<CampaignList key={domain.type} domain={domain} navigate={navigate} /></>;
}
function ChildEntities({ profileId, campaignId, groupId, currency }: { profileId: string; campaignId?: string; groupId?: string; currency?: string | null }) {
  const domains = groupId ? groupDomains : campaignDomains;
  const [selected, setSelected] = useState(domains[0].type);
  const domain = domains.find(value => value.type === selected)!;
  return <section aria-label={groupId ? "广告组投放结构" : "活动否定结构"}>
    <h2>{groupId ? "广告组投放结构" : "活动否定结构"}</h2>
    <nav className="ads-synced-tabs" aria-label="下属数据域">{domains.map(value => <button type="button" key={value.label} aria-pressed={selected === value.type} onClick={() => setSelected(value.type)}>{value.label}</button>)}</nav>
    {domain.type ? <ChildEntityTable key={domain.type} domain={domain} profileId={profileId} campaignId={campaignId} groupId={groupId} currency={currency} /> : <p role="status">广告商品尚未接入：官方 reader 与字段合同待核验，当前不发起该域查询或同步，不展示示例商品。</p>}
  </section>;
}
const isoDate = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
function CampaignReports({ profileId, campaignId }: { profileId: string; campaignId: string }) {
  const [open, setOpen] = useState(false);
  const today = isoDate(new Date());
  const initialFrom = isoDate(new Date(Date.now() - 29 * 86400_000));
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ from: initialFrom, to: today });
  const [rangeError, setRangeError] = useState("");
  const [sortBy, setSortBy] = useState("reportDate");
  const [sortDirection, setSortDirection] = useState("desc");
  const params = new URLSearchParams({ kind: "reports", internalProfileId: profileId, campaignId, reportType: "spCampaigns", adProduct: "SPONSORED_PRODUCTS", from: applied.from, to: applied.to, page: String(page), pageSize: String(pageSize), sortBy, sortDirection });
  const read = useLocalRead(open ? `/api/integrations/amazon/ads/data?${params}` : null, reportPage);
  function apply(event: React.FormEvent) {
    event.preventDefault();
    const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 366 * 86400_000) { setRangeError("日期范围无效；结束日须不早于开始日，范围最多367天。"); return; }
    setRangeError(""); setPage(1); setApplied({ from, to });
  }
  return <section aria-label="Campaign 已发布日报">
    <h2>已发布 Campaign 日报</h2>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "收起 Campaign 日报" : "查看 Campaign 已发布日报"}</button>
    {open && <>
    <form className="ads-synced-toolbar" onSubmit={apply}>
      <label>开始日期<input aria-label="Campaign 日报开始日期" type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
      <label>结束日期<input aria-label="Campaign 日报结束日期" type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
      <label>排序<select aria-label="Campaign 日报排序" value={sortBy} onChange={event => { setPage(1); setSortBy(event.target.value); }}>{[["reportDate", "报告日"], ["impressions", "曝光"], ["clicks", "点击"], ["spend", "花费"], ["orders", "订单"], ["sales", "销售额"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>方向<select aria-label="Campaign 日报方向" value={sortDirection} onChange={event => { setPage(1); setSortDirection(event.target.value); }}><option value="desc">降序</option><option value="asc">升序</option></select></label>
      <button type="submit">查询日报</button><button type="button" aria-label="刷新 Campaign 日报" disabled={read.loading} onClick={read.refresh}>刷新</button>
    </form>
    {rangeError && <p role="alert" className="ads-synced-error">{rangeError}</p>}
    <div className="ads-synced-notice"><span>只读本地已发布事实，非实时 Amazon 请求。只展示已观察数据，不证明日期覆盖完整或归因已最终回补；指标按币种、归因窗口与 API 版本分组，不跨组相加。</span><span>报告日保留来源日期标签；历史报告时区和日期语义尚未提供；任一已保存行缺失指标则该项汇总为—，仍不证明日期完整，不用于跨口径比较或自动优化。</span>{read.data && <span>查询日期 {read.data.dateRange.from} 至 {read.data.dateRange.to} · 来源 {read.data.source} · 新鲜度 {read.data.freshness.status} · 最近发布 {date(read.data.syncedAt)} · 服务端汇总跨全部分页</span>}{read.data?.warnings.map((warning, index) => <span key={`${index}-${warning}`}>{warning}</span>)}</div>
    {read.data?.freshness.profiles?.map(profile => <section className="ads-synced-detail" key={profile.profileRecordId} aria-label={`日报 Profile 新鲜度 ${profile.profileRecordId}`}>
      <h3>Profile {profile.profileRecordId} · {profile.reportType ?? "全部报告类型"} · {profile.status}</h3>
      <p>当前筛选内观察到的报告日期：{profile.coveredFrom ?? "无"} 至 {profile.coveredTo ?? "无"}；查询日期 {read.data!.dateRange.from} 至 {read.data!.dateRange.to}。观察范围不代表连续日期覆盖。</p>
      <p>最近成功发布：{date(profile.lastSuccessAt)} · 最近尝试：{date(profile.lastAttemptAt)}</p>
      {profile.lastTaskId && <TaskEvidence id={profile.lastTaskId} profileId={profile.profileRecordId} />}
      {profile.warningCodes.length > 0 && <p>同步质量代码：{profile.warningCodes.join("、")}</p>}
    </section>)}
    {read.data && !read.data.freshness.profiles?.length && <p>接口未提供逐 Profile 新鲜度明细，覆盖范围与最近尝试不可判定。</p>}
    <ReadState {...read} empty={read.data?.rows.length === 0} retry={read.refresh} />
    {read.data?.totals.map(total => <section className="ads-synced-detail" key={JSON.stringify([total.reportType, total.adProduct, total.currencyCode, total.attributionWindow, total.apiVersion])} aria-label={`日报汇总 ${total.currencyCode ?? "币种未知"} ${total.attributionWindow ?? "归因未知"} ${total.apiVersion}`}>
      <h3>筛选范围汇总 · {total.currencyCode ?? "币种未知"} · 归因 {total.attributionWindow ?? "未知"} · {total.apiVersion}</h3>
      {total.completeness ? <details><summary>字段完整性 · 已观察 {total.completeness.observedFactCount} 条事实</summary><p>仅核对当前筛选中已保存的事实；不代表日期、账户或归因完整。</p><dl>{reportMetricFields.map(field => { const quality = total.completeness!.metrics[field]; return <div key={field}><dt>{field}</dt><dd>{({ COMPLETE: "已观察字段齐全", PARTIAL: "部分缺失", MISSING: "全部缺失", NO_FACTS: "没有事实" })[quality.status]} · 已提供 {quality.providedFactCount} · 缺失 {quality.missingFactCount}</dd></div>; })}</dl></details> : <p>字段完整性计数未由接口提供，不能据此推断字段齐全。</p>}
      <dl>{[["曝光", total.impressions], ["点击", total.clicks], ["花费", total.spend], ["订单", total.orders], ["销售额", total.sales], ["件数", total.units], ["CTR（百分比点）", total.ctr], ["CPC", total.cpc], ["ACOS（百分比点）", total.acos], ["ROAS", total.roas]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
    </section>)}
    {read.data && !!read.data.rows.length && <div className="ads-table-scroll"><table className="ads-simple-table" aria-label="Campaign 日报事实"><thead><tr>{["报告日", "曝光", "点击", "花费", "订单", "销售额", "件数", "归因窗口", "API 版本", "发布版本", "来源任务", "本地同步"].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{read.data.rows.map(row => <tr key={row.id}><td>{row.reportDate}</td><td>{row.impressions ?? "—"}</td><td>{row.clicks ?? "—"}</td><td>{row.spend == null ? "—" : `${row.spend} ${row.currencyCode ?? "币种未知"}`}</td><td>{row.orders ?? "—"}</td><td>{row.sales == null ? "—" : `${row.sales} ${row.currencyCode ?? "币种未知"}`}</td><td>{row.units ?? "—"}</td><td>{row.attributionWindow ?? "未知"}</td><td>{row.apiVersion}</td><td>{row.versionId}</td><td><TaskEvidence id={row.sourceTaskId} profileId={row.profileId} /></td><td>{date(row.syncedAt)}</td></tr>)}</tbody></table></div>}
    <Pagination page={page} data={read.data} loading={read.loading} change={setPage} />
    </>}
  </section>;
}
function ChildEntityTable({ domain, profileId, campaignId, groupId, currency }: { domain: typeof groupDomains[number]; profileId: string; campaignId?: string; groupId?: string; currency?: string | null }) {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [filters, setFilters] = useState({ search: "", state: "", sortBy: "name", sortDirection: "asc" });
  const params: Record<string, string> = { entityType: domain.type, internalProfileId: profileId, page: String(page), ...filters };
  if (campaignId) params.campaignId = campaignId;
  if (groupId) params.adGroupId = groupId;
  const read = useLocalRead(url(params), entityPage);
  function change(patch: Partial<typeof filters>) { setPage(1); setFilters(value => ({ ...value, ...patch })); }
  return <>
    <form className="ads-synced-toolbar" onSubmit={event => { event.preventDefault(); change({ search: text.trim() }); }}>
      <label>搜索<input aria-label="下属实体搜索" maxLength={120} value={text} onChange={event => setText(event.target.value)} placeholder={domain.target ? "名称或 Amazon ID" : "关键词或 Amazon ID"} /></label><button type="submit">搜索投放</button>
      <label>状态<select aria-label="下属实体状态" value={filters.state} onChange={event => change({ state: event.target.value })}><option value="">全部状态</option>{["ENABLED", "PAUSED", "ARCHIVED", "OTHER", "USER_DELETED"].map(state => <option key={state}>{state}</option>)}</select></label>
      <label>排序<select aria-label="下属实体排序" value={filters.sortBy} onChange={event => change({ sortBy: event.target.value })}>{[["name", "名称"], ["externalId", "Amazon ID"], ["state", "状态"], ["syncedAt", "同步时间"], ...(!domain.negative ? [["bid", "竞价"]] : [])].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>方向<select aria-label="下属实体排序方向" value={filters.sortDirection} onChange={event => change({ sortDirection: event.target.value })}><option value="asc">升序</option><option value="desc">降序</option></select></label>
      <button type="button" aria-label="刷新下属实体" disabled={read.loading} onClick={read.refresh}>刷新</button>
    </form>
    <Metadata data={read.data} /><ReadState {...read} empty={read.data?.rows.length === 0} retry={read.refresh} />
    {read.data && !!read.data.rows.length && <div className="ads-table-scroll"><table className="ads-simple-table" aria-label={`本地${domain.label}`}><thead><tr><th>{domain.target ? "投放表达式" : "关键词"} / Amazon ID</th><th>{domain.target ? "表达式类型" : "匹配类型"}</th><th>状态</th>{!domain.negative && <th>竞价 / 币种</th>}<th>同步时间</th><th>来源</th></tr></thead><tbody>{read.data.rows.map(row => <tr key={row.id}>
      <td>{domain.target ? row.targetingExpression == null ? "表达式未知" : <pre>{JSON.stringify(row.targetingExpression, null, 2)}</pre> : row.keywordText ?? row.name ?? "—"}<br />{row.externalId}</td><td>{(domain.target ? row.expressionType : row.matchType) ?? "—"}</td><td>{row.state ?? "未知"}</td>{!domain.negative && <td>{row.bid ?? "—"} {currency ?? "未知币种"}</td>}<td>{date(row.syncedAt)}</td><td><RawEntity row={row} /></td>
    </tr>)}</tbody></table></div>}
    <Pagination page={page} data={read.data} loading={read.loading} change={setPage} />
  </>;
}

function CampaignDetail({ profileId, campaignId, navigate }: { profileId: string; campaignId: string; navigate: (path: string) => void }) {
  const [page, setPage] = useState(1);
  const campaign = useLocalRead(url({ entityType: "SP:campaign", internalProfileId: profileId, externalId: campaignId, pageSize: "1" }), entityPage);
  const groups = useLocalRead(campaign.data?.rows.length === 1 ? url({ entityType: "SP:ad-group", internalProfileId: profileId, campaignId, page: String(page) }) : null, entityPage);
  const row = campaign.data?.rows[0];
  const profile = campaign.data?.scope.profiles.find(value => value.profileRecordId === profileId);
  return <><button type="button" className="ads-link" onClick={() => navigate(base)}>返回广告活动</button><ReadState {...campaign} empty={campaign.data?.rows.length === 0} retry={campaign.refresh} />{row && <>
    <header className="ads-synced-heading"><div><h1>{row.name ?? row.externalId}</h1><p>Campaign {row.externalId} · Profile {profile?.amazonProfileId ?? profileId} · {profile?.countryCode ?? "未知站点"}</p></div><button type="button" aria-label="刷新广告活动详情" onClick={campaign.refresh}>刷新</button></header>
    <Metadata data={campaign.data} /><section className="ads-synced-detail" aria-label="Campaign 设置与来源"><h2>当前设置与来源</h2><dl>{[["状态", row.state], ["预算", row.budgetAmount], ["预算类型", row.budgetType], ["币种", profile?.currencyCode], ["时区", profile?.timezone], ["投放类型", row.targetingType], ["开始日期", row.startDate], ["结束日期", row.endDate]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl><RawEntity row={row} /></section>
    <h2>所属广告组</h2><ReadState {...groups} empty={groups.data?.rows.length === 0} retry={groups.refresh} />{groups.data && !!groups.data.rows.length && <div className="ads-table-scroll"><table className="ads-simple-table" aria-label="所属广告组"><thead><tr><th>广告组</th><th>Amazon ID</th><th>状态</th><th>默认竞价 / 币种</th><th>同步时间</th><th>来源</th></tr></thead><tbody>{groups.data.rows.map(group => <tr key={group.id}><td><button type="button" className="ads-link" onClick={() => navigate(`${groupBase}/${encodeURIComponent(group.profileId)}/${encodeURIComponent(group.externalId)}`)}>{group.name ?? group.externalId}</button></td><td>{group.externalId}</td><td>{group.state ?? "未知"}</td><td>{group.bid ?? "—"} {profile?.currencyCode ?? "未知币种"}</td><td>{date(group.syncedAt)}</td><td><RawEntity row={group} /></td></tr>)}</tbody></table></div>}<Pagination page={page} data={groups.data} loading={groups.loading} change={setPage} />
    <CampaignReports profileId={profileId} campaignId={campaignId} />
    <ChildEntities profileId={profileId} campaignId={campaignId} currency={profile?.currencyCode} />
  </>}</>;
}

function AdGroupDetail({ profileId, groupId, navigate }: { profileId: string; groupId: string; navigate: (path: string) => void }) {
  const read = useLocalRead(url({ entityType: "SP:ad-group", internalProfileId: profileId, externalId: groupId, pageSize: "1" }), entityPage);
  const row = read.data?.rows[0];
  const profile = read.data?.scope.profiles.find(value => value.profileRecordId === profileId);
  const campaignId = row?.campaignId ?? row?.parentExternalId;
  return <><button type="button" className="ads-link" onClick={() => navigate(groupBase)}>返回广告组</button>
    <ReadState {...read} empty={read.data?.rows.length === 0} retry={read.refresh} />{row && <>
      <header className="ads-synced-heading"><div><h1>{row.name ?? row.externalId}</h1><p>Ad Group {row.externalId} · Profile {profile?.amazonProfileId ?? profileId} · {profile?.countryCode ?? "未知站点"}</p></div><button type="button" aria-label="刷新广告组详情" onClick={read.refresh}>刷新</button></header>
      <Metadata data={read.data} /><section className="ads-synced-detail" aria-label="Ad Group 设置与来源"><h2>当前设置与来源</h2>
        <dl>{[["状态", row.state], ["默认竞价", row.bid], ["币种", profile?.currencyCode], ["时区", profile?.timezone], ["所属 Campaign ID", campaignId]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
        {campaignId && <button type="button" className="ads-link" onClick={() => navigate(`${base}/${encodeURIComponent(profileId)}/${encodeURIComponent(campaignId)}`)}>查看所属广告活动</button>}
        <RawEntity row={row} />
      </section><ChildEntities profileId={profileId} campaignId={campaignId ?? undefined} groupId={groupId} currency={profile?.currencyCode} /><p>表现日报尚未接入此详情，不以结构数据推断业绩指标。</p>
    </>}
  </>;
}

export function AdsCampaignWorkspace({ path, navigate, onData, onDemo }: { path: string; navigate: (path: string) => void; onData: () => void; onDemo: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [accounts, setAccounts] = useState(path === "/amazon-ads/accounts");
  useEffect(() => { setAccounts(path === "/amazon-ads/accounts"); }, [path]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  function go(value: string) { if (mobile) setCollapsed(false); navigate(value); }
  const groupRoute = /^\/amazon-ads\/ad-groups(?:\/|$)/.test(path);
  const structureRoute = /^\/amazon-ads\/(keywords|targets|negatives)(?:\/|$)/.exec(path)?.[1];
  let ids: string[] = [], invalid = !/^\/amazon-ads\/(accounts|campaigns|ad-groups|keywords|targets|negatives)(?:\/|$)/.test(path);
  try { ids = path.replace(/^\/amazon-ads\/(?:campaigns|ad-groups|keywords|targets|negatives)\/?/, "").split("/").filter(Boolean).map(decodeURIComponent); } catch { invalid = true; }
  const isList = ids.length === 0 || ids.length === 1 && ids[0] === "sp";
  const isDetail = ids.length === 2 && ids.every(id => id.length <= 200);
  return <div className={`ads-workspace ads-live-workspace ${collapsed ? "ads-collapsed" : ""}`}>
    <header className="ads-topbar"><button type="button" aria-label="折叠广告导航" aria-expanded={mobile ? collapsed : !collapsed} onClick={() => setCollapsed(value => !value)}><Menu size={19} /></button><span className="ads-logo">amazon <span>ads</span></span><span className="ads-workspace-name">广告管理中心 · 本地数据</span></header>
    <aside className="ads-sidebar" aria-label="本地广告导航"><div className="ads-sidebar-heading">广告工作台</div><button type="button" className={`ads-nav-item ${!accounts && !groupRoute && !structureRoute ? "active" : ""}`} onClick={() => { setAccounts(false); go(base); }}>广告活动</button><button type="button" className={`ads-nav-item ${!accounts && groupRoute ? "active" : ""}`} onClick={() => { setAccounts(false); go(groupBase); }}>广告组</button>{[["keywords", "关键词"], ["targets", "商品投放"], ["negatives", "否定投放"]].map(([route, label]) => <button type="button" key={route} className={`ads-nav-item ${!accounts && structureRoute === route ? "active" : ""}`} onClick={() => { setAccounts(false); go(`/amazon-ads/${route}`); }}>{label}</button>)}<button type="button" className="ads-nav-item" onClick={onData}><Database size={14} />已同步数据浏览器</button><button type="button" className={`ads-nav-item ${accounts ? "active" : ""}`} onClick={() => { setAccounts(true); if (mobile) setCollapsed(false); }}>账户与同步任务</button><button type="button" className="ads-nav-item" onClick={onDemo}>演示工作台</button><div className="ads-sidebar-footer">只读本地数据<br />修改须经草稿与审批</div></aside>
    <main className="ads-main"><div className="ads-synced-view">{accounts ? <AdsAccounts /> : invalid || (structureRoute ? !isList : !isList && !isDetail) ? <div role="alert">该广告产品或详情路径尚未接入本地业务视图。<button type="button" className="ads-link" onClick={() => go(base)}>返回 SP 广告活动</button></div> : structureRoute ? <StructureList key={structureRoute} route={structureRoute} navigate={go} /> : isDetail && groupRoute ? <AdGroupDetail key={path} profileId={ids[0]} groupId={ids[1]} navigate={go} /> : isDetail ? <CampaignDetail key={ids.join("/")} profileId={ids[0]} campaignId={ids[1]} navigate={go} /> : <CampaignList key={groupRoute ? "groups" : "campaigns"} groups={groupRoute} navigate={go} />}</div></main>
  </div>;
}
