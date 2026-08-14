"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, RotateCcw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scopedFetch } from "@/lib/workspace/scoped-fetch";

type VersionRecord = {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  action: string;
  summary?: string | null;
  payload?: unknown;
  userId?: string | null;
  workspaceId: string;
  accountId: string;
  marketplace: string;
  createdAt: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

const entityTypes = [
  { value: "", label: "全部类型" },
  { value: "product", label: "产品资料" },
  { value: "listing_ai_workspace", label: "Listing 草稿" },
  { value: "ppc_workspace_snapshot", label: "PPC 草稿" },
  { value: "rule_config", label: "规则配置" },
  { value: "workspace_dataset", label: "PPC 数据集" },
  { value: "draft_run", label: "规则运行" },
  { value: "export_record", label: "导出记录" },
];

const entityTypeLabels = Object.fromEntries(entityTypes.filter((option) => option.value).map((option) => [option.value, option.label]));
const restorableEntityTypes = new Set(["product", "listing_ai_workspace", "ppc_workspace_snapshot", "rule_config"]);

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatPreviewValue(value: unknown) {
  if (typeof value === "string") return value || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  if (isRecord(value)) return `${Object.keys(value).length} 个字段`;
  return "-";
}

function getArrayLength(payload: unknown, key: string) {
  return isRecord(payload) && Array.isArray(payload[key]) ? payload[key].length : 0;
}

function getRestoreImpact(version: VersionRecord) {
  if (version.entityType === "product") {
    return `会用版本 v${version.version} 的内容覆盖或创建当前工作区里的产品资料 ${version.entityId}。`;
  }
  if (version.entityType === "listing_ai_workspace") {
    return "会覆盖当前用户在这个工作区里的 Listing AI 草稿和生成历史。";
  }
  if (version.entityType === "ppc_workspace_snapshot") {
    return "会覆盖当前用户在这个工作区里的 PPC 工作区快照；重新进入工作台后会按该快照恢复。";
  }
  if (version.entityType === "rule_config") {
    return "会把该版本的规则列表写回当前 PPC 工作区快照中的规则配置。";
  }
  return "这类记录目前只用于审计，不会执行恢复。";
}

function getPayloadPreviewRows(version: VersionRecord) {
  const payload = version.payload;

  if (version.entityType === "product" && isRecord(payload)) {
    return [
      ["SKU", formatPreviewValue(payload.sku)],
      ["中文名", formatPreviewValue(payload.chineseName)],
      ["英文名", formatPreviewValue(payload.englishName)],
      ["ASIN", formatPreviewValue(payload.asin)],
      ["状态", formatPreviewValue(payload.status)],
      ["流程阶段", formatPreviewValue(payload.workflowStage)],
    ];
  }

  if (version.entityType === "listing_ai_workspace" && isRecord(payload)) {
    return [
      ["草稿字段", formatPreviewValue(payload.draft)],
      ["历史记录", formatPreviewValue(payload.records)],
    ];
  }

  if (version.entityType === "ppc_workspace_snapshot") {
    return [
      ["Campaign 分组", `${getArrayLength(payload, "campaignGroups")} 项`],
      ["Lifecycle 分组", `${getArrayLength(payload, "lifecycleGroups")} 项`],
      ["Workspace Unit", `${getArrayLength(payload, "workspaceUnits")} 项`],
      ["调整草稿", `${getArrayLength(payload, "drafts")} 项`],
      ["已选草稿", `${getArrayLength(payload, "selectedDraftIds")} 项`],
      ["规则配置", `${getArrayLength(payload, "rules")} 项`],
    ];
  }

  if (version.entityType === "rule_config") {
    const rules = Array.isArray(payload) ? payload : [];
    const enabledRules = rules.filter((rule) => isRecord(rule) && rule.enabled !== false).length;
    return [
      ["规则数量", `${rules.length} 条`],
      ["启用规则", `${enabledRules} 条`],
    ];
  }

  if (isRecord(payload)) {
    return Object.entries(payload).slice(0, 6).map(([key, value]) => [key, formatPreviewValue(value)]);
  }

  return [["内容", formatPreviewValue(payload)]];
}

function getPayloadJsonPreview(payload: unknown) {
  const text = JSON.stringify(payload ?? {}, null, 2);
  return text.length > 2400 ? `${text.slice(0, 2400)}\n...` : text;
}

export function VersionHistoryWorkbench() {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 25, total: 0, pageCount: 1 });
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [query, setQuery] = useState({ entityType: "", entityId: "", page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState("");
  const [previewVersion, setPreviewVersion] = useState<VersionRecord | null>(null);

  const searchParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(pagination.pageSize),
    });

    if (query.entityType) params.set("entityType", query.entityType);
    if (query.entityId) params.set("entityId", query.entityId);

    return params;
  }, [pagination.pageSize, query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    scopedFetch(`/api/audit/versions?${searchParams.toString()}`)
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "版本历史加载失败。");
        }

        if (!cancelled) {
          setVersions(Array.isArray(data.versions) ? data.versions : []);
          setPagination(data.pagination ?? { page: query.page, pageSize: 25, total: 0, pageCount: 1 });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "版本历史加载失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query.page, searchParams]);

  function submitSearch() {
    setQuery({ entityType, entityId: entityId.trim(), page: 1 });
  }

  async function restoreVersion(versionId: string) {
    setRestoringId(versionId);
    setError("");

    try {
      const response = await scopedFetch("/api/audit/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "恢复失败。");
      }

      setPreviewVersion(null);
      setQuery((current) => ({ ...current }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败。");
    } finally {
      setRestoringId("");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle>版本历史</CardTitle>
          <p className="mt-1 text-xs font-medium text-muted">按当前工作区记录产品、Listing、PPC 草稿和规则配置的改动。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="h-9 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground outline-none"
          >
            {entityTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            value={entityId}
            onChange={(event) => setEntityId(event.target.value)}
            className="h-9 w-52 rounded-md border border-border px-3 text-xs font-semibold outline-none focus:border-brand"
            placeholder="SKU / 实体 ID"
          />
          <Button type="button" size="sm" variant="secondary" onClick={submitSearch}>
            <Search className="h-4 w-4" />
            查询
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <div className="rounded-md border border-danger/30 bg-red-50 px-3 py-2 text-sm font-semibold text-danger">{error}</div> : null}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="px-3 py-2 text-left">对象</th>
                <th className="px-3 py-2 text-left">版本</th>
                <th className="px-3 py-2 text-left">动作</th>
                <th className="px-3 py-2 text-left">说明</th>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm font-semibold text-muted">加载中...</td>
                </tr>
              ) : versions.length ? (
                versions.map((version) => (
                  <tr key={version.id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-foreground">{version.entityId}</div>
                      <div className="text-xs text-muted">{version.entityType}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="blue">v{version.version}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{version.action}</td>
                    <td className="max-w-md px-3 py-2 text-xs font-medium text-muted">{version.summary || "无说明"}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted">{formatDate(version.createdAt)}</td>
                    <td className="px-3 py-2 text-right">
                      {restorableEntityTypes.has(version.entityType) ? (
                        <Button type="button" size="sm" variant="ghost" disabled={restoringId === version.id} onClick={() => setPreviewVersion(version)}>
                          <Eye className="h-4 w-4" />
                          预览恢复
                        </Button>
                      ) : (
                        <Badge tone="gray">仅审计</Badge>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm font-semibold text-muted">暂无版本记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs font-semibold text-muted">
          <span>共 {pagination.total} 条，第 {pagination.page} / {pagination.pageCount} 页</span>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page <= 1 || loading} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>上一页</Button>
            <Button type="button" size="sm" variant="secondary" disabled={pagination.page >= pagination.pageCount || loading} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>下一页</Button>
          </div>
        </div>
      </CardContent>
      {previewVersion ? (
        <RestorePreviewDialog
          version={previewVersion}
          restoring={restoringId === previewVersion.id}
          onClose={() => setPreviewVersion(null)}
          onConfirm={() => restoreVersion(previewVersion.id)}
        />
      ) : null}
    </Card>
  );
}

function RestorePreviewDialog({
  version,
  restoring,
  onClose,
  onConfirm,
}: {
  version: VersionRecord;
  restoring: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const previewRows = getPayloadPreviewRows(version);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-8" onClick={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-foreground">恢复预览</h3>
            <p className="mt-1 text-xs font-semibold text-muted">
              {entityTypeLabels[version.entityType] ?? version.entityType} · {version.entityId} · v{version.version}
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={restoring}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{getRestoreImpact(version)}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PreviewField label="动作" value={version.action} />
            <PreviewField label="记录时间" value={formatDate(version.createdAt)} />
            <PreviewField label="工作区" value={version.workspaceId} />
            <PreviewField label="站点" value={version.marketplace || "-"} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground">将恢复的内容摘要</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {previewRows.map(([label, value]) => (
                <PreviewField key={label} label={label} value={value} />
              ))}
            </div>
          </div>
          <details className="rounded-md border border-border bg-surface-muted">
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-muted">查看原始版本内容</summary>
            <pre className="max-h-72 overflow-auto border-t border-border p-3 text-xs font-medium text-muted">{getPayloadJsonPreview(version.payload)}</pre>
          </details>
          <p className="text-xs font-semibold text-muted">确认后会写入当前工作区，并新增一条恢复操作的版本记录；原始历史版本不会被删除。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={restoring}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} disabled={restoring}>
            <RotateCcw className="h-4 w-4" />
            {restoring ? "恢复中" : "确认恢复"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-white px-3 py-2">
      <div className="text-[11px] font-bold text-muted">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}
