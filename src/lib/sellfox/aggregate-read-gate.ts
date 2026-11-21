/**
 * Reconciliation-gated aggregate read (阶段四/阶段三 的"安全切换"中枢).
 *
 * Why this exists
 * ---------------
 * The pre-aggregated tables (SalesAggDaily/ProfitAggDaily/AdsAggDaily/OverviewAgg)
 * are written only when SELLFOX_AGG_READ_ENABLED=true. On a fresh/cloned environment
 * that switch is OFF, so the tables are EMPTY. A naive "read from aggregate" cutover
 * would therefore serve empty pages to users.
 *
 * This helper makes the cutover *explicit and provably safe*: aggregate data is
 * served only when ALL of the following hold:
 *   1. the env switch is ON (a deliberate operator decision), and
 *   2. the caller supplies a reconciliation report that is 0-diff (source口径 == aggregate口径), and
 *   3. the aggregate loader actually returns rows (non-empty).
 * Otherwise it falls back to the live source reader and annotates `source: "live"`.
 *
 * It is pure except for the env read, with all IO injected, so it is fully unit-testable.
 * It does not change any existing reader by itself — adoption is a per-domain,
 * opt-in, reconcilable decision.
 */

export type CutoverDecision = {
  useAggregate: boolean;
  reason: "disabled" | "not-reconciled" | "no-report" | "aggregate-empty" | "ok";
};

/** Pure decision function. Kept separate from IO so it can be tested exhaustively. */
export function decideAggregateRead(args: {
  switchEnabled: boolean;
  reconcileOk: boolean | null;
  aggregateHasRows: boolean;
}): CutoverDecision {
  if (!args.switchEnabled) return { useAggregate: false, reason: "disabled" };
  if (args.reconcileOk === null) return { useAggregate: false, reason: "no-report" };
  if (args.reconcileOk !== true) return { useAggregate: false, reason: "not-reconciled" };
  if (!args.aggregateHasRows) return { useAggregate: false, reason: "aggregate-empty" };
  return { useAggregate: true, reason: "ok" };
}

export function aggregateReadEnabled(): boolean {
  return process.env.SELLFOX_AGG_READ_ENABLED === "true";
}

export type GatedReadResult<T> = {
  body: T;
  source: "aggregate" | "live";
  decision: CutoverDecision;
};

/**
 * Read through the aggregate table only when the cutover gate passes. All IO is
 * injected: `loadAggregate` returns null/[] when the table has no rows, and
 * `reconcileOk` is the 0-diff verdict from aggregate-reconcile. On any gate failure
 * (or a thrown aggregate read) it degrades to `loadLive` — never an empty page.
 */
export async function readAggregateOrLive<T>(args: {
  reconcileOk: boolean | null;
  loadAggregate: () => Promise<T | null | undefined>;
  loadLive: () => Promise<T>;
  isEmpty?: (value: T) => boolean;
  switchEnabled?: boolean;
}): Promise<GatedReadResult<T>> {
  const enabled = args.switchEnabled ?? aggregateReadEnabled();
  const probe = await (async (): Promise<{ decision: CutoverDecision; value: T | null }> => {
    if (!enabled) {
      return { decision: decideAggregateRead({ switchEnabled: false, reconcileOk: args.reconcileOk, aggregateHasRows: true }), value: null };
    }
    let aggregate: T | null | undefined;
    try {
      aggregate = await args.loadAggregate();
    } catch {
      aggregate = null; // aggregate read failure → live fallback, never surface an error page
    }
    const hasRows = aggregate != null && !(args.isEmpty ? args.isEmpty(aggregate) : false);
    const decision = decideAggregateRead({ switchEnabled: true, reconcileOk: args.reconcileOk, aggregateHasRows: hasRows });
    return { decision, value: hasRows ? (aggregate as T) : null };
  })();

  if (probe.decision.useAggregate && probe.value !== null) {
    return { body: probe.value, source: "aggregate", decision: probe.decision };
  }
  const body = await args.loadLive();
  return { body, source: "live", decision: probe.decision };
}

/**
 * 组合切换决策（供 reader 使用）：只有「env 总开关 ON + 该域对账 verdict=ok + 聚合有数据」
 * 三者同时成立才允许切读预聚合。verdict 读不到时默认 false（fail-closed → 走 live）。
 *
 * 这把此前孤立的 readAggregateOrLive 接上了真实的对账来源：
 * `sellfox:agg-reconcile --publish-verdict` 通过 0-diff 后写入 verdict，此处读取。
 */
export function resolveAggregateCutover(args: {
  switchEnabled: boolean;
  verdictOk: boolean;
  aggregateHasRows: boolean;
}): CutoverDecision {
  if (!args.switchEnabled) return { useAggregate: false, reason: "disabled" };
  if (!args.verdictOk) return { useAggregate: false, reason: "not-reconciled" };
  if (!args.aggregateHasRows) return { useAggregate: false, reason: "aggregate-empty" };
  return { useAggregate: true, reason: "ok" };
}
