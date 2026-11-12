"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Item = Record<string, unknown>;
type Resource = "transfer-orders" | "cost-rules" | "warehouse-types" | "warehouse-addresses" | "consumables" | "balances" | "warehouses" | "areas" | "locations" | "lots" | "outbounds";

/** Paged selections use the same scoped WMS query routes as the tables. */
export function useWmsOptions(resource: Resource, workspaceId: string, enabled: boolean, filterQuery = "") {
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const failedPage = useRef<{ cursor: string | null; append: boolean } | null>(null);

  const load = useCallback(async (cursor: string | null, append: boolean, epoch: number) => {
    if (pending.current) return;
    pending.current = true;
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams(filterQuery); params.set("limit", "100");
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/operations/wms/${resource}?${params}`, { cache: "no-store", headers: { "x-workspace-id": workspaceId }, signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取选项失败。");
      if (epoch !== generation.current || request.signal.aborted) return;
      setItems(current => append ? [...new Map([...current, ...data.items].map((item: Item) => [item.id, item])).values()] : data.items);
      setNextCursor(data.nextCursor ?? null); failedPage.current = null;
    } catch (cause) {
      if (epoch === generation.current && !request.signal.aborted) {
        failedPage.current = { cursor, append };
        setError(cause instanceof Error ? cause.message : "读取选项失败。");
      }
    } finally {
      if (epoch === generation.current) { pending.current = false; setLoading(false); }
    }
  }, [resource, workspaceId, filterQuery]);

  useEffect(() => {
    const epoch = ++generation.current;
    controller.current?.abort(); pending.current = false; failedPage.current = null;
    setItems([]); setNextCursor(null); setError(""); setLoading(false);
    if (enabled) void load(null, false, epoch);
    return () => { generation.current = epoch + 1; controller.current?.abort(); };
  }, [enabled, load]);

  return { items, nextCursor, loading, error,
    loadMore: () => { if (enabled && nextCursor) void load(nextCursor, true, generation.current); },
    retry: () => { if (enabled) { const page = failedPage.current ?? { cursor: null, append: false }; void load(page.cursor, page.append, generation.current); } },
  };
}
