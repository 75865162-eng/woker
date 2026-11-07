import { SyncInputError } from "./policy";
export type AmazonWorkerPolicy = { mode: "standard" | "approved-only"; taskIds?: string[]; exportIds?: string[]; runReplenishment: boolean };
function ids(value: string | undefined): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value ?? "[]"); } catch { throw new SyncInputError("Worker 允许 ID 列表必须是 JSON 数组。"); }
  if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some(v => typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(v))) throw new SyncInputError("Worker 允许 ID 列表无效。");
  return [...new Set(parsed as string[])];
}
/** Standard preserves existing behavior; approved-only never starts unrelated scheduled work. */
export function amazonWorkerPolicy(env: Record<string, string | undefined> = process.env): AmazonWorkerPolicy {
  const mode = env.AMAZON_SYNC_WORKER_MODE ?? "standard";
  if (mode === "standard") return { mode, runReplenishment: true };
  if (mode !== "approved-only") throw new SyncInputError("未知 Amazon Worker 模式，拒绝启动。");
  const taskIds = ids(env.AMAZON_SYNC_WORKER_TASK_IDS), exportIds = ids(env.AMAZON_SYNC_WORKER_EXPORT_IDS);
  if (!taskIds.length && !exportIds.length) throw new SyncInputError("受控 Worker 必须显式指定允许的任务或导出 ID。");
  return { mode, taskIds, exportIds, runReplenishment: false };
}
export function workerAllows(policy: AmazonWorkerPolicy, kind: "task" | "export", id: string) {
  return policy.mode === "standard" || (kind === "task" ? policy.taskIds : policy.exportIds)?.includes(id) === true;
}
