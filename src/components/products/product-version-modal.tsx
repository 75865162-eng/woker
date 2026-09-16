"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/products/types";

type ProductVersionRecord = {
  id: string;
  version: number;
  action: string;
  summary?: string | null;
  createdAt: string;
  userId?: string | null;
};

export function ProductVersionModal({
  product,
  onClose,
  onRestored,
}: {
  product: Product;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<ProductVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        entityType: "product",
        entityId: product.sku,
        pageSize: "50",
      });
      const response = await fetch(`/api/audit/versions?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as { versions?: ProductVersionRecord[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本历史读取失败。");
      }

      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "版本历史读取失败。");
    } finally {
      setLoading(false);
    }
  }, [product.sku]);

  async function restoreVersion(version: ProductVersionRecord) {
    if (!window.confirm(`确定恢复 ${product.sku} 到版本 ${version.version} 吗？`)) {
      return;
    }

    setBusyId(version.id);
    setError("");

    try {
      const response = await fetch("/api/audit/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本恢复失败。");
      }

      onRestored();
      await loadVersions();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "版本恢复失败。");
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">版本历史：{product.sku}</h3>
            <p className="mt-1 text-xs font-semibold text-muted">{product.chineseName || product.englishName || "未命名商品"}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
          {loading ? <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">正在读取版本历史...</div> : null}
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">版本 {version.version} · {version.action}</p>
                <p className="mt-1 truncate text-xs font-medium text-muted">{version.summary || "无摘要"} · {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void restoreVersion(version)} disabled={Boolean(busyId)}>
                <RotateCcw className="h-4 w-4" />
                {busyId === version.id ? "恢复中" : "恢复"}
              </Button>
            </div>
          ))}
          {!loading && versions.length === 0 ? (
            <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm font-medium text-muted">这个商品还没有版本记录。</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
