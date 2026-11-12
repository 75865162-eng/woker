import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authorizationHistorySql, type HistorySource } from "./history-authorization";
import type { CompleteFinanceWindow } from "./automatic-planner-contract";
import { SyncInputError, type SyncScope } from "./policy";
import { nextInternalWindowGap } from "./automatic-window-history";

const evidenceLimit = 10000;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Find one bounded hole between already complete Finance windows. A leading
 * uncovered prefix remains the normal cursor backfill's responsibility. */
export function nextFinanceHistoryGap(initialFrom: string, coveredThrough: string, windows: CompleteFinanceWindow[], maxWindowMs = 30 * 86400000): CompleteFinanceWindow | null {
  return nextInternalWindowGap(initialFrom, coveredThrough, windows, maxWindowMs);
}

/** Read only successfully published windows for the current source and
 * verified Seller/authorization identity. Truncation fails closed. */
export async function readAutomaticFinanceHistory(scope: SyncScope, source: HistorySource, from: string, to: string): Promise<CompleteFinanceWindow[]> {
  const rows = await prisma.$queryRaw<Array<{ frozenScope: Prisma.JsonValue; summary: Prisma.JsonValue }>>(Prisma.sql`
    SELECT "frozenScope", summary FROM "AmazonSyncRun"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND "sourceId" = ${source.id} AND resource = 'finance' AND "executionVersion" = 2
      AND status = 'SUCCEEDED' AND stage = 'COMPLETED' AND "paginationComplete" = true AND "finishedAt" IS NOT NULL
      AND summary->'coverage' @> '{"transportComplete":true,"quarantinedCount":0}'::jsonb
      AND ${authorizationHistorySql(source)}
      AND jsonb_typeof("frozenScope"->'financeWindow'->'from') = 'string'
      AND jsonb_typeof("frozenScope"->'financeWindow'->'to') = 'string'
    LIMIT ${evidenceLimit + 1}
  `);
  if (rows.length > evidenceLimit) throw new SyncInputError("FINANCE_HISTORY_EVIDENCE_LIMIT：财务完整窗口证据超过有界规划扫描，暂停自动补采。", 409);
  const lower = instant(from), upper = instant(to);
  if (lower === null || upper === null || upper <= lower) return [];
  const windows: CompleteFinanceWindow[] = [];
  for (const row of rows) {
    const frozen = object(row.frozenScope), window = object(frozen.financeWindow), coverage = object(object(row.summary).coverage);
    if (coverage.transportComplete !== true || coverage.quarantinedCount !== 0) continue;
    const first = instant(window.from), last = instant(window.to);
    if (first === null || last === null || last <= first || first >= upper || last <= lower) continue;
    windows.push({ from: new Date(Math.max(lower, first)).toISOString(), to: new Date(Math.min(upper, last)).toISOString() });
  }
  return windows;
}
