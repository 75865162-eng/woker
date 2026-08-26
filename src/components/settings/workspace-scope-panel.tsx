"use client";

import { useEffect, useState } from "react";
import { BriefcaseBusiness, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WorkspaceScope = {
  id: string;
  name: string;
  accountId: string;
  marketplace: string;
  isDefault: boolean;
  updatedAt: string;
};

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";

export function WorkspaceScopePanel() {
  const [workspaces, setWorkspaces] = useState<WorkspaceScope[]>([]);
  const [form, setForm] = useState({ workspaceId: "", name: "", accountId: "", marketplace: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalWorkspaces = workspaces.length;
  const defaultCount = workspaces.filter((workspace) => workspace.isDefault).length;
  const incompleteCount = workspaces.filter((workspace) => !workspace.accountId || !workspace.marketplace).length;

  async function loadWorkspaces() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const data = (await response.json()) as { workspaces?: WorkspaceScope[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "工作区读取失败。");
      }

      setWorkspaces(Array.isArray(data.workspaces) ? data.workspaces : []);
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

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { workspace?: WorkspaceScope; error?: string };

      if (!response.ok || !data.workspace) {
        throw new Error(data.error || "工作区保存失败。");
      }

      setForm({ workspaceId: "", name: "", accountId: "", marketplace: "" });
      await loadWorkspaces();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "工作区保存失败。");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
            <BriefcaseBusiness className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">Workspace / 账号 / 站点</CardTitle>
            <p className="mt-0.5 text-xs font-medium text-muted">定义组织级数据边界，避免不同账号、站点和工作区混用同一份数据。</p>
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
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
        {incompleteCount ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">
            有 {incompleteCount} 个工作区缺少账号或站点信息，导入和归属时容易产生混淆。
          </div>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_96px_auto]">
          <input className={fieldClass} value={form.workspaceId} placeholder="workspaceId，例如 us-main" onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))} />
          <input className={fieldClass} value={form.name} placeholder="显示名称" onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <input className={fieldClass} value={form.accountId} placeholder="Amazon accountId" onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))} />
          <input className={fieldClass} value={form.marketplace} placeholder="US" onChange={(event) => setForm((current) => ({ ...current, marketplace: event.target.value }))} />
          <Button onClick={() => void saveWorkspace()} disabled={saving}>
            <Plus className="h-4 w-4" />
            保存
          </Button>
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="px-3 py-2">Workspace</th>
                <th className="px-3 py-2">账号</th>
                <th className="px-3 py-2">站点</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <p className="font-bold text-foreground">{workspace.name}</p>
                    <p className="text-xs font-medium text-muted">{workspace.id}</p>
                  </td>
                  <td className="px-3 py-2">{workspace.accountId || "-"}</td>
                  <td className="px-3 py-2">{workspace.marketplace || "-"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={workspace.isDefault ? "green" : "blue"}>{workspace.isDefault ? "默认" : "已启用"}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{new Date(workspace.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                </tr>
              ))}
              {!workspaces.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm font-medium text-muted">
                    {loading ? "正在读取工作区..." : "暂无工作区，先建立一个默认 Workspace 作为组织边界。"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs font-medium leading-4 text-muted">
          每条记录建议保持 workspaceId、accountId、marketplace 的一一对应关系，后续导入、导出和草稿归属都按这个边界执行。
        </p>
      </CardContent>
    </Card>
  );
}
