import { FinanceParseError, parseFinancePage, type FinanceWindow } from "./finance";
import { digest } from "./approval-policy";
import { SyncInputError } from "./policy";

/** Only verified executable contracts belong here; unknown versions/shapes fail closed. */
export const financeParser = {
  sourceCode: "listTransactions", apiVersion: "2024-06-19", responseType: "JSON",
  structure: "payload.transactions", version: "finance-list-transactions.2024-06-19.v2",
  schemaVersion: "finance-detail.v1",
  compatibleVersions: ["finance-list-transactions.2024-06-19.v1"],
} as const;

export function parseFinanceResponse(raw: string, identity: { sourceCode: unknown; apiVersion: unknown; responseType: unknown }, window: FinanceWindow) {
  if (identity.sourceCode !== financeParser.sourceCode || identity.apiVersion !== financeParser.apiVersion || identity.responseType !== financeParser.responseType) throw new FinanceParseError("没有已验证的财务响应解析器。", "PARSER_NOT_REGISTERED");
  try {
    // This adapter validates the actual payload/transactions structure and exact
    // number tokens. It never guesses a different shape or maps unknown fields.
    const page = parseFinancePage(raw, window);
    return { page, parser: financeParser, resultDigest: digest({ transactions: page.transactions.map(row => ({ ...row, postedAt: row.postedAt.toISOString() })), nextTokenDigest: page.nextToken ? digest(page.nextToken) : null }) };
  } catch (error) {
    if (error instanceof FinanceParseError) throw error;
    if (error instanceof SyncInputError) throw new FinanceParseError(error.message, "RESPONSE_SCHEMA", null, "/payload/transactions");
    throw error;
  }
}

/** A capacity-only upgrade is explicitly compatible; semantic changes require review. */
export function financeParserCanRecover(previousVersion: string | null, legacyError: string | null) {
  if (previousVersion !== null) return (financeParser.compatibleVersions as readonly string[]).includes(previousVersion);
  return ["财务响应不是安全、有效的 JSON。", "财务响应超过单页 JSON 值数量限制。"].includes(legacyError ?? "");
}
