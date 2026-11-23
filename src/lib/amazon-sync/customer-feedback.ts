import { readFinanceJson, WireDecimal } from "./finance";
import { observationInvalid as invalid, type CustomerFeedbackPolicy } from "./observation-policy";
import { observationFact, type SafeFact } from "./observation-parsers";

/** Customer Feedback API v2024-06-01（只读评论话题洞察）契约。
 * 数据每周刷新、仅英文、限 US/UK/FR/IT/DE/ES/JP；需 Brand Analytics 或 Selling Partner Insights 角色。
 * 本域是 Amazon 外部观察，不覆盖商品 Review 明细，也不伪造逐日趋势。
 */
export const customerFeedbackContract = {
  version: "2024-06-01",
  api: "Customer Feedback API",
  operations: ["getItemReviewTopics", "getItemReviewTrends"],
  sortBy: ["MENTIONS", "STAR_RATING_IMPACT"],
  refresh: "WEEKLY",
  language: "EN_ONLY",
  regions: ["US", "UK", "FR", "IT", "DE", "ES", "JP"],
  roles: ["Brand Analytics", "Selling Partner Insights"],
} as const;

export const customerFeedbackKinds = {
  topicsMentions: "REVIEW_TOPICS_MENTIONS",
  topicsImpact: "REVIEW_TOPICS_IMPACT",
  trends: "REVIEW_TRENDS",
} as const;

type Wire = ReturnType<typeof readFinanceJson>;
const isObj = (v: Wire): v is Record<string, Wire> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof WireDecimal);
const arr = (v: Wire | undefined, max: number): Wire[] => v === undefined || v === null ? [] : Array.isArray(v) && v.length <= max ? v : invalid();
const label = (v: Wire, max = 500): string => typeof v === "string" && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v : invalid();
/** 评论摘录允许换行制表，但禁止其它控制字符，避免注入与日志污染。 */
const snippet = (v: Wire, max = 2000): string => typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) ? v : invalid();

/** 话题指标数值按线上 JSON 词法原样保真为字符串，避免二进制浮点往返。 */
function wireNum(v: Wire): string {
  return v instanceof WireDecimal && Number.isFinite(Number(v.source)) ? v.source : invalid();
}
const METRIC_KEYS = ["numberOfMentions", "occurrencePercentage", "starRatingImpact", "negativeFeedbackRate", "positiveFeedbackRate"] as const;
function metrics(v: Wire | undefined): Record<string, string> {
  if (v === undefined || v === null) return {};
  const row = isObj(v) ? v : invalid(), result: Record<string, string> = {};
  for (const key of METRIC_KEYS) if (row[key] !== undefined && row[key] !== null) result[key] = wireNum(row[key]);
  return result;
}
function dateRange(v: Wire | undefined): { startDate: string | null; endDate: string | null } | null {
  if (v === undefined || v === null) return null;
  const row = isObj(v) ? v : invalid();
  return { startDate: row.startDate === undefined || row.startDate === null ? null : label(row.startDate, 40), endDate: row.endDate === undefined || row.endDate === null ? null : label(row.endDate, 40) };
}

type Topic = {
  topic: string;
  asinMetrics: Record<string, string>;
  parentAsinMetrics: Record<string, string> | null;
  browseNodeMetrics: Record<string, string> | null;
  childAsinMetrics: Record<string, string> | null;
  reviewSnippets: string[];
  subtopics: Array<{ subtopic: string; metrics: Record<string, string>; reviewSnippets: string[] }>;
};
function topic(v: Wire, withSubtopics: boolean): Topic {
  const row = isObj(v) ? v : invalid();
  const subtopics = withSubtopics ? arr(row.subtopics, 5).map(value => {
    const sub = isObj(value) ? value : invalid();
    return { subtopic: label(sub.subtopic), metrics: metrics(sub.metrics), reviewSnippets: arr(sub.reviewSnippets, 3).map(s => snippet(s)) };
  }) : [];
  return {
    topic: label(row.topic),
    asinMetrics: metrics(row.asinMetrics),
    parentAsinMetrics: row.parentAsinMetrics === undefined || row.parentAsinMetrics === null ? null : metrics(row.parentAsinMetrics),
    browseNodeMetrics: row.browseNodeMetrics === undefined || row.browseNodeMetrics === null ? null : metrics(row.browseNodeMetrics),
    childAsinMetrics: row.childAsinMetrics === undefined || row.childAsinMetrics === null ? null : metrics(row.childAsinMetrics),
    reviewSnippets: arr(row.reviewSnippets, 3).map(s => snippet(s)),
    subtopics,
  };
}

