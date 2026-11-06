"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

type EntityRecord = {
  id: string;
  profileId: string;
  entityType: string;
  externalId: string;
  amazonProfileId?: string;
  sourceTask?: { status: string; stage: string };
  parentExternalId: string | null;
  state: string | null;
  name?: string | null;
  keywordText?: string | null;
  campaignId?: string | null;
  adGroupId?: string | null;
  budgetAmount?: string | null;
  budgetType?: string | null;
  bid?: string | null;
  matchType?: string | null;
  targetingType?: string | null;
  expressionType?: string | null;
  targetingExpression?: unknown;
  startDate?: string | null;
  endDate?: string | null;
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
  impressions: string | null;
  clicks: string | null;
  spend: string | null;
  orders: string | null;
  sales: string | null;
  units: string | null;
  currencyCode?: string | null;
  attributionWindow: string | null;
  apiVersion: string;
  versionId?: string;
  publishedAt?: string;
  versionStatus?: string;
  sourceTaskId: string;
  syncedAt: string;
};

type Profile = { id: string; amazonProfileId: string; authorizationId: string; sellerAccountId: string | null; seller?: { displayName: string }; timezone: string | null; currencyCode: string | null; freshness: string; syncPlans: Array<{ status: string; lastSuccessAt: string | null; lastErrorCode: string | null; tasks: Array<{ id: string; status: string; stage: string; errorCode: string | null; processedCount: number }> }> };
type ReportTotal = Pick<ReportFact, "reportType" | "adProduct" | "currencyCode" | "attributionWindow" | "apiVersion" | "impressions" | "clicks" | "spend" | "orders" | "sales" | "units">;
type DataResponse<T> = { totals?: ReportTotal[] | null; dateRange?: { from: string; to: string } | null; warnings?: string[]; pagination?: { total: number }; total?: number; meta?: { lastSyncAt: string | null; source: string; coverage: string; profiles: Profile[]; profilesTruncated: boolean }; rows: T[]; page: number; pageSize: number; from?: string; to?: string; error?: string };
type DataKind = "entities" | "reports";
const pageSize = 100;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function entityText(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
function entityBudget(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  return entityText((payload as Record<string, unknown>).budget, "budget");
}

// Normalized API fields are authoritative; older snapshots may only have a payload.
function entityField(row: EntityRecord, key: "name" | "keywordText" | "campaignId" | "adGroupId" | "bid" | "matchType" | "targetingType" | "expressionType" | "budgetType" | "startDate" | "endDate") {
  return row[key] ?? entityText(row.payload, key);
}
function entityName(row: EntityRecord) { return entityField(row, "name") ?? entityField(row, "keywordText"); }
function entityBid(row: EntityRecord) { return row.bid ?? entityText(row.payload, "defaultBid") ?? entityText(row.payload, "bid"); }
function storedBudget(row: EntityRecord) { return row.budgetAmount ?? entityBudget(row.payload); }
function entityExpression(row: EntityRecord) {
  return row.targetingExpression ?? (row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>).expression : null);
}

