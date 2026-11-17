"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useVisiblePolling } from "@/lib/hooks/use-visible-polling";
import Link from "next/link";
import { SellfoxTabs } from "../sellfox-nav";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { sellfoxPlanGroups, sellfoxPlanSummary } from "@/lib/sellfox/data-plan";
import { syncCadenceGroups, syncFirstRunOrder } from "@/lib/sellfox/sync-plan";

type Dataset = {
  key: string; label: string; resource: string; table: string; href: string | null;
  rows: number; latest: string | null; storesWithData: number;
  lastRun: { id: string; status: string; startedAt: string; finishedAt: string | null; error: string | null } | null;
};
type Run = { id: string; resource: string; status: string; error: string | null; startedAt: string; finishedAt: string | null; progress: number | null };
type StoreRef = { externalId: string; name: string };
type CoverageRow = { resource: string; stores: number; rows: number; firstDate: string | null; lastDate: string | null; lastStatus: string | null };
type Shard = { resource: string; scopeKey: string; period: string; status: string; rows: number; cursor: unknown; runId: string; updatedAt: string; finishedAt: string | null };
type EndpointView = {
  id: string; code: string; label: string; path: string; dateMode: string; scopeMode: string;
  chunkDays: number; pageSize: number; rowsPath: string; idFields: string; params: string; maxRows: number;
  enabled: boolean; historyFrom: string | null; cursorDate: string | null; lastPlannedAt: string | null;
  rows: number; lastPeriod: string | null;
  lastRun: { status: string; error: string | null; startedAt: string; finishedAt: string | null } | null;
};
type CandidateView = { code: string; label: string; priority: string; paths: string[]; pathDocs: Array<{ path: string; doc: string | null; seeded: boolean }>; paramsContract: string; note: string };
function candidateDocSummary(candidate: CandidateView) {
  const docs = candidate.pathDocs ?? [];
  const seeded = docs.filter(item => item.seeded).length;
  const documented = docs.filter(item => item.doc).length;
  return [seeded ? `${seeded} 条已可一键登记` : null, documented ? `${documented} 条有本地字段文档` : null, "参数待联调，不猜字段"].filter(Boolean).join(" · ");
}
const emptyEndpointForm = {
  code: "", label: "", path: "", dateMode: "range", scopeMode: "store", chunkDays: "7",
  pageSize: "100", rowsPath: "", idFields: "", params: "{}", historyFrom: "", enabled: true,
};
type Hub = {
  configured: boolean; credentialSource: string; workerOnline: boolean;
  storeCount: number; stores: StoreRef[]; datasets: Dataset[]; hourlyRows: number;
  coverage: CoverageRow[]; shards: Shard[];
  plan: { total: number; live: number; planned: number; blocked: number };
  lastSuccess: Record<string, string>; runs: Run[];
};

const runStatusText: Record<string, string> = { queued: "排队", running: "运行中", done: "完成", failed: "失败" };

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** 最新业务日期：capturedAt 是时间戳，只取日期部分，避免列里出现毫秒。 */
function day(value: string | null | undefined) {
  if (!value) return "—";
  const match = /^(\d{4}-\d{2}-\d{2})[ T]/.exec(value);
  return match ? match[1] : value;
}

function n(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("zh-CN");
}

