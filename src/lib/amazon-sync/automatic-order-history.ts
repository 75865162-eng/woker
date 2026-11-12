import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { digest } from "./approval-policy";
import { authorizationHistorySql, type HistorySource } from "./history-authorization";
import type { CompleteHistoryWindow } from "./automatic-window-history";
import { SyncInputError, type SyncScope } from "./policy";

const evidenceLimit = 10000;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Read complete published list/detail windows for the current Order policy and identity. */
export async function readAutomaticOrderHistory(scope: SyncScope, source: HistorySource, from: string, to: string, orderPolicy: unknown): Promise<CompleteHistoryWindow[]> {
  const rows = await prisma.$queryRaw<Array<{ frozenScope: Prisma.JsonValue; summary: Prisma.JsonValue }>>(Prisma.sql`
    SELECT "frozenScope", summary FROM "AmazonSyncRun"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND "sourceId" = ${source.id} AND resource = 'orders' AND "executionVersion" = 2
      AND status = 'SUCCEEDED' AND stage = 'COMPLETED' AND "paginationComplete" = true AND "finishedAt" IS NOT NULL
      AND summary->'coverage' @> '{"complete":true,"listComplete":true,"pendingDetails":0}'::jsonb
      AND ${authorizationHistorySql(source)}
      AND jsonb_typeof("frozenScope"->'orderWindow'->'from') = 'string'
      AND jsonb_typeof("frozenScope"->'orderWindow'->'to') = 'string'
    LIMIT ${evidenceLimit + 1}
  `);
  if (rows.length > evidenceLimit) throw new SyncInputError("ORDER_HISTORY_EVIDENCE_LIMIT：订单完整窗口证据超过有界规划扫描，暂停自动补采。", 409);
  const lower = instant(from), upper = instant(to);
  if (lower === null || upper === null || upper <= lower) return [];
  const detailsRequired = !!object(orderPolicy).details;
  const expectedPolicyDigest = digest(orderPolicy);
  const windows: CompleteHistoryWindow[] = [];
  for (const row of rows) {
    const frozen = object(row.frozenScope), window = object(frozen.orderWindow), coverage = object(object(row.summary).coverage);
    if (digest(frozen.orderPolicy) !== expectedPolicyDigest || coverage.complete !== true || coverage.listComplete !== true || coverage.pendingDetails !== 0) continue;
    if (coverage.detailsEnabled !== detailsRequired || detailsRequired && coverage.detailsComplete !== true) continue;
    const first = instant(window.from), last = instant(window.to);
    if (first === null || last === null || last <= first || first >= upper || last <= lower) continue;
    windows.push({ from: new Date(Math.max(lower, first)).toISOString(), to: new Date(Math.min(upper, last)).toISOString() });
  }
  return windows;
}
