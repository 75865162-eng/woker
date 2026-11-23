import { SyncInputError } from "./policy";

/** Seller Feedback Report（GET_SELLER_FEEDBACK_DATA）TSV 解析。
 * 列序（Amazon 官方）：Date, Rating, Comments, Response, OrderID, E-mail。
 * 邮箱是买家 PII：不落结构化列，仅保留在加密原件里。
 * 解析纪律：rating 非 1–5 的行视为无法识别（可能是表头或说明行），跳过并留证；不猜日期格式——只接受报告出现的显式格式。
 */
export const sellerFeedbackReportType = "GET_SELLER_FEEDBACK_DATA" as const;

export type SellerFeedbackRow = {
  feedbackDate: string; rating: number; comments: string; response: string;
  amazonOrderId: string | null;
};
export type SellerFeedbackParseResult = { rows: SellerFeedbackRow[]; skippedLines: number; rawLines: number; complete: boolean };

const knownHeader = new Set(["date", "rating", "comments", "response", "orderid", "e-mail", "email"]);
/** 报告日期格式随站点 locale 变化；仅接受这些显式格式，无法识别的行跳过。 */
function parseFeedbackDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s); // yyyy/MM/dd 或 yyyy-MM-dd
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s); // MM/dd/yy 或 dd/MM/yy——歧义，仅当第一段>12 时确定 dd/MM
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = 2000 + Number(m[3]);
    if (a > 12) return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (b > 12) return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null; // 歧义日期不猜，跳过
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(s); // dd.MM.yy（德/欧）
  if (m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function clean(value: string | undefined, limit: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
export function parseSellerFeedbackReport(text: string): SellerFeedbackParseResult {
  if (text.length > 20_000_000) throw new SyncInputError("卖家反馈报告原件超出大小限制。", 422);
  if (!text.trim()) return { rows: [], skippedLines: 0, rawLines: 0, complete: true };
  const lines = text.split(/\r?\n/).filter(line => line.length > 0);
  const rows: SellerFeedbackRow[] = [];
  let skippedLines = 0;
  for (const [index, line] of lines.entries()) {
    const cols = line.split("\t");
    const rating = Number((cols[1] ?? "").trim());
    const headerLike = clean(cols[0], 40).toLowerCase();
    if (index === 0 && [...knownHeader].some(h => headerLike === h)) { skippedLines++; continue; }
    const feedbackDate = parseFeedbackDate(cols[0] ?? "");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !feedbackDate) { skippedLines++; continue; }
    const orderRaw = clean(cols[4], 30);
    rows.push({
      feedbackDate, rating,
      comments: clean(cols[2], 4000), response: clean(cols[3], 4000),
      amazonOrderId: /^[\w-]{3,30}$/.test(orderRaw) ? orderRaw : null,
    });
  }
  return { rows, skippedLines, rawLines: lines.length, complete: rows.length > 0 || lines.length === 0 };
}
export function sellerFeedbackRowDigest(runId: string, row: SellerFeedbackRow, index: number): string {
  return `${runId}:${index}:${row.feedbackDate}:${row.rating}:${row.comments.length}:${row.response.length}:${row.amazonOrderId ?? ""}`;
}
