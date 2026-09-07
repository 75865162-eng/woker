import type { SaihuHistoryListResponse, SaihuHistoryRecord } from "@/lib/saihu-search-merge/types";

const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

function readWorkspaceScopeHeaders() {
  const headers = new Headers();

  if (typeof window === "undefined") {
    return headers;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(workspaceScopeStorageKey) ?? "{}") as {
      workspaceId?: string;
      accountId?: string;
      marketplace?: string;
    };

    headers.set("x-workspace-id", parsed.workspaceId || "default");
    if (parsed.accountId) headers.set("x-account-id", parsed.accountId);
    if (parsed.marketplace) headers.set("x-marketplace", parsed.marketplace);
  } catch {
    headers.set("x-workspace-id", "default");
  }

  return headers;
}

export async function saveSaihuHistoryRecord(record: SaihuHistoryRecord) {
  const persistableRecord = {
    id: record.id,
    action: record.action,
    createdAt: record.createdAt,
    sourceFileName: record.sourceFileName,
    outputFileName: record.outputFileName,
    workspaceId: record.workspaceId,
    accountId: record.accountId,
    marketplace: record.marketplace,
    summary: record.summary,
    rows: record.rows,
  };
  const response = await fetch("/api/saihu-search-merge/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(readWorkspaceScopeHeaders().entries()),
    },
    body: JSON.stringify({ record: persistableRecord }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "历史记录保存失败。");
  }
}

export async function listSaihuHistoryRecords(options?: { page?: number; pageSize?: number; search?: string }) {
  const url = new URL("/api/saihu-search-merge/history", window.location.origin);

  if (options?.page) url.searchParams.set("page", String(options.page));
  if (options?.pageSize) url.searchParams.set("pageSize", String(options.pageSize));
  if (options?.search) url.searchParams.set("search", options.search);

  const response = await fetch(url.toString(), {
    headers: Object.fromEntries(readWorkspaceScopeHeaders().entries()),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "历史记录读取失败。");
  }

  const data = (await response.json()) as Partial<SaihuHistoryListResponse>;

  return {
    records: data.records ?? [],
    pagination: data.pagination ?? { page: 1, pageSize: 50, total: 0, pageCount: 1 },
  };
}

export async function clearSaihuHistoryRecords() {
  const response = await fetch("/api/saihu-search-merge/history", {
    method: "DELETE",
    headers: Object.fromEntries(readWorkspaceScopeHeaders().entries()),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "历史记录清空失败。");
  }
}

export function createSaihuHistoryId(prefix: string) {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  if (randomUUID) {
    return `${prefix}-${randomUUID}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
