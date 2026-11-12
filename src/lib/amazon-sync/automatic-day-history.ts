import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authorizationHistorySql, type HistorySource } from "./history-authorization";
import { shiftDate } from "./date-range";
import type { SyncScope } from "./policy";
import type { AutomaticDayWindowPolicy, CompleteDayWindow } from "./automatic-day-windows";

/** Repository-side union of complete daily windows, independent of the latest
 * cursor or number of refresh tasks. This is evidence, never execution authority. */
export async function readAutomaticDayHistory(scope: SyncScope, source: HistorySource, today: string, policy: AutomaticDayWindowPolicy): Promise<CompleteDayWindow[]> {
  const from = shiftDate(today, -policy.historyDays), to = shiftDate(today, -1);
  const requiredFlags = Object.fromEntries(policy.requiredCoverageFlags.map(flag => [flag, true]));
  const windowKey = policy.frozenWindowKey;
  return prisma.$queryRaw<CompleteDayWindow[]>(Prisma.sql`
    WITH evidence AS (
      SELECT "frozenScope"->${windowKey}->>'from' AS first_day,
             "frozenScope"->${windowKey}->>'to' AS last_day
      FROM "AmazonSyncRun"
      WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
        AND "sourceId" = ${source.id} AND resource = ${source.resource}
        AND "executionVersion" = 2 AND status = 'SUCCEEDED' AND stage = 'COMPLETED'
        AND "paginationComplete" = true AND "finishedAt" IS NOT NULL
        AND summary->'coverage' @> ${JSON.stringify(requiredFlags)}::jsonb
        AND NOT (summary->'coverage' @> '{"complete":false}'::jsonb)
        AND NOT (summary->'coverage' @> '{"transportComplete":false}'::jsonb)
        AND NOT (summary->'coverage' @> '{"attributionComplete":false}'::jsonb)
        AND "frozenScope"->${windowKey} @> ${JSON.stringify(policy.requiredWindowFields ?? {})}::jsonb
        AND ${authorizationHistorySql(source)}
        AND jsonb_typeof("frozenScope"->${windowKey}->'from') = 'string'
        AND jsonb_typeof("frozenScope"->${windowKey}->'to') = 'string'
    ), parsed AS (
      SELECT *,
        CASE WHEN first_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          CASE WHEN substring(first_day,1,4)::int BETWEEN 1 AND 9999 AND substring(first_day,6,2)::int BETWEEN 1 AND 12 AND substring(first_day,9,2)::int BETWEEN 1 AND 31
            THEN make_date(substring(first_day,1,4)::int,substring(first_day,6,2)::int,1) + substring(first_day,9,2)::int - 1 END END AS first_date,
        CASE WHEN last_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          CASE WHEN substring(last_day,1,4)::int BETWEEN 1 AND 9999 AND substring(last_day,6,2)::int BETWEEN 1 AND 12 AND substring(last_day,9,2)::int BETWEEN 1 AND 31
            THEN make_date(substring(last_day,1,4)::int,substring(last_day,6,2)::int,1) + substring(last_day,9,2)::int - 1 END END AS last_date
      FROM evidence
    ), windows AS (
      SELECT daterange(GREATEST(first_date, ${from}::date), LEAST(last_date, ${to}::date), '[]') AS period
      FROM parsed
      WHERE to_char(first_date,'YYYY-MM-DD') = first_day AND to_char(last_date,'YYYY-MM-DD') = last_day
        AND first_date <= last_date AND first_date <= ${to}::date AND last_date >= ${from}::date
    ), merged AS (SELECT range_agg(period) AS periods FROM windows)
    SELECT lower(period)::text AS "from", (upper(period) - 1)::text AS "to"
    FROM merged CROSS JOIN LATERAL unnest(periods) AS period ORDER BY lower(period)
  `);
}
