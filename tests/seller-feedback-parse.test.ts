import assert from "node:assert/strict";
import test from "node:test";
import { parseSellerFeedbackReport, sellerFeedbackReportType } from "../src/lib/amazon-sync/seller-feedback";

const TSV = [
  "Date\tRating\tComments\tResponse\tOrderID\tE-mail",
  "2026/11/20\t2\t包装破损，书角压坏了\t已联系买家补发\t123-4567890-1234567\tbuyer@example.com",
  "2026-11-19\t5\t很好\t\t\tbuyer2@example.com",
  "20.11.26\t1\t发错货\t\t\tbuyer3@example.com",
  "03/04/26\t4\t歧义日期应跳过\t\t\tx@example.com",
  "2026/11/18\t9\t非法星级应跳过\t\t\tx@example.com",
  "not-a-date\t3\t非法日期应跳过\t\t\tx@example.com",
].join("\n");

test("卖家反馈 TSV 解析：跳过表头、按格式解析日期、歧义与非法行跳过并留证", () => {
  const result = parseSellerFeedbackReport(TSV);
  assert.equal(sellerFeedbackReportType, "GET_SELLER_FEEDBACK_DATA");
  assert.equal(result.rawLines, 7);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map(r => r.feedbackDate), ["2026-11-20", "2026-11-19", "2026-11-20"]);
  assert.equal(result.rows[0].rating, 2);
  assert.equal(result.rows[0].comments, "包装破损，书角压坏了");
  assert.equal(result.rows[0].amazonOrderId, "123-4567890-1234567");
  assert.equal(result.rows[1].amazonOrderId, null);
  assert.equal(result.skippedLines, 4);
});

test("卖家反馈解析：空报告返回 0 行且 complete", () => {
  const result = parseSellerFeedbackReport("");
  assert.equal(result.rows.length, 0);
  assert.equal(result.complete, true);
});

test("卖家反馈解析：超长原件拒绝", () => {
  assert.throws(() => parseSellerFeedbackReport("x".repeat(20_000_001)), /大小限制/);
});
