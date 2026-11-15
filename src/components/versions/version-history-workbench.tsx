"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Toolbar, controlClassName } from "@/components/ui/toolbar";
import { ListPageTemplate } from "@/components/templates/page-templates";
import { cn } from "@/lib/utils";

type VersionRecord = {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  action: string;
  summary?: string | null;
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
  { value: "ai_model_setting", label: "AI 配置" },
  { value: "product", label: "产品资料" },
  { value: "listing_ai_workspace", label: "Listing 草稿" },
  { value: "ppc_workspace_snapshot", label: "PPC 草稿" },
  { value: "rule_config", label: "规则配置" },
  { value: "file_object", label: "文件资产" },
  { value: "import_job", label: "导入任务" },
  { value: "export_record", label: "导出记录" },
];

const entityTypeLabels = new Map(entityTypes.filter((item) => item.value).map((item) => [item.value, item.label]));

const restorableEntityTypes = new Set([
  "ai_model_setting",
  "product",
  "listing_ai_workspace",
  "ppc_workspace_snapshot",
  "rule_config",
]);

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
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

    fetch(`/api/audit/versions?${searchParams.toString()}`)
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
      const response = await fetch("/api/audit/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "恢复失败。");
      }

      setQuery((current) => ({ ...current }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败。");
    } finally {
      setRestoringId("");
    }
  }

  const columns: DataTableColumn<VersionRecord>[] = [
    {
      key: "entity",
      header: "对象",
      width: 288,
      render: (version) => (
        <>
          <span className="block truncate font-semibold text-foreground" title={version.entityId}>
            {version.entityId}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {entityTypeLabels.get(version.entityType) ?? version.entityType}
          </span>
        </>
      ),
    },
    {
      key: "version",
      header: "版本",
      width: 84,
      render: (version) => (
        <StatusPill tone="info" className="metric-tabular">
          v{version.version}
        </StatusPill>
      ),
    },
    {
      key: "action",
      header: "动作",
      width: 204,
      render: (version) => (
        <span className="block break-all text-xs leading-4 text-muted" title={version.action}>
          {version.action}
        </span>
      ),
    },
    {
      key: "summary",
      header: "说明",
      width: 336,
      render: (version) => (
        <span className="block truncate text-sm text-muted" title={version.summary ?? undefined}>
          {version.summary || "—"}
        </span>
      ),
    },
    {
      key: "created",
      header: "时间",
      width: 190,
      render: (version) => (
        <span className="block truncate text-xs text-muted metric-tabular">{formatDate(version.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: 120,
      align: "right",
      render: (version) => {
        const restorable = restorableEntityTypes.has(version.entityType);

        return (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="whitespace-nowrap"
            disabled={restoringId === version.id || !restorable}
            onClick={() => restoreVersion(version.id)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {restorable ? "恢复" : "审计"}
          </Button>
        );
      },
    },
  ];

  return (
    <ListPageTemplate
      header={error ? <Alert tone="danger">{error}</Alert> : null}
      filters={<Toolbar>
        <select
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          aria-label="对象类型筛选"
          className={cn(controlClassName, "w-40")}
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
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          aria-label="按 SKU 或实体 ID 查询"
          className={cn(controlClassName, "w-64")}
          placeholder="SKU / 实体 ID"
        />
        <Button type="button" size="sm" variant="primary" onClick={submitSearch}>
          <Search className="h-4 w-4" />
          查询
        </Button>
      </Toolbar>}

      table={<div className="overflow-hidden rounded-lg border border-border bg-surface">
        <DataTable
          className="rounded-none border-0"
          columns={columns}
          rows={versions}
          getRowKey={(version) => version.id}
          loading={loading}
          empty="当前范围没有版本记录。产品资料、Listing 与 PPC 草稿的每次改动都会留下版本。"
        />
      </div>}
      pagination={<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs text-muted">
          <span className="metric-tabular">
            共 {pagination.total.toLocaleString("zh-CN")} 条，第 {pagination.page} / {pagination.pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pagination.page >= pagination.pageCount || loading}
              onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
            >
              下一页
            </Button>
          </div>
        </div>}
    />
  );
}
