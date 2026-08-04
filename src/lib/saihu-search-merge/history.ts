import type { SaihuHistoryRecord } from "@/lib/saihu-search-merge/types";

export async function saveSaihuHistoryRecord(record: SaihuHistoryRecord) {
  const persistableRecord = {
    id: record.id,
    action: record.action,
    createdAt: record.createdAt,
    sourceFileName: record.sourceFileName,
    outputFileName: record.outputFileName,
    summary: record.summary,
    rows: record.rows,
  };
  const response = await fetch("/api/saihu-search-merge/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record: persistableRecord }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "历史记录保存失败。");
  }
}

export async function listSaihuHistoryRecords() {
  const response = await fetch("/api/saihu-search-merge/history");

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "历史记录读取失败。");
  }

  const data = (await response.json()) as { records?: SaihuHistoryRecord[] };

  return data.records ?? [];
}

export async function clearSaihuHistoryRecords() {
  const response = await fetch("/api/saihu-search-merge/history", {
    method: "DELETE",
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
