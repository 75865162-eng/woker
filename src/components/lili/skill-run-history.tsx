"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpProse } from "@/components/help/help-prose";
import { extHeaders } from "@/lib/workspace/ext-headers";
import { tx, type Locale } from "@/lib/lili/tx";

type RunSummary = {
  id: string;
  slug: string;
  skillName: string;
  exportFormat: "xlsx" | "docx";
  fileName: string;
  status: string;
  marketplace: string;
  createdAt: string;
  finishedAt: string | null;
};

type RunDetail = RunSummary & {
  title: string;
  markdown: string;
  notes: string[];
  rowCount: number;
  model: string;
  provider: string;
  inputs: Record<string, string>;
  errorCode?: string;
  errorMessage?: string;
};

type HistoryResponse = { runs: RunSummary[]; page: number; pageSize: number; hasNext: boolean; persisted: boolean; message?: string; error?: string };

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function SkillRunHistory({ locale }: { locale: Locale }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [active, setActive] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/skills/runs?page=${page}&pageSize=20`, { headers: extHeaders(), cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as HistoryResponse;
      if (!response.ok) throw new Error(data.error || `读取历史失败（HTTP ${response.status}）。`);
      setRuns(data.runs ?? []);
      setHasNext(Boolean(data.hasNext));
      setMessage(data.message ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取历史失败。");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setActive(null);
    try {
      const response = await fetch(`/api/skills/runs/${encodeURIComponent(id)}`, { headers: extHeaders(), cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as RunDetail & { error?: string };
      if (!response.ok) throw new Error(data.error || "读取详情失败。");
      setActive(data);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "读取详情失败。");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // 支持从运行页失败提示带 ?run=<id> 直达详情。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const runId = new URLSearchParams(window.location.search).get("run");
    if (runId && /^[a-zA-Z0-9_-]{1,80}$/.test(runId)) void openDetail(runId);
  }, [openDetail]);

  return (
    <section className="lili-card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{tx(locale, "运行历史", "Run history")}</h2>
          <p className="text-sm text-muted">{tx(locale, "运行过的技能报告保存在这里，可随时回看与下载。", "Reports you ran are saved here for review and download.")}</p>
        </div>
        <button className="lili-btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {tx(locale, "刷新", "Refresh")}
        </button>
      </div>

      {error && <Alert tone="danger" title={tx(locale, "读取失败", "Load failed")} description={error} />}
      {message && <p className="text-sm text-muted">{message}</p>}

      {!loading && runs.length === 0 && !error ? (
        <p className="text-sm text-muted">
          {tx(locale, "还没有运行记录。到「技能」页选一个技能，点右侧「运行」开始。", "No runs yet. Pick a skill under Skills and click Run.")}{" "}
          <Link className="underline" href="/lili/v2/skills">{tx(locale, "去技能目录", "Browse skills")}</Link>
        </p>
      ) : null}

      <div className="grid gap-2">
        {runs.map((run) => (
          <div key={run.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
            {run.exportFormat === "xlsx"
              ? <FileSpreadsheet className="h-5 w-5 shrink-0 text-brand" />
              : <FileText className="h-5 w-5 shrink-0 text-brand" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{run.skillName || run.slug}</p>
              <p className="text-xs text-muted">
                {run.marketplace ? `${run.marketplace} · ` : ""}{formatTime(run.createdAt)}
                {run.status ? ` · ${run.status}` : ""}
              </p>
            </div>
            {run.status === "FAILED" ? (
              <Badge tone="danger">{tx(locale, "失败", "Failed")}</Badge>
            ) : (
              <Badge tone="info">{run.exportFormat.toUpperCase()}</Badge>
            )}
            <button className="lili-btn-ghost" onClick={() => void openDetail(run.id)} disabled={detailLoading}>
              {tx(locale, "回看", "Review")}
            </button>
            {run.status === "FAILED" ? null : (
              <a href={`/api/skills/runs/${encodeURIComponent(run.id)}/document`} download={run.fileName}>
                <Button variant="secondary"><Download className="h-4 w-4" /> {tx(locale, "下载", "Download")}</Button>
              </a>
            )}
          </div>
        ))}
      </div>

      {runs.length > 0 && (page > 1 || hasNext) ? (
        <div className="flex items-center gap-3">
          <button className="lili-btn-ghost" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{tx(locale, "上一页", "Previous")}</button>
          <span className="text-sm text-muted">{page}</span>
          <button className="lili-btn-ghost" disabled={!hasNext} onClick={() => setPage((value) => value + 1)}>{tx(locale, "下一页", "Next")}</button>
        </div>
      ) : null}

      {active ? (
        <div className="mt-3 rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{active.title || active.skillName}</h3>
            <button className="lili-btn-ghost" onClick={() => setActive(null)}>{tx(locale, "收起", "Close")}</button>
          </div>
          <p className="mb-3 text-xs text-muted">
            {active.model ? `${active.provider ?? ""} ${active.model} · ` : ""}{tx(locale, "数据行数", "Rows")}: {active.rowCount}
          </p>
          {active.status === "FAILED" ? (
            <div className="space-y-2">
              <Alert tone="danger" title={active.errorCode || "RUN_FAILED"} description={active.errorMessage || tx(locale, "本次运行失败。", "This run failed.")} />
              <p className="text-xs text-muted">{tx(locale, "失败原因已如实记录，未生成报告或下载文件。", "The failure is recorded as-is; no report or download was produced.")}</p>
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] overflow-auto"><HelpProse markdown={active.markdown} /></div>
              {active.notes?.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">{active.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
              ) : null}
              <div className="mt-3">
                <a href={`/api/skills/runs/${encodeURIComponent(active.id)}/document`} download={active.fileName}>
                  <Button><Download className="h-4 w-4" /> {tx(locale, "下载", "Download")} {active.exportFormat.toUpperCase()}</Button>
                </a>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
