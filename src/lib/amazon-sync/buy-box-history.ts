import type { Prisma } from "@prisma/client";
import { localDate, shiftDate } from "./date-range";
import { digest } from "./approval-policy";
import { parseObservationPolicy, type BuyBoxHistoryPolicy } from "./observation-policy";
import { SyncInputError, type SyncScope } from "./policy";

/** A whole CHILD-ASIN report for one closed business day. Dates never imply
 * that Amazon actually retained or returned every requested historical day. */
export function assertBuyBoxTaskPolicy(configured: BuyBoxHistoryPolicy, candidate: BuyBoxHistoryPolicy, now = new Date()) {
  const { from, to, ...fixed } = configured;
  const { from: selectedFrom, to: selectedTo, ...selectedFixed } = candidate;
  void to;
  if (!configured.allAsins || digest(fixed) !== digest(selectedFixed) || selectedFrom !== selectedTo || selectedFrom < from || selectedTo >= localDate(now, configured.marketplaceTimeZone)) throw new SyncInputError("Buy Box 日报超出自动采集范围。", 403);
}

export function nextBuyBoxDay(from: string, timeZone: string, attempted: string[], now: Date) {
  const yesterday = shiftDate(localDate(now, timeZone), -1);
  const days = new Set(attempted);
  let day = from;
  while (day <= yesterday && days.has(day)) day = shiftDate(day, 1);
  return day > yesterday ? null : day;
}

export async function nextBuyBoxPolicy(tx: Prisma.TransactionClient, scope: SyncScope, source: { id: string; revision: number; authorizationId: string; authorization: { revision: number }; domainPolicy: unknown }, now = new Date()) {
  const configured = parseObservationPolicy(source.domainPolicy, "buy_box_history");
  if (configured.resource !== "buy_box_history" || !configured.allAsins) throw new SyncInputError("自动 Buy Box 来源需要完整 ASIN 报告策略。", 409);
  const runs = await tx.amazonSyncRun.findMany({ where: { ...scope, sourceId: source.id, resource: "buy_box_history", executionVersion: 2, status: { in: ["SUCCEEDED", "FAILED", "PARTIAL_SUCCESS", "BLOCKED", "CANCELLED"] }, finishedAt: { not: null }, stage: { not: "PURGED" }, AND: [
    { frozenScope: { path: ["sourceRevision"], equals: source.revision } },
    { frozenScope: { path: ["authorizationId"], equals: source.authorizationId } },
    { frozenScope: { path: ["authorizationRevision"], equals: source.authorization.revision } },
  ] }, select: { status: true, frozenScope: true, summary: true }, take: 10001 });
  if (runs.length > 10000) throw new SyncInputError("Buy Box 历史证据超过容量，未跳过缺日。", 409);
  // Failed days retain their original task/checkpoint for retry; they must not
  // prevent later historical days from being discovered. This is not coverage.
  const attempted = runs.flatMap(run => {
    const coverage = (run.summary as { coverage?: { complete?: boolean } } | null)?.coverage;
    try {
      const p = parseObservationPolicy((run.frozenScope as { domainPolicy?: unknown }).domainPolicy, "buy_box_history");
      if (p.resource !== "buy_box_history" || run.status === "SUCCEEDED" && coverage?.complete !== true) return [];
      assertBuyBoxTaskPolicy(configured, p, now);
      return [p.from];
    } catch { return []; }
  });
  const day = nextBuyBoxDay(configured.from, configured.marketplaceTimeZone, attempted, now);
  if (!day) throw new SyncInputError("Buy Box 尚无已闭合业务日。", 409);
  return { ...configured, from: day, to: day };
}
