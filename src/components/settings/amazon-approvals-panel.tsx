"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { getJson } from "@/lib/workspace/get-json";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";

const base = "/api/operations/sync-center";

function headers() {
  const h = new Headers();
  try { const s = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}"); h.set("x-workspace-id", s.workspaceId || "default"); } catch { h.set("x-workspace-id", "default"); }
  return h;
}

const stamp = (s: string | null | undefined) => s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";

const statusLabels: Record<string, string> = { REQUESTED: "待批准", APPROVED: "已批准待应用", REJECTED: "已拒绝", REVOKED: "已撤销", APPLIED: "已应用", FAILED: "失败" };
const statusTones: Record<string, BadgeTone> = { REQUESTED: "amber", APPROVED: "blue", REJECTED: "neutral", REVOKED: "neutral", APPLIED: "green", FAILED: "red" };

type Approval = {
  id: string; targetEnvironment: string; changeType: string; operation: string; targetId: string;
  beforeSummary: unknown; afterSummary: unknown; sellerIds: string[]; marketplaceIds: string[];
  domains: string[]; sourceIds: string[]; baseRevision: number; changeDigest: string;
  requestedByUserId: string; approvedByUserId: string | null; status: string;
  expiresAt: string; appliedAt: string | null; createdAt: string;
};
type Access = { canApprove?: boolean; canConfigure?: boolean; canEdit?: boolean; canCreate?: boolean };
type Payload = { requests?: Approval[]; access?: Access; error?: string };

export function AmazonApprovalsPanel() {
  const [requests, setRequests] = useState<Approval[]>([]);
  const [access, setAccess] = useState<Access>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const seq = useRef(0), mutation = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current; setLoading(true); setError("");
    try {
      const { ok, data } = await getJson<Payload>(`${base}?section=approvals`, { headers: headers() });
      if (n !== seq.current) return;
      if (!ok) throw new Error(data.error ?? "变更审批读取失败。");
      setRequests(data.requests ?? []);
      setAccess(data.access ?? {});
    } catch (e) {
      if (n === seq.current) { setRequests([]); setError(e instanceof Error ? e.message : "读取失败。"); }
    } finally { if (n === seq.current) setLoading(false); }
  }, []);

  const invalidate = useCallback(() => { ++seq.current; ++mutation.current; }, []);
  useEffect(() => {
    void load();
    const changed = () => { void load(); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => { invalidate(); window.removeEventListener(workspaceScopeChangedEventName, changed); };
  }, [load, invalidate]);

  async function decide(id: string, decision: "APPROVED" | "REJECTED" | "REVOKED" | "APPLY") {
    const n = ++mutation.current; setBusy(true); setError(""); setNotice("");
    try {
      const h = headers(); h.set("content-type", "application/json");
      const response = await fetch(`${base}/approvals`, { method: "POST", headers: h, body: JSON.stringify({ id, decision }) });
      const p = await response.json();
      if (n !== mutation.current) return;
      if (!response.ok) throw new Error(p.error ?? "审批操作失败。");
      setNotice(decision === "APPLY" ? "已应用本次批准变更。" : decision === "APPROVED" ? "已批准；尚未应用。" : decision === "REJECTED" ? "已拒绝。" : "已撤销批准。");
      await load();
    } catch (e) {
      if (n === mutation.current) {
        const message = e instanceof Error ? e.message : "审批操作失败。";
        if (decision === "APPLY") await load();
        if (n === mutation.current) setError(message);
      }
    } finally { if (n === mutation.current) setBusy(false); }
  }

  return (
    <section id="amazon-approvals" className="scroll-mt-4 space-y-3 rounded-lg border border-border bg-surface p-5" data-testid="settings-amazon-approvals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">变更审批</h2>
          <p className="mt-1 text-xs text-muted">Amazon 配置变更需先批准、再应用，这是两个独立步骤。请核对下方脱敏摘要后操作。与运营中心“变更审批”为同一审批流。</p>
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" />刷新</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      {notice && <p role="status" className="text-sm text-brand">{notice}</p>}
      {loading ? <p role="status" className="py-6 text-center text-sm text-muted">正在读取变更请求…</p> : (
        <div className="space-y-3">
          {requests.map(item => (
            <article key={item.id} className="rounded-md border border-border p-3" data-testid="amazon-change-request">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{item.changeType} · {item.operation}</strong>
                    <Badge className="rounded px-1.5 py-0 text-label font-medium border-transparent" tone={statusTones[item.status] ?? "neutral"}>{statusLabels[item.status] ?? item.status}</Badge>
                    <span className="text-xs text-muted">{item.targetEnvironment} · 修订 {item.baseRevision} · 到期 {stamp(item.expiresAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Seller {item.sellerIds.join(", ") || "—"} · Marketplace {item.marketplaceIds.join(", ") || "—"} · 域 {item.domains.join(", ") || "—"} · 数据源 {item.sourceIds.join(", ") || "—"}</p>
                  <p className="mt-1 break-all font-mono text-label text-muted">SHA-256 {item.changeDigest}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.status === "REQUESTED" && access.canApprove && <>
                    <Button size="sm" disabled={busy} onClick={() => void decide(item.id, "APPROVED")}>批准</Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(item.id, "REJECTED")}>拒绝</Button>
                  </>}
                  {item.status === "APPROVED" && access.canApprove && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(item.id, "REVOKED")}>撤销批准</Button>}
                  {item.status === "APPROVED" && <Button size="sm" variant="secondary" disabled={busy || (!access.canConfigure && !access.canEdit && !access.canCreate)} onClick={() => void decide(item.id, "APPLY")}>应用已批准变更</Button>}
                </div>
              </div>
              {item.status === "FAILED" && item.operation === "validate-authorization" && <p role="alert" className="mt-3 text-xs text-danger-ink">本次授权验证已失败，不能重复应用。请核对或更新凭证后重新申请验证。</p>}
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="min-w-0"><p className="mb-1 text-label text-muted">变更前（脱敏）</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 text-label">{JSON.stringify(item.beforeSummary, null, 2)}</pre></div>
                <div className="min-w-0"><p className="mb-1 text-label text-muted">拟变更（脱敏）</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-2 text-label">{JSON.stringify(item.afterSummary, null, 2)}</pre></div>
              </div>
            </article>
          ))}
          {!requests.length && <p className="py-8 text-center text-sm text-muted">当前工作区没有待处理的变更请求。</p>}
        </div>
      )}
    </section>
  );
}