export function SyncConsole() {
  const shellUser = useAppShellUser();
  const canSync = roleCanPerformAction(shellUser?.userRole, "sellfox", "create", shellUser?.rolePermissions);
  const [data, setData] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const [to, setTo] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const [endpoints, setEndpoints] = useState<EndpointView[]>([]);
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [epForm, setEpForm] = useState(emptyEndpointForm);

  const loadEndpoints = useCallback(async () => {
    try {
      const response = await fetch("/api/sellfox/endpoints", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      setEndpoints(payload.endpoints as EndpointView[]);
      setCandidates((payload.candidates ?? []) as CandidateView[]);
    } catch { /* 端点面板读取失败不影响主控制台 */ }
  }, []);

  useEffect(() => { void loadEndpoints(); }, [loadEndpoints]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/sellfox/hub", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "读取同步状态失败。");
      setData(payload as Hub);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取同步状态失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const running = Boolean(data?.runs.some((run) => ["queued", "running"].includes(run.status)));
  useVisiblePolling({ intervalMs: 6000, enabled: running, onPoll: load });

  async function trigger(resource: string) {
    if (!canSync || busy) return;
    setBusy(resource);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/sellfox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource,
          ...(["sales", "performance", "orders", "ads_report", "ads_campaign", "ads_ad_group", "ads_placement", "ads_targeting", "ads_search_term"].includes(resource) ? { startDate: from, endDate: to } : {}),
          ...(resource.startsWith("ads_") ? { adTypes: ["sp"] } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "同步任务创建失败。");
      setNotice(`已提交「${resource}」同步，任务号 ${payload.runId}。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步任务创建失败。");
    } finally {
      setBusy("");
    }
  }

  async function fullSync() {
    if (!canSync || busy) return;
    setBusy("full-sync"); setNotice(""); setError("");
    try {
      const response = await fetch("/api/sellfox/full-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "全量计划生成失败。");
      const plan = payload.plan as { total: number; created: number; skipped: number };
      setNotice(`已按同步规则生成全量计划：共 ${plan.total} 个任务，新建 ${plan.created}，幂等跳过 ${plan.skipped}；任务由 Worker 自动执行。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "全量计划生成失败。"); }
    finally { setBusy(""); }
  }

  async function saveEndpoint() {
    if (!canSync || busy) return;
    setBusy("endpoint-save"); setNotice(""); setError("");
    try {
      const response = await fetch("/api/sellfox/endpoints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...epForm, chunkDays: Number(epForm.chunkDays), pageSize: Number(epForm.pageSize),
          historyFrom: epForm.historyFrom || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "端点配置保存失败。");
      setEndpoints(payload.endpoints as EndpointView[]);
      setEpForm(emptyEndpointForm);
      setNotice(`端点「${epForm.code}」已保存，Worker 将自动按规则拉取全量数据。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "端点配置保存失败。"); }
    finally { setBusy(""); }
  }

  async function endpointAction(code: string, body: Record<string, unknown>) {
    if (!canSync || busy) return;
    setBusy(`endpoint-${code}`); setNotice(""); setError("");
    try {
      const response = await fetch("/api/sellfox/endpoints", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, ...body }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "端点操作失败。");
      setEndpoints(payload.endpoints as EndpointView[]);
      if (body.action === "full_sync") {
        const plan = payload.plan as { created: number; skipped: number };
        setNotice(`端点「${code}」全量计划：新建 ${plan.created}，跳过 ${plan.skipped}。`);
      } else if (body.action === "reset_cursor") setNotice(`端点「${code}」自动回填游标已重置。`);
      else setNotice(`端点「${code}」已${body.enabled ? "启用" : "停用"}。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "端点操作失败。"); }
    finally { setBusy(""); }
  }

  /** 一键登记本地已文档化域（财务 V2 / FBM 等）为默认停用端点；不覆盖已有启停状态。 */
  async function seedKnown() {
    if (!canSync || busy) return;
    setBusy("seed-known"); setNotice(""); setError("");
    try {
      const response = await fetch("/api/sellfox/endpoints", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seedKnown: true }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "登记已文档化域失败。");
      setEndpoints(payload.endpoints as EndpointView[]);
      const seed = payload.seed as { total: number; created: number; updated: number };
      setNotice(`已登记赛狐已文档化域：共 ${seed.total} 个，新增 ${seed.created}、刷新 ${seed.updated}；均为默认停用，按需启用即自动全量拉取。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "登记已文档化域失败。"); }
    finally { setBusy(""); }
  }

  const summary = useMemo(() => sellfoxPlanSummary(), []);
  const p0 = useMemo(() => sellfoxPlanGroups.flatMap((group) => group.items.filter((item) => item.priority === "P0" && item.status !== "live").map((item) => ({ ...item, group: group.label }))), []);
  const done24h = data?.runs.filter((run) => run.status === "done" && Date.now() - new Date(run.startedAt).getTime() < 86_400_000).length ?? 0;
  const failed = data?.runs.filter((run) => run.status === "failed").length ?? 0;
  const cadence = useMemo(() => syncCadenceGroups(), []);
  const coverageByResource = useMemo(() => new Map((data?.coverage ?? []).map((row) => [row.resource, row])), [data]);
  const storeNameByExternalId = useMemo(() => new Map((data?.stores ?? []).map((store) => [store.externalId, store.name])), [data]);

  return (
    <section className="sellfox-ui">
      <SellfoxTabs current="/sellfox/sync" />
      <div className="sf-page">
        <div className="sf-page-head">
          <div className="sf-page-title">
            <span className="sf-badge">赛狐 Open API</span>
            <span className={data?.workerOnline ? "sf-badge sf-badge-live" : "sf-badge sf-badge-plan"}>{data ? (data.workerOnline ? "Worker 在线" : "Worker 未启动") : "读取中"}</span>
            <span className={data?.configured ? "sf-badge sf-badge-live" : "sf-badge sf-badge-plan"}>{data ? (data.configured ? `凭据已配置 · ${data.credentialSource === "database" ? "数据库加密" : "环境变量"}` : "凭据未配置") : "凭据读取中"}</span>
            <span className="sf-badge">店铺 {n(data?.storeCount)}</span>
            <span className="sf-badge">{running ? "有任务在跑" : "队列空闲"}</span>
          </div>
          <p className="sf-page-sub">按「资源 × 店铺 × 期间」编排全量同步。限流是每个接口 1 请求/秒（不是全局），页面只调度队列，不在浏览器里直连赛狐。</p>
          <div className="sf-page-meta">
            <span>数据域规划：{summary.live} 已接入 / {summary.planned} 待接入 / {summary.blocked} 需授权</span>
            <span>本页可调度：{data?.datasets.length ?? 0} 个已落表数据域</span>
          </div>
        </div>

        {error ? <div className="sf-notice" role="alert">{error}</div> : null}
        {notice ? <div className="sf-notice" role="status">{notice}</div> : null}

        <div className="sf-cards">
          {[
            { label: "可调度数据域", value: data?.datasets.length ?? 0, hint: "有表且有同步器" },
            { label: "24 小时成功任务", value: done24h, hint: "最近 40 条运行记录内" },
            { label: "失败任务", value: failed, hint: "含凭据/限流/接口错误" },
            { label: "待接入 P0", value: p0.length, hint: "有表无同步器或无表" },
          ].map((card) => (
            <div key={card.label} className="sf-card">
              <p className="sf-card-label">{card.label}</p>
              <p className="sf-card-value">{loading ? "…" : n(card.value)}</p>
              <p className="sf-card-hint">{card.hint}</p>
            </div>
          ))}
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>同步节奏</h2>
            <span className="sf-muted">四类节奏；窗口写死为「重跑覆盖范围」，不是「首次回溯范围」。</span>
          </div>
          <table>
            <thead>
              <tr><th scope="col">节奏</th><th scope="col">触发</th><th scope="col">窗口</th><th scope="col">资源</th><th scope="col">说明</th></tr>
            </thead>
            <tbody>
              {cadence.map((rule) => (
                <tr key={rule.id}>
                  <td><strong>{rule.label}</strong></td>
                  <td>{rule.cron}</td>
                  <td>{rule.window}</td>
                  <td className="sf-mono">{rule.resources.length ? rule.resources.join(", ") : "—（同步器未接入）"}</td>
                  <td className="sf-wrap">{rule.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>资源覆盖矩阵</h2>
            <span className="sf-muted">覆盖店铺 = 该表 distinct 店铺数 / 全部店铺；缺格不补。</span>
          </div>
          <div className="sf-table-scroll">
            <table>
              <thead>
                <tr>{["数据域", "落表", "行数", "覆盖店铺", "覆盖区间", "最新业务日期", "最近同步", "状态", "操作"].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9}>加载中</td></tr> : null}
                {!loading && (data?.datasets ?? []).length === 0 ? <tr><td colSpan={9}>暂无已接入数据域。</td></tr> : null}
                {(data?.datasets ?? []).map((dataset) => {
                  const coverage = coverageByResource.get(dataset.resource);
                  return (
                  <tr key={dataset.key}>
                    <td>{dataset.href ? <Link className="sf-link" href={dataset.href}>{dataset.label}</Link> : dataset.label}</td>
                    <td className="sf-mono">{dataset.table}</td>
                    <td className="sf-num">{n(dataset.rows)}</td>
                    <td className="sf-num">{data?.storeCount ? `${dataset.storesWithData}/${data.storeCount}` : n(dataset.storesWithData)}</td>
                    <td className="sf-mono">{coverage ? (coverage.firstDate && coverage.lastDate ? `${coverage.firstDate} ~ ${coverage.lastDate}` : `${n(coverage.rows)} 行`) : "—"}</td>
                    <td className="sf-mono">{day(dataset.latest)}</td>
                    <td className="sf-mono">{fmt(dataset.lastRun ? (dataset.lastRun.finishedAt ?? dataset.lastRun.startedAt) : data?.lastSuccess[dataset.resource])}</td>
                    <td>{dataset.lastRun ? <span className={`sf-state sf-state-${dataset.lastRun.status}`}>{runStatusText[dataset.lastRun.status] ?? dataset.lastRun.status}</span> : <span className="sf-state">未运行</span>}</td>
                    <td>
                      <button type="button" className="sf-btn" disabled={!canSync || busy === dataset.resource} title={canSync ? undefined : "当前角色没有赛狐同步权限。"} onClick={() => void trigger(dataset.resource)}>
                        {busy === dataset.resource ? "提交中" : "同步"}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sf-panel-foot">
            <label className="sf-check"><span>日期</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <span>至</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <span className="sf-muted">日期只对日事实资源生效；库存与 Listing 只能采当前状态。</span>
            <button type="button" className="sf-btn" onClick={() => void load()}>刷新</button>
          </div>
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>全自动同步（规则驱动）</h2>
            <span className="sf-muted">内置资源与后台配置的 API 端点共用一份规则表：自动分块、断点续跑、按接口限流、超限自动拆窗口、每日滚动重跑。</span>
          </div>
          <div className="sf-panel-foot">
            <label className="sf-check"><span>全量窗口</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <span>至</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => void fullSync()}>
              {busy === "full-sync" ? "生成中" : "一键全量（内置 + 端点）"}
            </button>
            <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => void seedKnown()}>
              {busy === "seed-known" ? "登记中" : "登记已文档化域"}
            </button>
            <button type="button" className="sf-btn" onClick={() => void loadEndpoints()}>刷新端点</button>
          </div>
          <div className="sf-table-scroll">
            <table>
              <thead><tr>{["端点", "接口", "日期/分块", "范围", "真实行数", "回填游标", "最近运行", "操作"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>
                {endpoints.length === 0 ? <tr><td colSpan={8}>尚未配置自定义 API 端点。在下方填写接口即可自动纳入全量同步。</td></tr> : null}
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td><strong>{endpoint.label}</strong><br /><code className="sf-mono">{endpoint.code}</code></td>
                    <td className="sf-mono sf-wrap">{endpoint.path}</td>
                    <td className="sf-mono">{endpoint.dateMode} / {endpoint.chunkDays}天</td>
                    <td className="sf-mono">{endpoint.scopeMode}</td>
                    <td className="sf-num"><Link href={`/sellfox/endpoint-data?code=${encodeURIComponent(endpoint.code)}`} title="查看该端点的原始响应行">{n(endpoint.rows)}</Link></td>
                    <td className="sf-mono">{endpoint.cursorDate ?? "—"}</td>
                    <td>{endpoint.lastRun ? <span className={`sf-state sf-state-${endpoint.lastRun.status}`}>{runStatusText[endpoint.lastRun.status] ?? endpoint.lastRun.status}</span> : <span className="sf-state">未运行</span>}
                      {endpoint.lastRun?.error ? <div className="sf-wrap sf-muted">{endpoint.lastRun.error}</div> : null}</td>
                    <td>
                      <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => setEpForm({
                        code: endpoint.code, label: endpoint.label, path: endpoint.path, dateMode: endpoint.dateMode,
                        scopeMode: endpoint.scopeMode, chunkDays: String(endpoint.chunkDays), pageSize: String(endpoint.pageSize),
                        rowsPath: endpoint.rowsPath, idFields: endpoint.idFields, params: endpoint.params,
                        historyFrom: endpoint.historyFrom ?? "", enabled: endpoint.enabled,
                      })}>编辑</button>
                      <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => void endpointAction(endpoint.code, { enabled: !endpoint.enabled })}>{endpoint.enabled ? "停用" : "启用"}</button>
                      <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => void endpointAction(endpoint.code, { action: "full_sync" })}>全量</button>
                      <button type="button" className="sf-btn" disabled={!canSync || busy !== ""} onClick={() => void endpointAction(endpoint.code, { action: "reset_cursor" })}>重置游标</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sf-ep-form">
            {([
              ["code", "端点 code", "fx_rate"], ["label", "名称", "汇率"], ["path", "接口路径", "/api/xxx/pageList.json"],
              ["dateMode", "日期模式", "range / none / current"], ["scopeMode", "范围", "store / global"],
              ["chunkDays", "分块天数", "7"], ["pageSize", "每页行数", "100"],
              ["rowsPath", "行路径", "data.rows（空=自动识别）"], ["idFields", "主键字段", "id,date（空=整行哈希）"],
              ["params", "参数模板", '{"pageNo":"${pageNo}","pageSize":"${pageSize}","shopId":"${shopId}","startDate":"${startDate}","endDate":"${endDate}"}'],
              ["historyFrom", "历史起点", "2026-08-17"],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key}><span>{label}</span>
                <input value={epForm[key]} placeholder={placeholder} onChange={(event) => setEpForm((current) => ({ ...current, [key]: event.target.value }))} />
              </label>
            ))}
            <label className="sf-check"><span>启用</span>
              <input type="checkbox" checked={epForm.enabled} onChange={(event) => setEpForm((current) => ({ ...current, enabled: event.target.checked }))} />
            </label>
            <button type="button" className="sf-btn" disabled={!canSync || busy !== "" || !epForm.code || !epForm.path} onClick={() => void saveEndpoint()}>{busy === "endpoint-save" ? "保存中" : "保存端点（自动纳入全量）"}</button>
          </div>
          <p className="sf-note">端点原始响应按行落到 SellfoxApiRecord（payload 原样保留，不猜字段、不补零）；行身份优先用配置的主键字段，缺失时用整行内容哈希保证幂等。保存后 Worker 自动从历史起点逐块回填，完成后每天重跑最近 7 天。点击「真实行数」可在端点原始行承接页逐行验收 payload。</p>
          {candidates.length ? (
            <details className="sf-note">
              <summary>待接入数据集的端点候选（{candidates.length} 个，来自已核对的真实只读接口）</summary>
              <p>这些数据集不需要各写同步器：把真实路径填入下方表单、按接口文档补齐请求参数后，编排器即可自动全量同步。候选只作参考，不自动注册、不猜参数名、默认不启用；写接口已剔除。</p>
              <div className="sf-table-scroll">
                <table>
                  <thead><tr>{["优先级", "候选 code", "数据集", "真实只读接口", "参数契约"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr key={candidate.code}>
                        <td className="sf-mono">{candidate.priority}</td>
                        <td className="sf-mono">{candidate.code}</td>
                        <td>{candidate.label}</td>
                        <td className="sf-mono sf-wrap">{candidate.paths.join(" · ")}</td>
                        <td className="sf-muted">{candidateDocSummary(candidate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>首跑顺序</h2>
            <span className="sf-muted">外键先行：后置数据集依赖前面的 storeId / sku / orderId。</span>
          </div>
          <ol className="sf-order">
            {syncFirstRunOrder.map((step, index) => (
              <li key={`${step.label}-${index}`}>
                <span className="sf-order-index">{index + 1}</span>
                <span className="sf-order-label">{step.label}</span>
                <span className="sf-muted">{step.reason}</span>
                {step.resource ? <code className="sf-mono">{step.resource}</code> : <span className="sf-state">未接入</span>}
              </li>
            ))}
          </ol>
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>同步分片（SellfoxSyncShard）</h2>
            <span className="sf-muted">资源 × 店铺 × 期间的最细断点；最近 30 条，重跑覆盖同一分片。</span>
          </div>
          <div className="sf-table-scroll">
            <table>
              <thead>
                <tr>{["资源", "范围", "期间", "状态", "行数", "断点", "更新时间"].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
              </thead>
              <tbody>
                {(data?.shards ?? []).length === 0 ? <tr><td colSpan={7}>尚无分片记录；下一次同步完成后自动写入。</td></tr> : null}
                {(data?.shards ?? []).map((shard) => (
                  <tr key={`${shard.resource}-${shard.scopeKey}-${shard.period}`}>
                    <td className="sf-mono">{shard.resource}</td>
                    <td className="sf-mono">{shard.scopeKey.startsWith("store:") ? (storeNameByExternalId.get(shard.scopeKey.slice(6)) ?? shard.scopeKey.slice(6)) : "全部店铺"}</td>
                    <td className="sf-mono">{shard.period}</td>
                    <td><span className={`sf-state sf-state-${shard.status}`}>{runStatusText[shard.status] ?? shard.status}</span></td>
                    <td className="sf-num">{n(shard.rows)}</td>
                    <td className="sf-mono sf-wrap">{shard.cursor ? JSON.stringify(shard.cursor) : "—"}</td>
                    <td className="sf-mono">{fmt(shard.finishedAt ?? shard.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>最近运行</h2>
            <span className="sf-muted">失败会保留错误信息；重试沿用同一批冻结日期。</span>
          </div>
          <div className="sf-table-scroll">
            <table>
              <thead>
                <tr>{["资源", "状态", "开始", "结束", "进度", "错误"].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
              </thead>
              <tbody>
                {(data?.runs ?? []).length === 0 ? <tr><td colSpan={6}>暂无运行记录。</td></tr> : null}
                {(data?.runs ?? []).map((run) => (
                  <tr key={run.id}>
                    <td className="sf-mono">{run.resource}</td>
                    <td><span className={`sf-state sf-state-${run.status}`}>{runStatusText[run.status] ?? run.status}</span></td>
                    <td className="sf-mono">{fmt(run.startedAt)}</td>
                    <td className="sf-mono">{fmt(run.finishedAt)}</td>
                    <td className="sf-num">{run.progress == null ? "—" : n(run.progress)}</td>
                    <td className="sf-wrap">{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>待接入 P0</h2>
            <span className="sf-muted">这些数据域还没有同步器或事实表，页面不会显示假数据。</span>
          </div>
          <table>
            <thead><tr><th scope="col">模块</th><th scope="col">数据集</th><th scope="col">接口</th><th scope="col">目标表</th><th scope="col">阻塞点</th></tr></thead>
            <tbody>
              {p0.length === 0 ? <tr><td colSpan={5}>P0 已全部接入。</td></tr> : null}
              {p0.map((item) => (
                <tr key={item.id}>
                  <td>{item.group}</td>
                  <td>{item.label}</td>
                  <td className="sf-mono sf-wrap">{item.api.join(" · ")}</td>
                  <td className="sf-mono">{item.table ?? "未定"}</td>
                  <td className="sf-wrap">{item.note ?? "待实现同步器"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="sf-note">
          分片断点已落到 SellfoxSyncShard（资源 × 店铺 × 期间），覆盖度落到 SellfoxCoverage（每次 run 完成后从事实表重算，不是累加）；
          运行中断点仍写在 SellfoxSyncRun.summary，完成后合并进分片。限流为「按接口 path 独立限速」，同一接口 ≥1.1 秒，不同接口并行。
        </p>
      </div>
    </section>
  );
}
