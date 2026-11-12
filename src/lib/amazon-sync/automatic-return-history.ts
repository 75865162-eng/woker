import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authorizationHistorySql, type HistorySource } from "./history-authorization";
import { digest } from "./approval-policy";
import type { CompleteHistoryWindow } from "./automatic-window-history";
import { SyncInputError, type SyncScope } from "./policy";
import { parseReturnPolicy } from "./returns";

const evidenceLimit = 10000;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

/** Read complete report windows for the current Returns policy and seller authorization. */
export async function readAutomaticReturnHistory(scope: SyncScope, source: HistorySource, from: string, to: string, returnsPolicy: unknown): Promise<CompleteHistoryWindow[]> {
  const rows = await prisma.$queryRaw<Array<{ frozenScope: Prisma.JsonValue; summary: Prisma.JsonValue }>>(Prisma.sql`
    SELECT "frozenScope", summary FROM "AmazonSyncRun"
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
      AND "sourceId" = ${source.id} AND resource = 'returns' AND "executionVersion" = 2
      AND status = 'SUCCEEDED' AND stage = 'COMPLETED' AND "paginationComplete" = true AND "finishedAt" IS NOT NULL
      AND summary->'coverage' @> '{"complete":true}'::jsonb
      AND ${authorizationHistorySql(source)}
      AND jsonb_typeof("frozenScope"->'returnWindow'->'from') = 'string'
      AND jsonb_typeof("frozenScope"->'returnWindow'->'to') = 'string'
    LIMIT ${evidenceLimit + 1}
  `);
  if (rows.length > evidenceLimit) throw new SyncInputError("RETURN_HISTORY_EVIDENCE_LIMIT：退货完整窗口证据超过有界规划扫描，暂停自动补采。", 409);
  const lower = instant(from), upper = instant(to);
  if (lower === null || upper === null || upper <= lower) return [];
  const expected = parseReturnPolicy(returnsPolicy), windows: CompleteHistoryWindow[] = [];
  for (const row of rows) {
    const frozen = object(row.frozenScope), coverage = object(object(row.summary).coverage), window = object(frozen.returnWindow);
    if (coverage.complete !== true || digest(parseReturnPolicy(frozen.returnsPolicy)) !== digest(expected)) continue;
    const first = instant(window.from), last = instant(window.to);
    if (first === null || last === null || last <= first || first >= upper || last <= lower) continue;
    windows.push({ from: new Date(Math.max(lower, first)).toISOString(), to: new Date(Math.min(upper, last)).toISOString() });
  }
  return windows;
}
