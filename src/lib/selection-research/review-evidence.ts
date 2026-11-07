/** An adapter maps actual provider fields into this envelope; missing fields remain null. */
export interface ReviewEvidence {
  evidenceId: string; asin: string; reviewId: string | null; stars: number | null;
  date: string | null; variant: string | null; body: string | null;
  scope: "current_child" | "parent_history" | "unknown";
  relevant: boolean | null; applicable: boolean | null;
}
export interface ReviewProblem {
  category: string; reviewKeys: string[]; severity: number; improvementValue: number; suggestion: string;
}
const bodyKey = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();

/** No sentiment/category inference here: AI labels must point back to actual retained reviews. */
export function prepareLowStarReviews(rows: ReviewEvidence[]) {
  const retained: (ReviewEvidence & { key: string })[] = [];
  const excluded: { row: ReviewEvidence; reason: string }[] = [];
  const seenIds = new Set<string>(), seenBodies = new Set<string>();
  for (const row of rows) {
    if (!row || !["current_child", "parent_history", "unknown"].includes(row.scope) ||
      ![true, false, null].includes(row.relevant) || ![true, false, null].includes(row.applicable) ||
      [row.body, row.date, row.variant, row.reviewId].some(value => value !== null && typeof value !== "string")) throw new Error("INVALID_REVIEW_EVIDENCE");
    let reason: string | undefined;
    const body = row.body?.trim();
    const id = row.reviewId ? row.reviewId : undefined;
    const normalized = body ? `${row.asin}:${bodyKey(body)}` : undefined;
    if (!row.evidenceId || !row.asin) throw new Error("REVIEW_SOURCE_REQUIRED");
    if (!body) reason = "EMPTY_BODY";
    else if (row.stars === null || !Number.isInteger(row.stars) || row.stars < 1 || row.stars > 3) reason = "NOT_LOW_STAR";
    else if (row.relevant === false) reason = "UNRELATED_PRODUCT";
    else if (row.applicable === false) reason = "NOT_APPLICABLE";
    else if (id && seenIds.has(id) || normalized && seenBodies.has(normalized)) reason = "DUPLICATE";
    if (reason) { excluded.push({ row, reason }); continue; }
    if (id) seenIds.add(id);
    if (normalized) seenBodies.add(normalized);
    retained.push({ ...row, key: `review-${retained.length + 1}` });
  }
  const currentChild = retained.filter(row => row.scope === "current_child").length;
  return { retained, excluded, counts: { currentChild, parentHistory: retained.filter(row => row.scope === "parent_history").length,
    unknownScope: retained.filter(row => row.scope === "unknown").length },
    limitations: ["评论样本不是总体问题发生率", ...(currentChild < 20 ? ["当前子体低星样本少于20条；问题频率置信度低（本地研究阈值）"] : []),
      ...(retained.some(row => !row.date || !row.variant || row.relevant === null || row.applicable === null) ? ["部分日期、变体、相关性或适用性待确认"] : [])] };
}

export function rankReviewProblems(reviews: ReturnType<typeof prepareLowStarReviews>, problems: ReviewProblem[]) {
  const byKey = new Map(reviews.retained.map(row => [row.key, row]));
  return problems.map(problem => {
    if (!problem.category.trim() || !problem.suggestion.trim() || !problem.reviewKeys.length ||
      [problem.severity, problem.improvementValue].some(value => !Number.isInteger(value) || value < 1 || value > 5)) throw new Error("INVALID_REVIEW_PROBLEM");
    const keys = [...new Set(problem.reviewKeys)];
    const evidence = keys.map(key => { const row = byKey.get(key); if (!row) throw new Error("REVIEW_EVIDENCE_MISSING"); return row; });
    return { ...problem, reviewKeys: keys, count: keys.length,
      currentChildCount: evidence.filter(row => row.scope === "current_child").length,
      evidenceIds: [...new Set(evidence.map(row => row.evidenceId))] };
  }).sort((a, b) => b.severity - a.severity || b.improvementValue - a.improvementValue || b.count - a.count);
}

/** MCP text blocks can contain JSON with escaped quotes/newlines; inspect decoded evidence. */
export function containsReviewBody(raw: unknown, body: string): boolean {
  if (typeof raw === "string") {
    if (raw === body) return true;
    if (/^[\s]*[\[{]/.test(raw)) {
      try { return containsReviewBody(JSON.parse(raw), body); } catch { return false; }
    }
    return false;
  }
  if (Array.isArray(raw)) return raw.some(value => containsReviewBody(value, body));
  if (raw && typeof raw === "object") return Object.values(raw).some(value => containsReviewBody(value, body));
  return false;
}
