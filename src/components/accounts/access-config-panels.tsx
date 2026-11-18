"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClass } from "./account-workbench-api";

type ApprovalRow = { type: string; min: string | null; max: string | null; actions: string[] };
type PointsRow = { roleId: string; roleName: string; quota: string | null; maxRequestAmount: string | null; maxRequestsPerPeriod: number | null };
type McpTool = { provider: string; name: string; authorized: boolean };

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

const APPROVAL_LABELS: Record<string, string> = {
  purchase_payment: "采购付款",
  purchase_refund: "采购退款",
  wms_inbound: "仓库入库",
  wms_count: "仓库盘点",
  agent_change: "Agent 变更",
};

/** 审批矩阵 + 积分模板 + MCP 授权三块组织级配置（文档 P2）。仅 owner/database_admin 可编辑。 */
export function AccessConfigPanels({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <ApprovalPanel canEdit={canEdit} />
      <PointsPanel canEdit={canEdit} />
      <McpPanel canEdit={canEdit} />
    </div>
  );
}

function ApprovalPanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [revision, setRevision] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await readJson<{ rows: ApprovalRow[]; revision: string }>("/api/accounts/approvals");
    if (!data) return;
    setRows(data.rows);
    setRevision(data.revision);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<ApprovalRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function addRow() {
    setRows((current) => [...current, { type: "purchase_payment", min: "0", max: "5000", actions: ["approve", "reject"] }]);
  }
  async function save() {
    setMessage("");
    const res = await fetch("/api/accounts/approvals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, expectedRevision: revision }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setMessage(body.error ?? "保存失败");
      if (res.status === 409) void load();
      return;
    }
    setMessage("已保存");
    void load();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between px-3 py-2.5">
        <div><CardTitle className="text-section">审批矩阵</CardTitle><p className="mt-0.5 text-xs text-muted">按单据类型 × 金额区间分级（单人审批）</p></div>
        {canEdit ? <Button size="sm" variant="secondary" className="h-7 px-2" onClick={addRow}><Plus className="h-3.5 w-3.5" /></Button> : null}
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {!canEdit ? <ReadOnlyHint /> : null}
        {rows.map((row, index) => (
          <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <select className={`${fieldClass} h-8 py-0`} value={row.type} disabled={!canEdit} onChange={(e) => update(index, { type: e.target.value })}>
                {Object.entries(APPROVAL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              {canEdit ? <button type="button" onClick={() => setRows((cur) => cur.filter((_, i) => i !== index))} className="rounded p-1 text-muted hover:text-danger-ink"><Trash2 className="h-3.5 w-3.5" /></button> : null}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${fieldClass} h-8 py-0`} value={row.min ?? ""} disabled={!canEdit} placeholder="最小金额" onChange={(e) => update(index, { min: e.target.value || null })} />
              <input className={`${fieldClass} h-8 py-0`} value={row.max ?? ""} disabled={!canEdit} placeholder="最大金额(不含)" onChange={(e) => update(index, { max: e.target.value || null })} />
            </div>
            <div className="flex gap-1">
              {["approve", "reject", "delegate"].map((action) => (
                <button key={action} type="button" disabled={!canEdit} onClick={() => {
                  const next = row.actions.includes(action) ? row.actions.filter((a) => a !== action) : [...row.actions, action];
                  update(index, { actions: next });
                }} className={`rounded border px-1.5 py-0.5 text-xs ${row.actions.includes(action) ? "border-brand bg-brand text-white" : "border-border text-muted"}`}>
                  {({ approve: "通过", reject: "驳回", delegate: "转交" } as Record<string, string>)[action]}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!rows.length ? <p className="py-6 text-center text-sm text-muted">尚未配置审批区间</p> : null}
        {message ? <p className="text-xs font-medium text-success-ink">{message}</p> : null}
        {canEdit && rows.length ? <Button size="sm" onClick={() => void save()}><Save className="h-3.5 w-3.5" />保存审批矩阵</Button> : null}
      </CardContent>
    </Card>
  );
}

function PointsPanel({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<PointsRow[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const data = await readJson<{ rows: PointsRow[] }>("/api/accounts/points/templates");
    if (data) setRows(data.rows);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update(index: number, patch: Partial<PointsRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  async function save() {
    setMessage("");
    const res = await fetch("/api/accounts/points/templates", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setMessage(res.ok ? "已保存" : "保存失败");
    void load();
  }

  return (
    <Card>
      <CardHeader className="px-3 py-2.5">
        <CardTitle className="text-section">积分角色模板</CardTitle>
        <p className="mt-0.5 text-xs text-muted">生效顺序：成员覆盖 &gt; 角色模板 &gt; 组织默认</p>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {!canEdit ? <ReadOnlyHint /> : null}
        {rows.map((row, index) => (
          <div key={row.roleId} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-center justify-between"><span className="text-sm font-bold text-foreground">{row.roleName}</span><Badge tone="gray">{row.roleId}</Badge></div>
            <div className="grid grid-cols-3 gap-1">
              <label className="text-xs text-muted">额度<input className={`${fieldClass} h-8 py-0`} value={row.quota ?? ""} disabled={!canEdit} placeholder="300" onChange={(e) => update(index, { quota: e.target.value || null })} /></label>
              <label className="text-xs text-muted">单次上限<input className={`${fieldClass} h-8 py-0`} value={row.maxRequestAmount ?? ""} disabled={!canEdit} placeholder="字符串" onChange={(e) => update(index, { maxRequestAmount: e.target.value || null })} /></label>
              <label className="text-xs text-muted">月次数<input className={`${fieldClass} h-8 py-0`} type="number" value={row.maxRequestsPerPeriod ?? ""} disabled={!canEdit} onChange={(e) => update(index, { maxRequestsPerPeriod: e.target.value ? Number(e.target.value) : null })} /></label>
            </div>
          </div>
        ))}
        {!rows.length ? <p className="py-6 text-center text-sm text-muted">没有角色</p> : null}
        {message ? <p className="text-xs font-medium text-success-ink">{message}</p> : null}
        {canEdit && rows.length ? <Button size="sm" onClick={() => void save()}><Save className="h-3.5 w-3.5" />保存积分模板</Button> : null}
      </CardContent>
    </Card>
  );
}

function McpPanel({ canEdit }: { canEdit: boolean }) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [revision, setRevision] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const data = await readJson<{ tools: McpTool[]; revision: string }>("/api/accounts/mcp/scopes");
    if (!data) return;
    setTools(data.tools);
    setRevision(data.revision);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setMessage("");
    const res = await fetch("/api/accounts/mcp/scopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tools, expectedRevision: revision }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setMessage(body.error ?? "保存失败");
      if (res.status === 409) void load();
      return;
    }
    setMessage("已保存");
    void load();
  }

  return (
    <Card>
      <CardHeader className="px-3 py-2.5">
        <CardTitle className="text-section">MCP 工具授权</CardTitle>
        <p className="mt-0.5 text-xs text-muted">按 provider 物理隔离，勾选后与凭据 tools 取交集</p>
      </CardHeader>
      <CardContent className="space-y-2 p-3">
        {!canEdit ? <ReadOnlyHint /> : null}
        {(["amazon", "sellfox"] as const).map((provider) => (
          <div key={provider} className="space-y-1">
            <p className="text-xs font-bold uppercase text-muted">{provider}</p>
            {tools.filter((t) => t.provider === provider).map((tool) => (
              <label key={`${tool.provider}:${tool.name}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                <span className="truncate text-foreground">{tool.name}</span>
                <input type="checkbox" className="h-4 w-4 accent-brand" disabled={!canEdit} checked={tool.authorized} onChange={(e) => setTools((cur) => cur.map((t) => (t.provider === tool.provider && t.name === tool.name ? { ...t, authorized: e.target.checked } : t)))} />
              </label>
            ))}
          </div>
        ))}
        {!tools.length ? <p className="py-6 text-center text-sm text-muted">没有可配置的工具</p> : null}
        {message ? <p className="text-xs font-medium text-success-ink">{message}</p> : null}
        {canEdit && tools.length ? <Button size="sm" onClick={() => void save()}><Save className="h-3.5 w-3.5" />保存 MCP 授权</Button> : null}
      </CardContent>
    </Card>
  );
}

function ReadOnlyHint() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs text-warning-ink">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>仅 owner / database_admin 可编辑授权，当前为只读。</span>
    </div>
  );
}
