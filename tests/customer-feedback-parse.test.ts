import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerFeedback, customerFeedbackContract } from "../src/lib/amazon-sync/customer-feedback";
import type { CustomerFeedbackPolicy } from "../src/lib/amazon-sync/observation-policy";

const policy: CustomerFeedbackPolicy = {
  resource: "customer_feedback", applicationId: "app", maxRequests: 1000, maxRows: 50000,
  requestsPerSecond: 0.1, asins: ["B0ABCDEF12"],
};

const topicsResponse = JSON.stringify({
  asin: "B0ABCDEF12", itemName: "Sample Product", marketplaceId: "ATVPDKIKX0DER", countryCode: "US",
  dateRange: { startDate: "2025-01-01T00:00:00Z", endDate: "2025-06-30T00:00:00Z" },
  topics: {
    positiveTopics: [{ topic: "great battery", asinMetrics: { numberOfMentions: 120, occurrencePercentage: 12.5, starRatingImpact: 4.2 }, reviewSnippets: ["lasts all day"], subtopics: [{ subtopic: "fast charge", metrics: { numberOfMentions: 30 }, reviewSnippets: [] }] }],
    negativeTopics: [{ topic: "weak cable", asinMetrics: { numberOfMentions: 8, occurrencePercentage: 0.9, starRatingImpact: 2.1 } }],
  },
});

const trendsResponse = JSON.stringify({
  asin: "B0ABCDEF12", marketplaceId: "ATVPDKIKX0DER",
  reviewTrends: {
    positiveTopics: [{ topic: "great battery", trendMetrics: [{ dateRange: { startDate: "2025-05-01T00:00:00Z", endDate: "2025-05-31T00:00:00Z" }, asinMetrics: { numberOfMentions: 20, occurrencePercentage: 11.1 } }] }],
    negativeTopics: [],
  },
});

test("Customer Feedback topics 解析：白名单、字符串保真、身份绑定", () => {
  const rows = parseCustomerFeedback(topicsResponse, policy, 0, "ATVPDKIKX0DER", "topics-mentions");
  assert.equal(rows.length, 1);
  const f = rows[0].facts as Record<string, unknown>;
  assert.equal(rows[0].asin, "B0ABCDEF12");
  assert.equal(f.sortBy, "MENTIONS");
  assert.equal(f.apiVersion, "2024-06-01");
  assert.equal(f.historicalComplete, false);
  const pos = f.positiveTopics as Array<Record<string, unknown>>;
  assert.equal(pos.length, 1);
  assert.equal((pos[0].asinMetrics as Record<string, unknown>).numberOfMentions, "120");
  assert.equal((pos[0].asinMetrics as Record<string, unknown>).occurrencePercentage, "12.5");
});

test("Customer Feedback trend 解析：趋势主题与月份区间", () => {
  const rows = parseCustomerFeedback(trendsResponse, policy, 0, "ATVPDKIKX0DER", "trends");
  assert.equal(rows.length, 1);
  const f = rows[0].facts as Record<string, unknown>;
  assert.equal(f.sortBy, undefined);
  const pos = f.positiveTopics as Array<Record<string, unknown>>;
  const tm = (pos[0].trendMetrics as Array<Record<string, unknown>>)[0];
  assert.equal(tm.month !== undefined || tm.dateRange !== undefined, true);
  assert.equal(((tm.asinMetrics as Record<string, unknown>).numberOfMentions), "20");
});

test("Customer Feedback 拒绝 ASIN/站点不一致（防串域）", () => {
  assert.throws(() => parseCustomerFeedback(topicsResponse, policy, 0, "A1PA6795UKMFR9", "topics-mentions"));
});

test("契约版本固定为 2024-06-01", () => {
  assert.equal(customerFeedbackContract.version, "2024-06-01");
});
