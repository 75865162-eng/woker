type RecoveryPage = {
  records: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageCount: number;
  hasMore: boolean;
  coverageStatus: string;
  evidenceRefs?: unknown[];
};

type RecoveryDataset = { pages: RecoveryPage[]; error?: string };
const readableCoverage = new Set(["COMPLETE", "HISTORY_INCOMPLETE"]);

function inspectDataset(dataset: RecoveryDataset) {
  const pages = [...dataset.pages].sort((a, b) => a.page - b.page);
  const first = pages[0];
  const emptyPage = !!first && first.page === 1 && first.pageCount === 0 && first.total === 0 && !first.hasMore && first.records.length === 0 && pages.length === 1;
  const records = pages.flatMap(page => page.records);
  const recordCountMatchesTotal = !!first && records.length === first.total;
  const traversed = emptyPage || !!first && first.page === 1 && first.pageCount > 0 && pages.length === first.pageCount && recordCountMatchesTotal && pages.every((page, index) =>
    page.page === index + 1 && page.total === first.total && page.pageCount === first.pageCount && page.hasMore === (page.page < page.pageCount));
  const coverageStatuses = [...new Set(pages.map(page => page.coverageStatus))];
  return { records, pages, total: first?.total ?? 0, recordCountMatchesTotal, emptyPage, traversed,
    coverageStatuses, historicalIncomplete: coverageStatuses.includes("HISTORY_INCOMPLETE"),
    blocked: !!dataset.error || !first || coverageStatuses.some(status => !readableCoverage.has(status)), error: dataset.error ?? null };
}

function sumInteger(rows: Array<Record<string, unknown>>, field: string, signed = false) {
  const pattern = signed ? /^-?\d{1,9}$/ : /^\d{1,9}$/;
  let sum = BigInt(0), missingRows = 0, invalidRows = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "string" || !pattern.test(value)) {
      if (value === null || value === undefined || value === "") missingRows++; else invalidRows++;
      continue;
    }
    sum += BigInt(value);
  }
  return { original: invalidRows || missingRows ? null : sum.toString(), missingRows, invalidRows };
}

function moneyTotals(rows: Array<Record<string, unknown>>, amountField: string, currencyField: string, separateByReport: boolean) {
  const groups = new Map<string, { currency: string; reportId: string | null; coefficient: bigint; scale: number; rows: number; invalidRows: number }>();
  let missingCurrencyRows = 0, missingAmountRows = 0;
  for (const row of rows) {
    const amount = row[amountField], currency = row[currencyField];
    if (typeof amount !== "string" || !amount.trim()) { missingAmountRows++; continue; }
    if (typeof currency !== "string" || !currency.trim()) { missingCurrencyRows++; continue; }
    const match = /^(-?)(\d{1,30})(?:\.(\d{1,18}))?$/.exec(amount);
    const reportId = separateByReport ? typeof row.reportId === "string" ? row.reportId : null : null;
    const key = `${reportId ?? ""}\u0000${currency}`;
    const group = groups.get(key) ?? { currency, reportId, coefficient: BigInt(0), scale: 0, rows: 0, invalidRows: 0 };
    if (!match) { group.invalidRows++; groups.set(key, group); continue; }
    const fraction = match[3] ?? "", scale = fraction.length, coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
    const nextScale = Math.max(group.scale, scale);
    group.coefficient = group.coefficient * BigInt(10) ** BigInt(nextScale - group.scale) + coefficient * BigInt(10) ** BigInt(nextScale - scale);
    group.scale = nextScale; group.rows++;
    groups.set(key, group);
  }
  return { byCurrencyAndReport: [...groups.values()].sort((a, b) => (a.reportId ?? "").localeCompare(b.reportId ?? "") || a.currency.localeCompare(b.currency)).map(group => ({
    reportId: group.reportId, currency: group.currency, amountOriginal: group.invalidRows ? null : formatDecimal(group.coefficient, group.scale), rows: group.rows, invalidRows: group.invalidRows,
  })), missingCurrencyRows, missingAmountRows };
}

