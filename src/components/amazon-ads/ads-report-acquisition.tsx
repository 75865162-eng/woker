"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw } from "lucide-react";

type ReportTypeRow = {
  reportType: string;
  label: string;
  reportTypeId: string;
  status: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  coveredFrom: string | null;
  coveredTo: string | null;
  publishedRows: number;
  activeTask: { id: string; status: string; stage: string; errorCode: string | null; nextAttemptAt: string } | null;
  latestVersion: { id: string; rowCount: number; publishedAt: string | null; requestedFrom: string | null; requestedTo: string | null } | null;
  warningCodes: string[];
};

type Overview = {
  mode: string;
  executionRole: string;
  oauthConfigured: boolean;
  reportTypes: Array<{ id: string; label: string; reportTypeId: string; groupBy: string[]; maxDays: number; retentionDays: number; docs: string }>;
  profiles: Array<{
    profile: { id: string; profileId: string; region: string; currencyCode: string | null; timezone: string | null; authorization: { name: string; status: string } };
    reportTypes: ReportTypeRow[];
    plan: { id: string; status: string; revision: number; reportLookbackDays: number; lastSuccessAt: string | null; lastErrorCode: string | null } | null;
  }>;
  error?: string;
};

const statusLabel: Record<string, string> = {
  CURRENT: "已更新", STALE: "过期", FAILED: "失败", RETRY_WAIT: "等待重试", SYNCING: "同步中", MISSING: "未采集", CANCELLED: "已取消",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

/** SP 五类绩效报表的实盘采集面板：状态、覆盖区间与手动触发。 */
export function AdsReportAcquisition() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/integrations/amazon/ads/reports", { cache: "no-store", signal });
      const body = await response.json() as Overview;
      if (!response.ok) throw new Error(body.error || `读取失败（${response.status}）`);
      setData(body);
      setError("");
      setSelected(previous => previous || body.profiles[0]?.profile.id || "");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "无法读取报表采集状态。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function sync(profileId: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/integrations/amazon/ads/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync", profileId }),
      });
      const body = await response.json() as { tasks?: Array<{ reportType: string; created: boolean }>; enqueued?: number; executionRole?: string; error?: string };
      if (!response.ok) throw new Error(body.error || `触发失败（${response.status}）`);
      const created = body.tasks?.filter(task => task.created).length ?? 0;
      setMessage(`已提交 ${body.tasks?.length ?? 0} 类报表（新建 ${created}），入队 ${body.enqueued ?? 0} 个；执行角色 ${body.executionRole ?? "unknown"}。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "触发报表同步失败。");
    } finally {
      setBusy(false);
    }
  }

  const current = data?.profiles.find(row => row.profile.id === selected) ?? data?.profiles[0] ?? null;

  return <section className="ads-report-panel" aria-label="SP 绩效报表采集">
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <strong>SP 绩效报表采集（5 类）</strong>
      <span>模式 {data?.mode ?? "—"} · 执行角色 {data?.executionRole ?? "—"} · LWA {data?.oauthConfigured ? "已配置" : "未配置"}</span>
      <button type="button" className="ads-synced-refresh" onClick={() => void load()} disabled={loading} aria-label="刷新报表采集状态"><RefreshCw size={14} /></button>
    </div>
    {error && <span role="alert">读取失败：{error}</span>}
    {message && <span role="status">{message}</span>}
    {data && !data.profiles.length && <span>尚未连接任何 Ads Profile。先在「Ads 账号授权」完成 OAuth，报表采集会在计划激活后自动按日运行。</span>}
    {current && <>
      <div className="ads-synced-toolbar">
        <label>Profile
          <select aria-label="报表采集 Profile" value={current.profile.id} onChange={event => setSelected(event.target.value)}>
            {data!.profiles.map(row => <option key={row.profile.id} value={row.profile.id}>{row.profile.profileId} · {row.profile.currencyCode ?? "未知币种"} · {row.profile.region}</option>)}
          </select>
        </label>
        <span>计划 {current.plan?.status ?? "无"} · 回看 {current.plan?.reportLookbackDays ?? "—"} 天 · 最近成功 {formatTime(current.plan?.lastSuccessAt ?? null)}</span>
        <button type="button" className="ads-synced-refresh" onClick={() => void sync(current.profile.id)} disabled={busy} title="立即同步五类报表">
          <Play size={14} /> {busy ? "提交中…" : "立即同步五类"}
        </button>
      </div>
      <div className="ads-table-scroll">
        <table className="ads-simple-table">
          <thead><tr>{["报表类型", "reportTypeId", "状态", "覆盖区间", "已发布行数", "最近成功", "任务", "备注"].map(head => <th key={head}>{head}</th>)}</tr></thead>
          <tbody>
            {current.reportTypes.map(row => <tr key={row.reportType}>
              <td>{row.label}</td>
              <td>{row.reportTypeId}</td>
              <td>{statusLabel[row.status] ?? row.status}</td>
              <td>{row.latestVersion ? `${row.latestVersion.requestedFrom ?? "—"} — ${row.latestVersion.requestedTo ?? "—"}` : "—"}</td>
              <td>{row.publishedRows}</td>
              <td>{formatTime(row.lastSuccessAt)}</td>
              <td>{row.activeTask ? `${row.activeTask.status}/${row.activeTask.stage}` : "—"}</td>
              <td>{row.warningCodes.length ? row.warningCodes.join(", ") : "—"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </>}
  </section>;
}
