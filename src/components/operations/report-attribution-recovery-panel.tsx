"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { readReportAttributionPreview } from "@/lib/amazon-sync/report-attribution-recovery";

type Preview = Awaited<ReturnType<typeof readReportAttributionPreview>>;

export function ReportAttributionRecoveryPanel({ sourceId, sellerName, marketplaceId, busy, requestHeaders, requestApproval, openApprovals }: {
  sourceId: string; sellerName: string; marketplaceId: string; busy: boolean;
  requestHeaders: () => Headers; requestApproval: (command: Record<string, unknown>) => Promise<boolean>; openApprovals: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(""), [submitted, setSubmitted] = useState(false), [working, setWorking] = useState(false);
  const generation = useRef(0), controller = useRef<AbortController | null>(null), workspace = useRef("");
  function invalidate() { generation.current++; controller.current?.abort(); controller.current = null; setPreview(null); setSubmitted(false); setError(""); setWorking(false); }
  useEffect(() => {
    const sequence = generation, pending = controller;
    const reset = () => invalidate();
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => { sequence.current++; pending.current?.abort(); window.removeEventListener(workspaceScopeChangedEventName, reset); };
  }, [sourceId]);
  async function loadPreview() {
    invalidate();
    const current = generation.current, abort = new AbortController(), headers = requestHeaders();
    controller.current = abort; workspace.current = headers.get("x-workspace-id") ?? ""; setWorking(true);
    try {
      const params = new URLSearchParams({ section: "report-attribution-preview", sourceId });
      const response = await fetch(`/api/operations/sync-center?${params}`, { headers, cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(body.error ?? "报告归属预览失败。");
      if (workspace.current !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
      setPreview(body);
    } catch (cause) {
      if (current === generation.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : "报告归属预览失败。");
    } finally { if (current === generation.current) setWorking(false); }
  }
  async function submit() {
    if (!preview || preview.manifest.documents.length === 0 || busy || working) return;
    if (workspace.current !== (requestHeaders().get("x-workspace-id") ?? "")) { invalidate(); return; }
    const current = generation.current;
    setWorking(true); setError("");
    try {
      const accepted = await requestApproval(preview.command);
      if (current !== generation.current) return;
      setPreview(null); setSubmitted(accepted);
      if (!accepted) setError("审批申请未提交，请重新预览并检查页面提示。");
    } catch (cause) { if (current === generation.current) { setPreview(null); setError(cause instanceof Error ? cause.message : "审批申请未提交，请重新预览。"); } }
    finally { if (current === generation.current) setWorking(false); }
  }
  const archivedRows = preview?.manifest.documents.reduce((sum, document) => sum + document.rowCount, 0) ?? 0;
  return <section aria-label="报告站点归属恢复" className="space-y-3 rounded border border-border p-4">
    <h3 className="text-sm font-semibold">报告站点归属恢复</h3>
    <p className="text-xs text-muted">{sellerName} / {marketplaceId} · 仅对已归档报告逐行核验站点。无法证明归属的行继续隔离；此操作不会重新请求 Amazon 报告。</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={busy || working} onClick={() => void loadPreview()}>预览归属核验</Button>
      {submitted && <Button size="sm" variant="secondary" onClick={openApprovals}>查看变更审批</Button>}
    </div>
    {preview && <div className="space-y-2 text-xs">
      <p>待核验 {preview.manifest.documents.length} 份报告，共 {archivedRows} 行；来源版本 {preview.manifest.revision}，授权版本 {preview.manifest.authorizationRevision}。</p>
      <p className="text-muted">清单摘要 {preview.recoveryDigest} · 预览不写入数据、不包含报告原文。提交后须经审批，再由执行边界重新核验清单。</p>
      <Button size="sm" disabled={busy || working || preview.manifest.documents.length === 0} onClick={() => void submit()}>提交归属恢复审批</Button>
    </div>}
    {working && <p role="status" className="text-xs text-muted">正在检查归属恢复条件…</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </section>;
}