function quantityByReport(rows: Array<Record<string, unknown>>, field: string, signed: boolean) {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const key = `${typeof row.reportId === "string" ? row.reportId : "UNKNOWN_REPORT"}\u0000${typeof row.eventType === "string" ? row.eventType : ""}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const [reportId, eventType] = key.split("\u0000");
    const totals = sumInteger(group, field, signed);
    const absolute = signed ? sumInteger(group.map(row => ({ [field]: typeof row[field] === "string" && /^-?\d{1,9}$/.test(row[field] as string) ? (BigInt(row[field] as string) < BigInt(0) ? (-BigInt(row[field] as string)).toString() : row[field]) : row[field] })), field) : null;
    return { reportId, ...(eventType ? { eventType } : {}), ...totals, ...(absolute ? { absoluteOriginal: absolute.original } : {}) };
  });
}

function formatDecimal(coefficient: bigint, scale: number) {
  if (scale === 0) return coefficient.toString();
  const negative = coefficient < BigInt(0), digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, -scale), fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function evidenceFor(row: Record<string, unknown>) {
  const document = row.document && typeof row.document === "object" ? row.document as Record<string, unknown> : null;
  return {
    ...(typeof row.sourceId === "string" ? { sourceId: row.sourceId } : {}),
    ...(typeof row.sourceRunId === "string" ? { sourceRunId: row.sourceRunId } : {}),
    ...(typeof row.reportId === "string" ? { reportId: row.reportId } : {}),
    ...(typeof row.rowNumber === "number" ? { rowNumber: row.rowNumber } : {}),
    ...(document && typeof document.id === "string" ? { reportDocumentId: document.id } : {}),
    ...(typeof row.transactionId === "string" ? { transactionId: row.transactionId } : {}),
  };
}

/** Analyze only complete traversals of the returned bounded query. No inferred
 * event/payment joins: the current reports expose no verified shared key. */
export function analyzeReimbursementRecovery(input: { events: RecoveryDataset; payments: RecoveryDataset; finance: RecoveryDataset }) {
  const events = inspectDataset(input.events), payments = inspectDataset(input.payments), finance = inspectDataset(input.finance);
  const eventRows = events.records.map(row => {
    const raw = row.unreconciledQuantityOriginal;
    const valid = typeof raw === "string" && /^-?\d{1,9}$/.test(raw);
    const quantity = valid ? BigInt(raw) : null;
    const paymentStatus = !valid ? "UNABLE_TO_CONFIRM" : quantity === BigInt(0) ? "NO_UNRECONCILED_QUANTITY" : "UNABLE_TO_CONFIRM";
    return { ...row, recoveryStatus: !valid ? "NEEDS_REVIEW" : quantity === BigInt(0) ? "NO_UNRECONCILED_QUANTITY" : "UNMATCHED",
      paymentStatus, linkageBasis: "NO_VERIFIED_EVENT_PAYMENT_KEY", evidence: row.evidenceRefs ?? evidenceFor(row) };
  });
  const eventQuantities = quantityByReport(eventRows, "unreconciledQuantityOriginal", true);
  const reimbursementQuantities = quantityByReport(payments.records, "reimbursementQuantityOriginal", false);
  const cashQuantities = quantityByReport(payments.records, "cashQuantityOriginal", false);
  const inventoryQuantities = quantityByReport(payments.records, "inventoryQuantityOriginal", false);
  const paymentMoney = moneyTotals(payments.records, "amountTotalOriginal", "currencyCode", true);
  const financeMoney = moneyTotals(finance.records, "originalAmount", "currency", false);
  const financeByOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const row of finance.records) if (typeof row.orderId === "string" && row.orderId.trim()) {
    financeByOrder.set(row.orderId, [...(financeByOrder.get(row.orderId) ?? []), row]);
  }
  const datasets = { events, payments, finance };
  const queryComplete = Object.values(datasets).every(dataset => dataset.traversed && !dataset.blocked && !dataset.historicalIncomplete);
  const warnings = Object.entries(datasets).flatMap(([name, dataset]) => [
    ...(!dataset.traversed ? [`${name}:PAGINATION_INCOMPLETE`] : []),
    ...(!dataset.recordCountMatchesTotal && !dataset.emptyPage ? [`${name}:ROW_COUNT_DOES_NOT_MATCH_TOTAL`] : []),
    ...(dataset.emptyPage ? [`${name}:EMPTY_RESULT_REQUIRES_COVERAGE_REVIEW`] : []),
    ...(dataset.blocked ? [`${name}:SOURCE_OR_COVERAGE_BLOCKED`] : []),
    ...(dataset.historicalIncomplete ? [`${name}:HISTORY_INCOMPLETE`] : []),
    ...(dataset.error ? [`${name}:${dataset.error}`] : []),
  ]);
  if (eventRows.some(row => row.recoveryStatus === "UNMATCHED")) warnings.push("事件未核销量不能证明赔付状态；事件与赔付记录没有已验证的共同关联键。未匹配不等于未赔付。");
  if (paymentMoney.missingCurrencyRows) warnings.push("赔付金额存在缺失币种，未纳入币种汇总。");
  if (paymentMoney.byCurrencyAndReport.some(group => group.invalidRows)) warnings.push("部分赔付金额不是可安全汇总的标准十进制原文，保留原记录并跳过金额合计。");
  return {
    status: queryComplete ? "ANALYZED_WITH_UNMATCHED_RECORDS" : "PARTIAL_DATA",
    queryComplete,
    linkagePolicy: "EXACT_VERIFIED_SOURCE_KEY_ONLY",
    events: { total: events.total, traversed: events.traversed, unreconciledQuantityByReportAndEventType: eventQuantities, records: eventRows },
    payments: { total: payments.total, traversed: payments.traversed, reimbursementQuantityByReport: reimbursementQuantities, cashQuantityByReport: cashQuantities, inventoryQuantityByReport: inventoryQuantities, amountTotals: paymentMoney, records: payments.records.map(row => {
      const candidates = typeof row.orderId === "string" ? financeByOrder.get(row.orderId) ?? [] : [];
      return { ...row, recoveryStatus: "UNMATCHED", evidence: row.evidenceRefs ?? evidenceFor(row),
        financeCrossCheck: candidates.length ? { status: "ORDER_ID_MATCH_NEEDS_REVIEW", basis: "EXACT_ORDER_ID_NOT_EVENT_PROOF",
          candidates: candidates.map(candidate => ({ transactionId: candidate.transactionId ?? null, transactionType: candidate.transactionType ?? null, originalAmount: candidate.originalAmount ?? null,
            currency: candidate.currency ?? null, evidence: candidate.evidenceRefs ?? evidenceFor(candidate) })) }
          : { status: "NO_ORDER_LEVEL_FINANCE_MATCH", basis: typeof row.orderId === "string" ? "NO_FINANCE_TRANSACTION_WITH_EXACT_ORDER_ID" : "ORDER_ID_NOT_RETURNED", candidates: [] } };
    }) },
    finance: { total: finance.total, traversed: finance.traversed, amountTotals: financeMoney, records: finance.records.map(row => ({ ...row, eventLinkStatus: "UNMATCHED", evidence: row.evidenceRefs ?? evidenceFor(row) })) },
    evidenceRefs: {
      events: eventRows.map(row => row.evidence),
      payments: payments.records.map(row => row.evidenceRefs ?? evidenceFor(row)),
      finance: finance.records.map(row => row.evidenceRefs ?? evidenceFor(row)),
    },
    classifications: { paid: 0, partiallyPaid: 0, unpaid: 0, unmatched: eventRows.filter(row => row.recoveryStatus === "UNMATCHED").length,
      needsReview: eventRows.filter(row => row.recoveryStatus === "NEEDS_REVIEW").length, unableToConfirm: eventRows.filter(row => row.paymentStatus === "UNABLE_TO_CONFIRM").length },
    coverage: Object.fromEntries(Object.entries(datasets).map(([name, dataset]) => [name, { total: dataset.total, returnedRows: dataset.records.length, recordCountMatchesTotal: dataset.recordCountMatchesTotal, traversed: dataset.traversed, coverageStatuses: dataset.coverageStatuses, error: dataset.error }])),
    warnings,
  };
}
