import { SyncInputError } from "./policy";

/** Shared by ERP reads and MCP; existing page size remains the default. */
export function queryPageSize(params: URLSearchParams) {
  const raw = params.get("pageSize");
  if (raw === null) return 50;
  const size = Number(raw);
  if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new SyncInputError("查询每页行数须为 1 至 50。");
  return size;
}
