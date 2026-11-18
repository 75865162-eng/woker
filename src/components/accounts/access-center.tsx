"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Download, Plus, RotateCcw, Save, Search, Trash2, UsersRound } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldClass } from "./account-workbench-api";

type ViewMode = "role" | "resource" | "member" | "preview";
type SubjectType = "ROLE" | "MEMBER";

type MatrixCell = { subjectId: string; resourceType: string; resourceId: string; actions: string[]; source: string };
type MatrixResponse = {
  roles: Array<{ id: string; name: string; description: string; memberCount: number }>;
  resourceGroups: Array<{
    type: string;
    label: string;
    resources: Array<{ type: string; id: string; label: string; secondary: string | null }>;
  }>;
  cells: MatrixCell[];
};
type GrantSnapshot = {
  subjectType: SubjectType;
  subjectId: string;
  grants: Array<{
    id: string;
    resourceType: string;
    resourceId: string;
    actions: string[];
    scopeJson: Record<string, unknown> | null;
    enabled: boolean;
    source: string;
    revision: number;
  }>;
  revision: string;
};
type Change = { resourceType: string; resourceId: string; actions: string[]; scopeJson?: Record<string, unknown> | null };

const VIEWS: Array<{ id: ViewMode; label: string }> = [
  { id: "role", label: "按角色" },
  { id: "resource", label: "按资源" },
  { id: "member", label: "按成员" },
  { id: "preview", label: "并集预览" },
];

const ACTION_LABELS: Record<string, string> = {
  view: "查看", create: "新建", edit: "编辑", approve: "审批", export: "导出",
  call: "调用", read: "读", write: "写", mcp: "MCP", use: "使用", configure: "配置",
};

function sourceTone(source: string): BadgeTone {
  if (source === "MIGRATED" || source === "ADMIN") return "amber";
  if (source === "BOTH") return "blue";
  return "gray";
}

function sourceLabel(source: string): string {
  return ({ MIGRATED: "迁移", ADMIN: "管理员", BOTH: "角色+成员", ROLE: "角色", MEMBER: "成员补充", MANUAL: "手动" } as Record<string, string>)[source] ?? source;
}

async function readJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

export type AccessRoleManagement = {
  roles: Array<{ id: string; name: string; description: string; memberCount: number }>;
  canManage: (id: string) => boolean;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onMembers: (id: string) => void;
};

