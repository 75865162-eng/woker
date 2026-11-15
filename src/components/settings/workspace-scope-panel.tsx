"use client";

import { useEffect, useState } from "react";
import { BriefcaseBusiness, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { isWorkspaceScopeComplete } from "@/lib/workspace/scope";
import { fetchWorkspacesCached, invalidateWorkspaceApiCache, saveWorkspaceScope } from "@/lib/workspace/workspace-api-cache";

type WorkspaceScope = {
  id: string;
  name: string;
  accountId: string;
  marketplace: string;
  isDefault: boolean;
  updatedAt: string;
};

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";

export function WorkspaceScopePanel() {
  const [workspaces, setWorkspaces] = useState<WorkspaceScope[]>([]);
  const [form, setForm] = useState({ workspaceId: "", name: "", accountId: "", marketplace: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalWorkspaces = workspaces.length;
  const defaultCount = workspaces.filter((workspace) => workspace.isDefault).length;
  const incompleteCount = workspaces.filter((workspace) => !workspace.accountId || !workspace.marketplace).length;
  const canSave = isWorkspaceScopeComplete({
    workspaceId: form.workspaceId,
    accountId: form.accountId,
    marketplace: form.marketplace,
  });

  async function loadWorkspaces() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchWorkspacesCached({ force: true });
      setWorkspaces(
        Array.isArray(data.workspaces)
          ? data.workspaces.map((workspace) => ({
              id: workspace.id,
              name: workspace.name,
              accountId: workspace.accountId ?? "",
              marketplace: workspace.marketplace ?? "",
              isDefault: Boolean(workspace.isDefault),
              updatedAt: workspace.updatedAt ?? new Date().toISOString(),
            }))
          : [],
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "工作区读取失败。");
    } finally {
      setLoading(false);
    }
  }

  async function saveWorkspace() {
    if (!form.workspaceId.trim()) {
      setError("请填写 workspaceId。");
      return;
    }

    if (!canSave) {
      setError("请补齐 accountId 和 marketplace 后再保存。");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await saveWorkspaceScope(form);

      setForm({ workspaceId: "", name: "", accountId: "", marketplace: "" });
      invalidateWorkspaceApiCache();
      await loadWorkspaces();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "工作区保存失败。");
    } finally {
      setSaving(false);
    }
  }

  function editWorkspace(workspace: WorkspaceScope) {
    setForm({
      workspaceId: workspace.id,
      name: workspace.name,
      accountId: workspace.accountId,
      marketplace: workspace.marketplace,
    });
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  const workspaceColumns: DataTableColumn<WorkspaceScope>[] = [
    { key: "workspace", header: "Workspace", render: (workspace) => (<><p className="font-bold text-foreground">{workspace.name}</p><p className="text-xs font-medium text-muted">{workspace.id}</p></>) },
    { key: "account", header: "账号", render: (workspace) => workspace.accountId || "-" },
    { key: "marketplace", header: "站点", render: (workspace) => workspace.marketplace || "-" },
    { key: "status", header: "状态", render: (workspace) => <Badge tone={!workspace.accountId || !workspace.marketplace ? "amber" : workspace.isDefault ? "green" : "blue"}>{!workspace.accountId || !workspace.marketplace ? "待补齐" : workspace.isDefault ? "默认" : "已启用"}</Badge> },
    { key: "updatedAt", header: "更新时间", render: (workspace) => <span className="text-xs text-muted">{new Date(workspace.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span> },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
              <BriefcaseBusiness className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Workspace / 账号 / 站点</CardTitle>
            </div>
          </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="blue">工作区 {totalWorkspaces}</Badge>
          <Badge tone={defaultCount ? "green" : "amber"}>默认 {defaultCount}</Badge>
          <Badge tone={incompleteCount ? "amber" : "green"}>待补齐 {incompleteCount}</Badge>
          <Button variant="secondary" size="sm" onClick={() => void loadWorkspaces()} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        {error ? <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink">{error}</div> : null}
        {incompleteCount ? (
          <div className="rounded-md border border-warning-ink/30 bg-warning-soft px-3 py-2 text-sm font-semibold text-warning-ink">
            有 {incompleteCount} 个工作区缺少账号或站点信息，导入和归属时容易产生混淆。
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_96px_auto]">
          <input className={fieldClass} value={form.workspaceId} placeholder="workspaceId，例如 us-main" onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))} />
          <input className={fieldClass} value={form.name} placeholder="显示名称" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <input className={fieldClass} value={form.accountId} placeholder="Amazon accountId" onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))} />
          <input className={fieldClass} value={form.marketplace} placeholder="US" onChange={(event) => setForm((current) => ({ ...current, marketplace: event.target.value }))} />
          <Button onClick={() => void saveWorkspace()} disabled={saving || !canSave}>
            <Plus className="h-4 w-4" />
            保存
          </Button>
        </div>

        <StandardDataTable
          ariaLabel="Workspace 列表"
          rows={workspaces}
          getRowKey={(workspace) => workspace.id}
          columns={workspaceColumns}
          onRowClick={(workspace) => editWorkspace(workspace)}
          empty={loading ? "正在读取工作区..." : "暂无工作区，先建立一个默认 Workspace 作为组织边界。"}
        />
      </CardContent>
    </Card>
  );
}