type TrendMetric = { dateRange: { startDate: string | null; endDate: string | null } | null; asinMetrics: Record<string, string>; parentAsinMetrics: Record<string, string> | null; browseNodeMetrics: Record<string, string> | null };
type TrendTopic = { topic: string; trendMetrics: TrendMetric[] };
function trendTopic(v: Wire): TrendTopic {
  const row = isObj(v) ? v : invalid();
  return {
    topic: label(row.topic),
    trendMetrics: arr(row.trendMetrics, 6).map(value => {
      const m = isObj(value) ? value : invalid();
      return {
        dateRange: dateRange(m.dateRange),
        asinMetrics: metrics(m.asinMetrics),
        parentAsinMetrics: m.parentAsinMetrics === undefined || m.parentAsinMetrics === null ? null : metrics(m.parentAsinMetrics),
        browseNodeMetrics: m.browseNodeMetrics === undefined || m.browseNodeMetrics === null ? null : metrics(m.browseNodeMetrics),
      };
    }),
  };
}

function envelope(root: Wire, asin: string, marketplaceId: string) {
  const row = isObj(root) ? root : invalid();
  if (row.asin !== undefined && row.asin !== null && row.asin !== asin) return invalid("评论洞察 ASIN 与请求不一致。");
  if (row.marketplaceId !== undefined && row.marketplaceId !== null && row.marketplaceId !== marketplaceId) return invalid("评论洞察站点与请求不一致。");
  return {
    asin,
    itemName: row.itemName === undefined || row.itemName === null ? null : label(row.itemName, 300),
    marketplaceId,
    countryCode: row.countryCode === undefined || row.countryCode === null ? null : label(row.countryCode, 2),
    dateRange: dateRange(row.dateRange),
  };
}

export type FeedbackPhase = "topics-mentions" | "topics-impact" | "trends";

/** 单个响应 → 单条安全事实。数字字段保真为字符串；未知字段丢弃；不伪造缺失指标。 */
export function parseCustomerFeedback(raw: string, policy: CustomerFeedbackPolicy, asinIndex: number, marketplaceId: string, phase: FeedbackPhase): SafeFact[] {
  const asin = policy.asins[asinIndex];
  if (!asin) return invalid();
  const root = readFinanceJson(raw);
  const base = envelope(root, asin, marketplaceId);
  const common = {
    ...base,
    sourceApi: customerFeedbackContract.api,
    apiVersion: customerFeedbackContract.version,
    refresh: "WEEKLY" as const,
    availability: "EN_ONLY_US_UK_FR_IT_DE_ES_JP" as const,
    historicalComplete: false as const,
    accountUniverseComplete: false as const,
    decimalEncoding: "JSON_NUMERIC_STRINGS" as const,
    replacesProductReviewDetail: false as const,
  };
  if (phase === "trends") {
    const row = isObj(root) ? root : invalid();
    const trends = isObj(row.reviewTrends) ? row.reviewTrends : invalid();
    return [observationFact(customerFeedbackKinds.trends, [asin, marketplaceId, "trends"], {
      ...common,
      positiveTopics: arr(trends.positiveTopics, 10).map(trendTopic),
      negativeTopics: arr(trends.negativeTopics, 10).map(trendTopic),
    }, { asin })];
  }
  const row = isObj(root) ? root : invalid();
  const topics = isObj(row.topics) ? row.topics : invalid();
  const sortBy = phase === "topics-impact" ? "STAR_RATING_IMPACT" : "MENTIONS";
  const kind = phase === "topics-impact" ? customerFeedbackKinds.topicsImpact : customerFeedbackKinds.topicsMentions;
  return [observationFact(kind, [asin, marketplaceId, sortBy], {
    ...common,
    sortBy,
    positiveTopics: arr(topics.positiveTopics, 10).map(v => topic(v, true)),
    negativeTopics: arr(topics.negativeTopics, 10).map(v => topic(v, true)),
  }, { asin })];
}
