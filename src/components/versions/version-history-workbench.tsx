"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  { value: "product", label: "产品资料" },
  { value: "listing_ai_workspace", label: "Listing 草稿" },
  { value: "ppc_workspace_snapshot", label: "PPC 草稿" },
  { value: "rule_config", label: "规则配置" },
];

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
                      <Button type="button" size="sm" variant="ghost" disabled={restoringId === version.id} onClick={() => restoreVersion(version.id)}>
                        <RotateCcw className="h-4 w-4" />
                        恢复
                      </Button>
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
    </Card>
  );
}