export function AccessCenter({
  initialView = "role",
  initialSubjectId,
  roleManagement,
}: {
  initialView?: ViewMode;
  initialSubjectId?: string;
  roleManagement?: AccessRoleManagement;
}) {
  const [view, setView] = useState<ViewMode>(initialView);
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<string>(initialSubjectId ?? "");
  const [snapshot, setSnapshot] = useState<GrantSnapshot | null>(null);
  const [draft, setDraft] = useState<Map<string, Set<string>>>(new Map());
  const [saving, setSaving] = useState(false);
  const [previewUser, setPreviewUser] = useState("");
  const [previewResult, setPreviewResult] = useState<{ effective: unknown; gaps: string[] } | null>(null);

  const loadMatrix = useCallback(async () => {
    setLoading(true);
    const data = await readJson<MatrixResponse>("/api/accounts/access/matrix");
    setMatrix(data);
    setError(data ? "" : "无法加载授权矩阵，请检查权限。");
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    void loadMatrix().then((data) => {
      if (!data) return;
      const first = initialSubjectId && data.roles.some((role) => role.id === initialSubjectId)
        ? initialSubjectId
        : data.roles[0]?.id ?? "";
      setSelectedSubject((current) => current || first);
    });
  }, [loadMatrix, initialSubjectId]);

  const subjectType: SubjectType = view === "member" || view === "preview" ? "MEMBER" : "ROLE";

  const loadSnapshot = useCallback(async () => {
    if (!selectedSubject) return;
    const endpoint = subjectType === "MEMBER"
      ? `/api/accounts/access?subjectType=MEMBER&subjectId=${encodeURIComponent(selectedSubject)}`
      : `/api/accounts/access?subjectType=ROLE&subjectId=${encodeURIComponent(selectedSubject)}`;
    const data = await readJson<GrantSnapshot>(endpoint);
    if (!data) return;
    setSnapshot(data);
    const next = new Map<string, Set<string>>();
    for (const grant of data.grants) {
      next.set(`${grant.resourceType}:${grant.resourceId}`, new Set(grant.actions));
    }
    setDraft(next);
  }, [selectedSubject, subjectType]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const pendingCount = useMemo(() => {
    if (!snapshot) return 0;
    const before = new Map(snapshot.grants.map((g) => [`${g.resourceType}:${g.resourceId}`, new Set(g.actions)]));
    const keys = new Set([...before.keys(), ...draft.keys()]);
    let count = 0;
    for (const key of keys) {
      const a = [...(before.get(key) ?? [])].sort().join(",");
      const b = [...(draft.get(key) ?? [])].sort().join(",");
      if (a !== b) count += 1;
    }
    return count;
  }, [snapshot, draft]);

  function toggleAction(resourceType: string, resourceId: string, action: string, disabled = false) {
    if (disabled) return;
    const key = `${resourceType}:${resourceId}`;
    setDraft((current) => {
      const next = new Map(current);
      const actions = new Set(next.get(key) ?? []);
      if (actions.has(action)) actions.delete(action);
      else actions.add(action);
      next.set(key, actions);
      return next;
    });
  }

  function rebuildChanges(): Change[] {
    const before = new Map(snapshot?.grants.map((g) => [`${g.resourceType}:${g.resourceId}`, g]) ?? []);
    const keys = new Set([...before.keys(), ...draft.keys()]);
    const changes: Change[] = [];
    for (const key of keys) {
      const a = [...(before.get(key)?.actions ?? [])].sort().join(",");
      const b = [...(draft.get(key) ?? [])].sort().join(",");
      if (a === b) continue;
      const [resourceType, ...rest] = key.split(":");
      const resourceId = rest.join(":");
      changes.push({ resourceType, resourceId, actions: [...(draft.get(key) ?? [])] });
    }
    return changes;
  }

  async function handleSave() {
    if (!snapshot || pendingCount === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/accounts/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType: snapshot.subjectType,
          subjectId: snapshot.subjectId,
          changes: rebuildChanges(),
          expectedRevision: snapshot.revision,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "保存失败。");
        if (res.status === 409) void loadSnapshot();
        return;
      }
      await loadSnapshot();
    } catch {
      setError("保存失败：网络错误。");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!snapshot) return;
    const next = new Map<string, Set<string>>();
    for (const grant of snapshot.grants) next.set(`${grant.resourceType}:${grant.resourceId}`, new Set(grant.actions));
    setDraft(next);
  }

  async function handlePreview() {
    if (!previewUser.trim()) return;
    const data = await readJson<{ effective: unknown; gaps: string[] }>(
      `/api/accounts/access/effective?userId=${encodeURIComponent(previewUser.trim())}`,
    );
    setPreviewResult(data);
  }

  function exportMatrix() {
    if (!matrix) return;
    const lines = ["主体类型,主体ID,资源类型,资源ID,动作,来源"];
    for (const cell of matrix.cells) {
      lines.push(`ROLE,${cell.subjectId},${cell.resourceType},${cell.resourceId},${cell.actions.join("|")},${cell.source}`);
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "access-matrix.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!matrix) return [];
    if (!normalizedSearch) return matrix.resourceGroups;
    return matrix.resourceGroups
      .map((group) => ({
        ...group,
        resources: group.resources.filter(
          (r) => r.label.toLowerCase().includes(normalizedSearch) || r.id.toLowerCase().includes(normalizedSearch) || (r.secondary ?? "").toLowerCase().includes(normalizedSearch),
        ),
      }))
      .filter((group) => group.resources.length > 0);
  }, [matrix, normalizedSearch]);

  const cellMap = useMemo(() => {
    const map = new Map<string, MatrixCell>();
    for (const cell of matrix?.cells ?? []) map.set(`${cell.subjectId}|${cell.resourceType}:${cell.resourceId}`, cell);
    return map;
  }, [matrix]);

  const isMemberView = view === "member";
  const isPreviewView = view === "preview";
  const roleActions = ["view", "create", "edit", "approve", "export"];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-surface-muted p-0.5" role="tablist" aria-label="授权视图">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => { setView(item.id); setError(""); }}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${view === item.id ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className={`${fieldClass} min-w-52 pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索资源 / 域 / 工具" aria-label="搜索资源" />
            </div>
            <Button size="sm" variant="secondary" onClick={exportMatrix}><Download className="h-3.5 w-3.5" />导出</Button>
          </div>
        </CardHeader>
      </Card>

      {error ? (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</div>
      ) : null}

      {loading ? (
        <div className="rounded-md border border-border bg-surface px-4 py-16 text-center text-sm text-muted">加载中…</div>
      ) : isPreviewView ? (
        <PreviewPanel previewUser={previewUser} setPreviewUser={setPreviewUser} onPreview={() => void handlePreview()} result={previewResult} roles={matrix?.roles ?? []} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <Card className="xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2.5">
              <CardTitle className="text-section">{isMemberView ? "成员" : "角色"}列表</CardTitle>
              {roleManagement && !isMemberView ? (
                <Button size="sm" variant="secondary" className="h-7 px-2" onClick={roleManagement.onAdd}><Plus className="h-3.5 w-3.5" />新建角色</Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {(roleManagement?.roles ?? matrix?.roles ?? []).map((role) => {
                const active = selectedSubject === role.id;
                const canManage = roleManagement?.canManage(role.id) ?? false;
                return (
                  <div
                    key={role.id}
                    className={`group rounded-md border px-2.5 py-2 transition ${active ? "border-brand bg-brand/5" : "border-transparent hover:bg-surface-muted"}`}
                  >
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setSelectedSubject(role.id)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{role.name}</span>
                          <Badge tone={role.memberCount > 0 ? "blue" : "gray"}>{role.memberCount} 人</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">{role.description}</p>
                      </button>
                      {roleManagement && !isMemberView ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button type="button" title="查看成员" aria-label={`查看${role.name}的成员`} onClick={() => roleManagement.onMembers(role.id)} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"><UsersRound className="h-3.5 w-3.5" /></button>
                          {canManage && role.memberCount === 0 ? (
                            <button type="button" title="删除角色" aria-label={`删除${role.name}`} onClick={() => roleManagement.onDelete(role.id)} className="rounded p-1 text-muted hover:bg-danger-soft hover:text-danger-ink"><Trash2 className="h-3.5 w-3.5" /></button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!(roleManagement?.roles ?? matrix?.roles ?? []).length ? <p className="px-2 py-8 text-center text-sm text-muted">没有可配置的角色</p> : null}
            </CardContent>
          </Card>

          <Card className="xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
            <CardHeader className="sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2.5">
              <div>
                <CardTitle className="text-section">授权矩阵</CardTitle>
                <p className="mt-0.5 text-xs text-muted">{isMemberView ? "并集模式下成员授权只能新增，不能撤销角色权限。" : "点击动作标签即可修改，需点击保存生效。"}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-3">
              {filteredGroups.map((group) => (
                <ResourceGroup
                  key={group.type}
                  group={group}
                  actions={group.type === "MCP_TOOL" ? ["call", "read", "write"] : group.type === "APPROVAL" ? ["approve", "reject"] : roleActions}
                  draft={draft}
                  cellMap={cellMap}
                  subjectId={selectedSubject}
                  inherited={isMemberView}
                  onToggle={toggleAction}
                />
              ))}
              {!filteredGroups.length ? <p className="py-12 text-center text-sm text-muted">没有匹配的资源</p> : null}
            </CardContent>
          </Card>

          <Card className="xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
            <CardHeader className="px-3 py-2.5">
              <CardTitle className="text-section">生效预览 / 变更</CardTitle>
              <p className="mt-0.5 text-xs text-muted">保存前确认影响范围。</p>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="rounded-md border border-border bg-surface-muted p-3">
                <p className="text-xs text-muted">待保存</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{pendingCount} <span className="text-sm font-normal text-muted">项</span></p>
              </div>
              {snapshot ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted">主体</span><span className="font-semibold text-foreground">{snapshot.subjectId}</span></div>
                  <div className="flex justify-between"><span className="text-muted">已授资源</span><span className="font-semibold text-foreground">{snapshot.grants.length}</span></div>
                  <div className="flex justify-between"><span className="text-muted">版本</span><span className="font-mono text-foreground">{snapshot.revision.split(":")[0]}…</span></div>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={() => void handleSave()} disabled={saving || pendingCount === 0}><Save className="h-3.5 w-3.5" />{saving ? "保存中…" : "保存授权"}</Button>
                <Button variant="secondary" onClick={handleReset} disabled={pendingCount === 0}><RotateCcw className="h-3.5 w-3.5" />重置草稿</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ResourceGroup({
  group,
  actions,
  draft,
  cellMap,
  subjectId,
  inherited,
  onToggle,
}: {
  group: MatrixResponse["resourceGroups"][number];
  actions: string[];
  draft: Map<string, Set<string>>;
  cellMap: Map<string, MatrixCell>;
  subjectId: string;
  inherited: boolean;
  onToggle: (resourceType: string, resourceId: string, action: string, disabled?: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 bg-surface-muted px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ChevronDown aria-hidden className={`h-4 w-4 transition ${open ? "" : "-rotate-90"}`} />
          {group.label}
          <Badge tone="gray">{group.resources.length}</Badge>
        </span>
      </button>
      {open ? (
        <div className="divide-y divide-border">
          {group.resources.map((resource) => {
            const key = `${resource.type}:${resource.id}`;
            const cell = cellMap.get(`${subjectId}|${key}`);
            const enabled = draft.get(key) ?? new Set<string>();
            const isInherited = inherited && Boolean(cell?.source && cell.source !== "MEMBER");
            return (
              <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{resource.label}</p>
                  <p className="truncate text-xs text-muted">{resource.secondary ?? resource.id}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {isInherited ? <Badge tone="gray">来自角色</Badge> : null}
                  {actions.map((action) => {
                    const active = enabled.has(action);
                    return (
                      <button
                        key={action}
                        type="button"
                        title={isInherited ? "来自角色，成员侧不可撤销" : undefined}
                        onClick={() => onToggle(resource.type, resource.id, action, isInherited)}
                        className={`rounded border px-2 py-0.5 text-xs font-semibold transition ${active ? "border-brand bg-brand text-white" : "border-border bg-surface text-muted hover:text-foreground"} ${isInherited ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {ACTION_LABELS[action] ?? action}
                      </button>
                    );
                  })}
                  {cell?.source ? <Badge tone={sourceTone(cell.source)}>{sourceLabel(cell.source)}</Badge> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PreviewPanel({
  previewUser,
  setPreviewUser,
  onPreview,
  result,
  roles,
}: {
  previewUser: string;
  setPreviewUser: (value: string) => void;
  onPreview: () => void;
  result: { effective: unknown; gaps: string[] } | null;
  roles: Array<{ id: string; name: string; memberCount: number }>;
}) {
  const effective = result?.effective as {
    isAdmin?: boolean;
    modules?: Record<string, string[]>;
    amazon?: { allSellers: boolean; sellers: unknown[] };
    sellfox?: { allStores: boolean; stores: string[]; domains: Record<string, string[]> };
    mcp?: Array<{ provider: string; tools: string[] }>;
    approvals?: unknown[];
    points?: { quota: string | null };
    sources?: Record<string, string>;
  } | undefined;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-section">成员并集预览</CardTitle>
          <p className="mt-0.5 text-xs text-muted">输入成员的用户 ID，查看角色 ∪ 成员补充授权的最终结果及来源。</p>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="flex gap-2">
            <input className={fieldClass} value={previewUser} onChange={(e) => setPreviewUser(e.target.value)} placeholder="成员用户 ID（如 cmwm27rh…）" aria-label="成员用户 ID" />
            <Button onClick={onPreview} disabled={!previewUser.trim()}>预览</Button>
          </div>
          <p className="text-xs text-muted">可从「成员」Tab 的账号记录中复制用户 ID。角色参考：{roles.slice(0, 5).map((r) => r.name).join(" / ") || "无"}</p>
          {effective ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCard label="角色" value={effective.isAdmin ? "管理员" : "普通"} />
              <StatCard label="可访问模块" value={String(Object.keys(effective.modules ?? {}).length)} />
              <StatCard label="Amazon 店铺" value={effective.amazon?.allSellers ? "全部" : String(effective.amazon?.sellers?.length ?? 0)} />
              <StatCard label="赛狐店铺" value={effective.sellfox?.allStores ? "全部" : String(effective.sellfox?.stores?.length ?? 0)} />
              <StatCard label="赛狐数据域" value={String(Object.keys(effective.sellfox?.domains ?? {}).length)} />
              <StatCard label="MCP 工具" value={String(effective.mcp?.reduce((sum, entry) => sum + entry.tools.length, 0) ?? 0)} />
              <StatCard label="审批类型" value={String(effective.approvals?.length ?? 0)} />
              <StatCard label="积分额度" value={effective.points?.quota ?? "未配置"} />
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="px-4 py-3"><CardTitle className="text-section">缺口提示</CardTitle></CardHeader>
        <CardContent className="space-y-2 p-4">
          {result?.gaps.length ? result.gaps.map((gap, index) => (
            <div key={index} className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{gap}</span>
            </div>
          )) : result ? (
            <p className="text-sm text-muted">未发现权限缺口。</p>
          ) : (
            <p className="text-sm text-muted">请先选择成员并预览。</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
