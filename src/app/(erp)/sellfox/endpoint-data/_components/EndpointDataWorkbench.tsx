"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SellfoxTabs } from "@/components/sellfox/sellfox-nav";

/**
 * 泛化端点同步的原始行承接页。
 * 任何后台配置的赛狐 API 端点，数据落到 SellfoxApiRecord 后都能在这里按端点验收，
 * 不需要为 28+ 个待接入数据集各写一个页面。口径与 host 快照页严格分开。
 */
type Row = {
  id: string; externalId: string; scopeKey: string; period: string;
  storeId: string | null; syncedAt: string; payload: unknown;
};
type Result = {
  endpoint: { code: string; label: string; path: string; rowsPath: string; scopeMode: string; dateMode: string };
  rows: Row[]; total: number;
  pagination: { page: number; pageSize: number; total: number; pageCount: number; hasNext: boolean };
  disclosure: { source: string; dataClass: string; warnings: string[] };
};

export function EndpointDataWorkbench() {
  const [code, setCode] = useState("");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCode(new URLSearchParams(window.location.search).get("code") ?? "");
  }, []);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ code, page: String(page), pageSize: "20" });
      if (period) params.set("period", period);
      const response = await fetch(`/api/sellfox/endpoint-records?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "读取端点原始行失败。");
      setResult(payload);
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : "读取端点原始行失败。");
    } finally { setLoading(false); }
  }, [code, page, period]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <SellfoxTabs current="" />
      <div className="sellfox-ui">
        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>原始响应口径</h2>
            <Link className="sf-btn" href="/sellfox/sync">返回同步控制台</Link>
          </div>
          <p className="sf-note">
            payload 是赛狐接口原始行：未知字段原样保留，不猜字段、不补零、不做金额换算；数值精度以 JSONB 落库时为准，缺字段不代表业务为零。
            同一业务键重复同步会 upsert 覆盖，此表不保留历史版本。与赛狐已发布快照口径、Amazon 承接池数据不可直接相加混算。
          </p>
          {result ? (
            <p className="sf-note">
              端点 <strong>{result.endpoint.label}</strong>（<code className="sf-mono">{result.endpoint.code}</code>） ·
              接口 <code className="sf-mono">{result.endpoint.path}</code> ·
              {result.endpoint.scopeMode} / {result.endpoint.dateMode} ·
              共 <strong>{result.total.toLocaleString("zh-CN")}</strong> 行
            </p>
          ) : null}
        </div>

        <div className="sf-panel">
          <div className="sf-panel-head">
            <h2>原始行</h2>
            <div>
              <input aria-label="按期间筛选" placeholder="期间（如 2026-11-01..2026-11-07）" value={period}
                onChange={(event) => { setPeriod(event.target.value); setPage(1); }} style={{ minWidth: 240 }} />
              <button type="button" className="sf-btn" onClick={() => { setPage(1); void load(); }} disabled={loading}>刷新</button>
            </div>
          </div>
          {error ? <p className="sf-note">{error}</p> : null}
          {!code ? <p className="sf-note">请在同步控制台点击某个端点的「真实行数」进入本页。</p> : null}
          {loading ? <p className="sf-note">读取中…</p> : null}
          {result && !result.rows.length ? (
            <p className="sf-note">该端点在租户范围内尚无落库原始行（已同步无数据 / 尚未同步），不补造占位行。</p>
          ) : null}
          {result && result.rows.length ? (
            <div className="sf-table-scroll">
              <table>
                <thead><tr>{["期间", "店铺 / 范围", "行身份", "同步时间", "原始响应"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map(row => (
                    <Fragment key={row.id}>
                      <tr>
                        <td className="sf-mono">{row.period}</td>
                        <td className="sf-mono sf-wrap">{row.storeId ?? row.scopeKey}</td>
                        <td className="sf-mono sf-wrap">{row.externalId}</td>
                        <td className="sf-mono">{new Date(row.syncedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                        <td>
                          <button type="button" className="sf-btn" onClick={() => setExpanded(current => current === row.id ? null : row.id)}>
                            {expanded === row.id ? "收起" : "查看 payload"}
                          </button>
                        </td>
                      </tr>
                      {expanded === row.id ? (
                        <tr>
                          <td colSpan={5}><pre className="sf-wrap sf-mono" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>{JSON.stringify(row.payload, null, 2)}</pre></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {result ? (
            <div className="sf-panel-head" style={{ marginTop: 12 }}>
              <span className="sf-muted">第 {result.pagination.page} / {Math.max(1, result.pagination.pageCount)} 页 · 每页 {result.pagination.pageSize} 行</span>
              <div>
                <button type="button" className="sf-btn" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>上一页</button>
                <button type="button" className="sf-btn" disabled={!result.pagination.hasNext || loading} onClick={() => setPage(current => current + 1)}>下一页</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