export function AdsSyncedData({ onBack, onCampaigns }: { onBack: () => void; onCampaigns?: () => void }) {
  const [kind, setKind] = useState<DataKind>("entities");
  const [entityType, setEntityType] = useState("");
  const [profileId, setProfileId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [authId, setAuthId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [adGroupId, setAdGroupId] = useState("");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("entityType");
  const [direction, setDirection] = useState("asc");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reportType, setReportType] = useState("");
  const [reportSort, setReportSort] = useState("reportDate");
  const [adProduct, setAdProduct] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DataResponse<EntityRecord | ReportFact> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedEntity, setSelectedEntity] = useState<EntityRecord | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) });
    if (kind === "entities") {
      for (const [key, value] of Object.entries({ entityType, internalProfileId: profileId, sellerAccountId: sellerId, authorizationId: authId, campaignId, adGroupId, state, search, sort, direction })) if (value.trim()) params.set(key, value.trim());
    }
    if (kind === "reports") {
      params.set("from", from);
      params.set("to", to);
      if (reportType.trim()) params.set("reportType", reportType.trim());
      for (const [key, value] of Object.entries({ internalProfileId: profileId, sellerAccountId: sellerId, authorizationId: authId, campaignId, adGroupId, search, sortBy: reportSort, sortDirection: direction, adProduct })) if (value.trim()) params.set(key, value.trim());
    }
    setLoading(true);
    setData(null);
    setSelectedEntity(null);
    setError("");
    fetch(`/api/integrations/amazon/ads/data?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as DataResponse<EntityRecord | ReportFact>;
        if (!response.ok) throw new Error(body.error || `读取失败（${response.status}）`);
        if (!Array.isArray(body.rows)) throw new Error("Ads 数据接口返回格式无效。");
        if (controller.signal.aborted) return;
        setData({ ...body, total: body.total ?? body.pagination?.total });
        // Keep the full authorized option set while filtering to a selected Profile.
        if (body.meta && !profileId && !sellerId && !authId) setProfiles(body.meta.profiles);
      })
      .catch(cause => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "无法读取已同步数据。");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, entityType, profileId, sellerId, authId, campaignId, adGroupId, state, search, sort, direction, reportType, reportSort, adProduct, from, to, page, reloadKey]);

  function changeKind(next: DataKind) {
    setKind(next);
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const selectedExpression = selectedEntity ? entityExpression(selectedEntity) : null;
  const isLastPage = data?.total !== undefined ? page * pageSize >= data.total : rows.length < pageSize;
  const entityViews = [["", "全部已存结构"], ["SP:campaign", "Campaign"], ["SP:ad-group", "Ad Group"], ["SP:keyword", "Keyword"], ["SP:target", "Target"], ["SP:negative-keyword", "广告组否定词"], ["SP:negative-target", "广告组商品否定"], ["SP:campaign-negative-keyword", "Campaign 否定词"], ["SP:campaign-negative-target", "Campaign 商品否定"]];

  return <div className="ads-synced-view">
    <header className="ads-synced-heading">
      <div>
        <button type="button" className="ads-link ads-synced-back" onClick={onBack}><ArrowLeft size={15} />返回演示工作台</button>
        <h1>已同步 Ads 数据</h1>
        {onCampaigns && <button type="button" className="ads-link" onClick={onCampaigns}>进入本地广告活动工作台</button>}
        <p>读取当前工作区 PostgreSQL 中已保存的 Amazon Ads 事实；此页面不会发起 Amazon 请求。当前只读，广告修改尚未启用。</p>
      </div>
      <button type="button" className="ads-synced-refresh" onClick={() => setReloadKey(value => value + 1)} disabled={loading} title="重新读取已保存数据" aria-label="重新读取已保存数据"><RefreshCw size={15} /></button>
    </header>

    <div className="ads-synced-notice" role="status">
      <strong>真实数据视图</strong>
      <span>只展示服务端已保存记录。它与演示 Fixture 隔离；当前页不会用演示数据补空。表中的 Profile 标识是数据库内部关联键，不是 Amazon Profile ID。结构数据提供服务端总量、Profile 时区/币种及计划时效；日报口径与真实同步验收仍待完成。</span>
    </div>

    {kind === "entities" && <>
      <nav className="ads-synced-tabs" aria-label="真实广告实体">{entityViews.map(([value, label]) => <button key={value} type="button" aria-pressed={entityType === value} onClick={() => { setEntityType(value); setPage(1); }}>{label}</button>)}</nav>
      <div className="ads-synced-toolbar">
        <label>店铺<select aria-label="真实店铺筛选" value={sellerId} onChange={e => { setSellerId(e.target.value); setProfileId(""); setPage(1); }}><option value="">全部授权店铺</option>{Array.from(new Map(profiles.filter(p => p.sellerAccountId).map(p => [p.sellerAccountId!, p])).values()).map(p => <option key={p.sellerAccountId} value={p.sellerAccountId!}>{p.seller?.displayName ?? p.sellerAccountId}</option>)}</select></label>
        <label>广告授权账户<select aria-label="真实广告账户筛选" value={authId} onChange={e => { setAuthId(e.target.value); setProfileId(""); setPage(1); }}><option value="">全部授权账户</option>{Array.from(new Set(profiles.map(p => p.authorizationId))).map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label>Amazon Profile<select aria-label="真实 Profile 筛选" value={profileId} onChange={e => { setProfileId(e.target.value); setPage(1); }}><option value="">全部授权 Profile</option>{profiles.filter(p => (!sellerId || p.sellerAccountId === sellerId) && (!authId || p.authorizationId === authId)).map(p => <option key={p.id} value={p.id}>{p.amazonProfileId} · {p.currencyCode ?? "未知币种"} · {p.timezone ?? "未知时区"}</option>)}</select></label>
        <label>搜索<input aria-label="真实实体搜索" value={search} placeholder="名称、关键词或 Amazon ID" onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label>Campaign ID<input aria-label="真实 Campaign 筛选" value={campaignId} onChange={e => { setCampaignId(e.target.value); setPage(1); }} /></label>
        <label>Ad Group ID<input aria-label="真实 Ad Group 筛选" value={adGroupId} onChange={e => { setAdGroupId(e.target.value); setPage(1); }} /></label>
        <label>状态<select aria-label="真实状态筛选" value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="">全部状态</option>{["ENABLED", "PAUSED", "ARCHIVED", "OTHER", "USER_DELETED"].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>排序<select aria-label="真实排序字段" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}>{["name", "entityType", "externalId", "state", "budgetAmount", "bid", "syncedAt", "sourceUpdatedAt"].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>方向<select aria-label="真实排序方向" value={direction} onChange={e => { setDirection(e.target.value); setPage(1); }}><option value="asc">升序</option><option value="desc">降序</option></select></label>
      </div>
      {data?.meta && <div className="ads-synced-notice"><span>来源 {data.meta.source} · 结构域状态 {data.meta.coverage ?? "UNKNOWN"} · 最近结构成功 {formatDate(data.meta.lastSyncAt)} · 当前快照仅代表已观察记录，未返回不推定删除。</span>{data.warnings?.map(warning => <span key={warning}>{warning}</span>)}{data.meta.profilesTruncated && <span>Profile 选项超过 500 个，需缩小范围。</span>}</div>}
      {data?.meta?.profiles.map(profile => <details key={profile.id}><summary>Profile {profile.amazonProfileId} · {profile.freshness} · {profile.currencyCode ?? "未知币种"} · {profile.timezone ?? "未知时区"}</summary>{profile.syncPlans.map((plan, i) => <p key={i}>计划 {plan.status} · 最近计划成功 {formatDate(plan.lastSuccessAt)} · {plan.lastErrorCode ?? "无计划错误"}{plan.tasks.map(task => <span key={task.id}> · 任务 {task.id}：{task.status} / {task.stage} · 处理 {task.processedCount} · {task.errorCode ?? "无任务错误"}</span>)}</p>)}</details>)}
    </>}
    {kind === "reports" && <>
      <div className="ads-synced-toolbar">
        <label>店铺<select aria-label="日报店铺筛选" value={sellerId} onChange={e => { setSellerId(e.target.value); setProfileId(""); setPage(1); }}><option value="">全部授权店铺</option>{Array.from(new Map(profiles.filter(p => p.sellerAccountId).map(p => [p.sellerAccountId!, p])).values()).map(p => <option key={p.sellerAccountId} value={p.sellerAccountId!}>{p.seller?.displayName ?? p.sellerAccountId}</option>)}</select></label>
        <label>授权账户<select aria-label="日报授权账户筛选" value={authId} onChange={e => { setAuthId(e.target.value); setProfileId(""); setPage(1); }}><option value="">全部授权账户</option>{Array.from(new Set(profiles.map(p => p.authorizationId))).map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label>Profile<select aria-label="日报 Profile 筛选" value={profileId} onChange={e => { setProfileId(e.target.value); setPage(1); }}><option value="">全部授权 Profile</option>{profiles.filter(p => (!sellerId || p.sellerAccountId === sellerId) && (!authId || p.authorizationId === authId)).map(p => <option key={p.id} value={p.id}>{p.amazonProfileId} · {p.currencyCode ?? "未知币种"}</option>)}</select></label>
        <label>Campaign ID<input aria-label="日报 Campaign 筛选" value={campaignId} onChange={e => { setCampaignId(e.target.value); setPage(1); }} /></label>
        <label>Ad Group ID<input aria-label="日报 Ad Group 筛选" value={adGroupId} onChange={e => { setAdGroupId(e.target.value); setPage(1); }} /></label>
        <label>搜索<input aria-label="日报搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>
        <label>广告产品<input aria-label="日报广告产品筛选" placeholder="来源广告产品代码" value={adProduct} onChange={e => { setAdProduct(e.target.value); setPage(1); }} /></label>
        <label>排序<select aria-label="日报排序字段" value={reportSort} onChange={e => { setReportSort(e.target.value); setPage(1); }}>{["reportDate", "campaignId", "adGroupId", "impressions", "clicks", "spend", "orders", "sales", "searchTerm"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>方向<select aria-label="日报排序方向" value={direction} onChange={e => { setDirection(e.target.value); setPage(1); }}><option value="asc">升序</option><option value="desc">降序</option></select></label>
      </div>
      <div className="ads-synced-notice"><span>只展示最新已发布的已观察日报事实；不表示完整覆盖或归因已最终回补。未接入的报告不会生成占位指标。</span>{data?.meta && <span>来源 {data.meta.source} · 最近发布 {formatDate(data.meta.lastSyncAt)}</span>}{data?.warnings?.map(warning => <span key={warning}>{warning}</span>)}</div>
    </>}
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
    {!loading && !error && rows.length === 0 && <div className="ads-synced-empty"><strong>{kind === "entities" ? "没有已保存的广告结构" : "此日期范围内没有已保存的日报"}</strong><span>请核对授权、Profile 绑定和计划运行状态；已保存数据为空不代表 Amazon 账户中没有数据。</span></div>}

    {!loading && !error && kind === "reports" && !!data?.totals?.length && <section aria-label="日报筛选范围汇总">
      <h2>筛选范围汇总</h2>
      <p>服务端汇总当前筛选范围的 {data.total ?? "—"} 条已发布事实，跨全部分页；不是当前页合计。{data.dateRange ? `报告日期 ${data.dateRange.from} 至 ${data.dateRange.to}。` : ""}每行保留独立口径，不跨行相加；— 表示源字段未提供。</p>
      <div className="ads-table-scroll"><table className="ads-simple-table"><thead><tr><th>报告 / 广告产品</th><th>币种</th><th>归因窗口 / API</th><th>曝光</th><th>点击</th><th>花费</th><th>订单</th><th>销售额</th><th>件数</th></tr></thead><tbody>{data.totals.map(total => <tr key={JSON.stringify([total.reportType, total.adProduct, total.currencyCode, total.attributionWindow, total.apiVersion])}><td>{total.reportType}<br />{total.adProduct}</td><td>{total.currencyCode ?? "未知币种"}</td><td>{total.attributionWindow ?? "未知归因窗口"}<br />{total.apiVersion}</td><td>{total.impressions ?? "—"}</td><td>{total.clicks ?? "—"}</td><td>{total.spend ?? "—"}</td><td>{total.orders ?? "—"}</td><td>{total.sales ?? "—"}</td><td>{total.units ?? "—"}</td></tr>)}</tbody></table></div>
    </section>}

    {!loading && !error && kind === "entities" && selectedEntity && <section className="ads-synced-detail" aria-label="广告实体详情">
      <header><h2>{entityName(selectedEntity) ?? selectedEntity.externalId} · 只读详情</h2><button type="button" className="ads-link" onClick={() => setSelectedEntity(null)}>关闭实体详情</button></header>
      <dl>
        {[["实体类型", selectedEntity.entityType], ["Amazon 实体 ID", selectedEntity.externalId], ["内部 Profile ID", selectedEntity.profileId], ["Amazon Profile ID", selectedEntity.amazonProfileId], ["直接父级 ID", selectedEntity.parentExternalId], ["状态", selectedEntity.state], ["Campaign ID", entityField(selectedEntity, "campaignId")], ["Ad Group ID", entityField(selectedEntity, "adGroupId")], ["匹配类型", entityField(selectedEntity, "matchType")], ["竞价", entityBid(selectedEntity)], ["预算", storedBudget(selectedEntity)], ["预算类型", entityField(selectedEntity, "budgetType")], ["投放类型", entityField(selectedEntity, "targetingType")], ["表达式类型", entityField(selectedEntity, "expressionType")], ["开始日期", entityField(selectedEntity, "startDate")], ["结束日期", entityField(selectedEntity, "endDate")], ["上游更新时间", formatDate(selectedEntity.sourceUpdatedAt)], ["本地同步时间", formatDate(selectedEntity.syncedAt)], ["来源任务", selectedEntity.sourceTaskId], ["来源状态", selectedEntity.sourceTask ? `${selectedEntity.sourceTask.status} / ${selectedEntity.sourceTask.stage}` : "未知"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}
      </dl>
      {selectedExpression != null && <details><summary>投放表达式</summary><pre>{JSON.stringify(selectedExpression, null, 2)}</pre></details>}
      <p>{selectedEntity.entityType.includes("campaign-negative") ? "Campaign 级否定项，直接属于 Campaign，不属于 Ad Group。" : "父级关系来自已保存的 Amazon 结构数据。"} 当前快照不提供历史版本或业绩指标。</p>
      <div className="ads-synced-detail-links">
        {selectedEntity.entityType === "SP:campaign" && <button type="button" className="ads-link" onClick={() => {
          setProfileId(selectedEntity.profileId); setCampaignId(selectedEntity.externalId);
          setAdGroupId(""); setSearch(""); setReportType("spCampaigns"); setAdProduct("SPONSORED_PRODUCTS");
          setPage(1); setSelectedEntity(null); setData(null); setLoading(true); setKind("reports");
        }}>查看 Campaign 已发布日报</button>}
        {(selectedEntity.entityType === "SP:campaign" ? [["SP:ad-group", "查看下属 Ad Group"], ["SP:campaign-negative-keyword", "查看 Campaign 否定词"], ["SP:campaign-negative-target", "查看 Campaign 商品否定"]] : selectedEntity.entityType === "SP:ad-group" ? [["SP:keyword", "查看下属 Keyword"], ["SP:target", "查看下属 Target"], ["SP:negative-keyword", "查看广告组否定词"], ["SP:negative-target", "查看广告组商品否定"]] : []).map(([type, label]) => <button type="button" className="ads-link" key={type} onClick={() => {
          setProfileId(selectedEntity.profileId);
          setCampaignId(selectedEntity.entityType === "SP:campaign" ? selectedEntity.externalId : entityField(selectedEntity, "campaignId") ?? "");
          setAdGroupId(selectedEntity.entityType === "SP:ad-group" ? selectedEntity.externalId : "");
          setEntityType(type); setSearch(""); setState(""); setPage(1); setSelectedEntity(null);
        }}>{label}</button>)}
      </div>
    </section>}

    {!loading && !error && rows.length > 0 && (kind === "entities" ? <div className="ads-table-scroll ads-synced-table"><table className="ads-simple-table"><thead><tr><th>类型</th><th title="不是 Amazon Ads Profile ID">内部 Profile ID</th><th>Amazon Profile ID</th><th>名称 / 对象</th><th>预算 / 竞价</th><th>Amazon ID</th><th>上级 ID</th><th>状态</th><th>来源更新时间</th><th>来源任务</th><th>本地同步时间</th><th>原始字段</th></tr></thead><tbody>{(rows as EntityRecord[]).map(row => <tr key={row.id}><td>{row.entityType}</td><td>{row.profileId}</td><td>{row.amazonProfileId ?? "—"}</td><td>{entityName(row) ?? "—"}</td><td>{entityBid(row) ?? storedBudget(row) ?? "—"}</td><td><button type="button" className="ads-link" aria-label={`查看实体 ${row.externalId}`} onClick={() => setSelectedEntity(row)}>{row.externalId}</button></td><td>{row.parentExternalId ?? "—"}</td><td>{row.state ?? "—"}</td><td>{formatDate(row.sourceUpdatedAt)}</td><td>{row.sourceTaskId}<br />{row.sourceTask?.status ?? "来源状态未知"}</td><td>{formatDate(row.syncedAt)}</td><td><details><summary>查看字段</summary><pre>{JSON.stringify(row.payload, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : <div className="ads-table-scroll ads-synced-table"><table className="ads-simple-table"><thead><tr><th>报表 / 广告产品</th><th title="不是 Amazon Ads Profile ID">内部 Profile ID</th><th>报告日</th><th>Campaign / Ad Group</th><th>搜索词 / ASIN / 广告位</th><th>曝光</th><th>点击</th><th>花费</th><th>订单</th><th>销售额</th><th>归因 / API</th><th>来源任务</th><th>同步时间</th><th>发布版本</th></tr></thead><tbody>{(rows as ReportFact[]).map(row => <tr key={row.id}><td>{row.reportType} / {row.adProduct}</td><td>{row.profileId}</td><td>{row.reportDate}</td><td>{row.campaignId ?? "—"}<br />{row.adGroupId ?? "—"}</td><td>{row.searchTerm ?? row.advertisedAsin ?? row.placement ?? "—"}</td><td>{row.impressions ?? "—"}</td><td>{row.clicks ?? "—"}</td><td>{row.spend ?? "—"}{row.currencyCode ? ` ${row.currencyCode}` : ""}</td><td>{row.orders ?? "—"}</td><td>{row.sales ?? "—"}{row.currencyCode ? ` ${row.currencyCode}` : ""}</td><td>{row.attributionWindow ?? "—"}<br />{row.apiVersion}</td><td>{row.sourceTaskId}</td><td>{formatDate(row.syncedAt)}</td><td>{row.versionId ?? "版本未提供"}<br />{row.versionStatus ?? "状态未提供"}<br />{formatDate(row.publishedAt)}</td></tr>)}</tbody></table></div>)}

    <footer className="ads-synced-pagination"><span>当前页 {rows.length} 条；{data?.total !== undefined ? `筛选总量 ${data.total} 条` : "总量暂未由现有接口提供。"}</span><div><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1 || loading}>上一页</button><button type="button" onClick={() => setPage(value => value + 1)} disabled={isLastPage || loading}>下一页</button></div></footer>
  </div>;
}
