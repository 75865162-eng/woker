import { SyncInputError } from "./policy";
import { Prisma } from "@prisma/client";

/** Finances v2024-06-19 listTransactions response adapter only. No transport,
 * authorization scope selection, persistence or implicit marketplace fallback.
 * https://developer-docs.amazon.com/sp-api/reference/listtransactions
 * https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-reference
 * Transaction.transactionId is the real unique ID. BigDecimal is JSON number,
 * unlike Orders Decimal (string); never decode money through JS Number.
 */
const maxPageBytes = 4 * 1024 * 1024;
const maxValues = 100000;
const maxDepth = 64;
const maxTransactions = 5000;
class WireDecimal {
  constructor(readonly source: string) {}
}
type WireValue = null | boolean | string | WireDecimal | WireValue[] | { [key: string]: WireValue };

/** Bounded, finance-local JSON reader. Native JSON.parse is used only for
 * individual string tokens (no number conversion or reviver-context dependency).
 * Duplicate decoded keys fail closed, including escaped aliases of money keys.
 * Errors never echo source text, parser context or upstream exception messages.
 */
function readFinanceJson(source: string): WireValue {
  if (typeof source !== "string" || source.length > maxPageBytes || new TextEncoder().encode(source).byteLength > maxPageBytes) throw new SyncInputError("财务响应超过单页大小限制。");
  let offset = 0, values = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const invalid = (): never => { throw new SyncInputError("财务响应不是安全、有效的 JSON。"); };
  const whitespace = () => { while (offset < source.length && /[\x20\t\r\n]/.test(source[offset])) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === "\\") { offset++; continue; }
      if (character === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string; } catch { return invalid(); }
      }
    }
    return invalid();
  };
  const value = (depth: number): WireValue => {
    if (++values > maxValues || depth > maxDepth) return invalid();
    whitespace();
    const character = source[offset];
    if (character === '"') return string();
    if (character === "{") {
      offset++; whitespace();
      const result: { [key: string]: WireValue } = Object.create(null);
      if (source[offset] === "}") { offset++; return result; }
      while (offset < source.length) {
        if (source[offset] !== '"') return invalid();
        const key = string(); whitespace();
        if (Object.hasOwn(result, key) || source[offset++] !== ":") return invalid();
        result[key] = value(depth + 1); whitespace();
        const delimiter = source[offset++];
        if (delimiter === "}") return result;
        if (delimiter !== ",") return invalid();
        whitespace();
      }
      return invalid();
    }
    if (character === "[") {
      offset++; whitespace(); const result: WireValue[] = [];
      if (source[offset] === "]") { offset++; return result; }
      while (offset < source.length) {
        result.push(value(depth + 1)); whitespace();
        const delimiter = source[offset++];
        if (delimiter === "]") return result;
        if (delimiter !== ",") return invalid();
      }
      return invalid();
    }
    for (const [literal, decoded] of [["true", true], ["false", false], ["null", null]] as const) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return decoded; }
    }
    number.lastIndex = offset;
    const match = number.exec(source);
    if (!match || match[0].length > 200) return invalid();
    offset = number.lastIndex;
    return new WireDecimal(match[0]);
  };
  const result = value(0); whitespace();
  if (offset !== source.length) return invalid();
  return result;
}

function object(value: WireValue | undefined): { [key: string]: WireValue } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof WireDecimal) throw new SyncInputError("财务响应结构无效。");
  return value;
}
function identifier(value: WireValue | undefined, required = false): string | null {
  if ((value === undefined || value === null) && !required) return null;
  if (typeof value !== "string" || !value.length || value.length > 500 || /[\x00-\x20\x7f]/.test(value)) throw new SyncInputError("财务交易标识缺失或格式无效；未生成替代主键。");
  return value;
}
function code(value: WireValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)) throw new SyncInputError("财务交易类型或状态格式无效。");
  return value;
}
function timestamp(value: unknown): Date {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value) : null;
  if (!match) throw new SyncInputError("财务入账时间格式无效或精度超出毫秒。");
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== (value as string).slice(0, 10) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[9] ?? 0) > 23 || Number(match[10] ?? 0) > 59) throw new SyncInputError("财务入账时间不存在。");
  const date = new Date(value as string);
  if (!Number.isFinite(date.getTime())) throw new SyncInputError("财务入账时间无效。");
  return date;
}

export type FinanceWindow = { from: string; to: string };
export type FinanceMoney = { original: string; currency: string };
export type FinanceTransaction = {
  transactionId: string;
  postedAt: Date;
  transactionType: string | null;
  rawStatus: string | null;
  orderId: string | null;
  classification: "ORDER_RELATED" | "NON_ORDER";
  sellingPartnerId: string | null;
  metadataMarketplaceId: string | null;
  detailsMarketplaceId: string | null;
  amount: FinanceMoney;
};

function money(value: WireValue | undefined): FinanceMoney {
  const row = object(value), amount = row.currencyAmount;
  if (!(amount instanceof WireDecimal) || typeof row.currencyCode !== "string" || !/^[A-Z]{3}$/.test(row.currencyCode)) throw new SyncInputError("财务金额必须为原始 JSON 数字并带有效币种。");
  const match = /^-?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d{1,4}))?$/.exec(amount.source);
  if (!match) throw new SyncInputError("财务金额指数或格式超出安全范围。");
  // Number is used ONLY for the bounded exponent, never for currencyAmount.
  const exponent = Number(match[3] ?? 0), fraction = match[2] ?? "";
  const significant = `${match[1]}${fraction}`.replace(/^0+/, "");
  const scale = fraction.length - exponent;
  if (Math.abs(exponent) > 1000 || (significant && (scale > 30 || significant.length - scale > 35))) throw new SyncInputError("财务金额超出 NUMERIC(65,30) 无损存储范围，未舍入。");
  return { original: amount.source, currency: row.currencyCode };
}

/** Decode ONE response page. Attribution fields stay separate until the caller's
 * approved scope policy resolves them; missing sites never inherit a bound site.
 * Optional model transactionId is mandatory for this ERP's idempotent ingestion.
 */
export function parseFinancePage(rawBody: string, window: FinanceWindow): { transactions: FinanceTransaction[]; nextToken?: string } {
  const from = timestamp(window.from), to = timestamp(window.to);
  if (to <= from || to.getTime() - from.getTime() > 180 * 86400000) throw new SyncInputError("财务入账窗口须为不超过 180 天的有效范围。");
  const root = object(readFinanceJson(rawBody));
  if (root.errors !== undefined && (!Array.isArray(root.errors) || root.errors.length)) throw new SyncInputError("财务响应包含上游错误，未解析交易。");
  const payload = object(root.payload);
  if (!Array.isArray(payload.transactions) || payload.transactions.length > maxTransactions) throw new SyncInputError("财务响应缺少交易数组或超过单页容量。");
  const token = payload.nextToken;
  if (token != null && (typeof token !== "string" || !token.trim() || token.length > 32000)) throw new SyncInputError("财务分页游标格式无效。");
  const seen = new Set<string>();
  const transactions = payload.transactions.map(raw => {
    const row = object(raw), transactionId = identifier(row.transactionId, true)!;
    if (seen.has(transactionId)) throw new SyncInputError("财务单页出现重复交易标识，未提交该页。");
    seen.add(transactionId);
    const postedAt = timestamp(row.postedDate);
    if (postedAt < from || postedAt >= to) throw new SyncInputError("财务入账时间超出批准窗口。");
    const metadata = row.sellingPartnerMetadata == null ? null : object(row.sellingPartnerMetadata);
    const details = row.marketplaceDetails == null ? null : object(row.marketplaceDetails);
    const orderIds = new Set<string>();
    if (row.relatedIdentifiers != null) {
      if (!Array.isArray(row.relatedIdentifiers) || row.relatedIdentifiers.length > 1000) throw new SyncInputError("财务关联标识结构无效。");
      for (const entry of row.relatedIdentifiers) {
        const related = object(entry);
        if (related.relatedIdentifierName === "ORDER_ID") orderIds.add(identifier(related.relatedIdentifierValue, true)!);
      }
    }
    if (orderIds.size > 1) throw new SyncInputError("财务交易包含多个不同订单关联，未猜测归属。");
    const orderId = orderIds.values().next().value ?? null;
    return { transactionId, postedAt, transactionType: code(row.transactionType), rawStatus: code(row.transactionStatus), orderId, classification: orderId ? "ORDER_RELATED" as const : "NON_ORDER" as const,
      sellingPartnerId: identifier(metadata?.sellingPartnerId), metadataMarketplaceId: identifier(metadata?.marketplaceId), detailsMarketplaceId: identifier(details?.marketplaceId), amount: money(row.totalAmount) };
  });
  return { transactions, ...(typeof token === "string" ? { nextToken: token } : {}) };
}

/** Role metadata is administrator-attested, not an Amazon introspection result.
 * https://developer-docs.amazon.com/sp-api/docs/finances-api-v2024-06-19-use-case-guide
 */
export function assertFinanceRoles(auth: { approvedRoles: string[]; rolesAttestedAt: Date | null }) {
  if (!auth.rolesAttestedAt || !auth.approvedRoles.includes("Finance and Accounting")) throw new SyncInputError("财务同步缺少已确认的 Finance and Accounting 角色，请管理员核对并审批。", 403);
}

export type FinancePolicy = {
  initialFrom: string; windowMinutes: number; overlapSeconds: number; safetyLagSeconds: number;
  applicationId: string; requestsPerSecond: number; burst: number;
  sellerWide: true; collectUnattributed: true;
  marketplaces: Array<{ marketplaceId: string; marketplaceTimeZone: string }>;
  fx: { targetCurrency: string; scale: number; rounding: "HALF_UP" | "HALF_EVEN" | "DOWN"; rates: Array<{ currency: string; rate: string; source: string; version: string; from: string; to: string }> } | null;
};
function configObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("财务策略配置无效。");
  return value as Record<string, unknown>;
}
function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new SyncInputError("财务窗口或预算配置超出范围。");
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)) throw new SyncInputError("财务配置需使用非敏感标识代码。");
  return value;
}
function utcConfig(value: unknown): string {
  const result = timestamp(value);
  if (typeof value !== "string" || !value.endsWith("Z")) throw new SyncInputError("财务策略日期须为 UTC。");
  return result.toISOString();
}
export function parseFinancePolicy(value: unknown): FinancePolicy {
  const p = configObject(value);
  if (p.sellerWide !== true || p.collectUnattributed !== true) throw new SyncInputError("财务策略须明确批准卖家级采集及未知归属加密隔离。");
  if (!Array.isArray(p.marketplaces) || !p.marketplaces.length || p.marketplaces.length > 30) throw new SyncInputError("财务策略须明确所有批准站点及其时区。");
  const marketplaces = p.marketplaces.map(raw => {
    const m = configObject(raw), marketplaceId = label(m.marketplaceId);
    if (typeof m.marketplaceTimeZone !== "string" || m.marketplaceTimeZone.length > 100) throw new SyncInputError("财务站点时区无效。");
    try { new Intl.DateTimeFormat("en", { timeZone: m.marketplaceTimeZone }).format(); } catch { throw new SyncInputError("财务站点时区无效。"); }
    return { marketplaceId, marketplaceTimeZone: m.marketplaceTimeZone };
  }).sort((a, b) => a.marketplaceId.localeCompare(b.marketplaceId));
  if (new Set(marketplaces.map(m => m.marketplaceId)).size !== marketplaces.length) throw new SyncInputError("财务批准站点不得重复。");
  const windowMinutes = bounded(p.windowMinutes, 1, 43200), overlapSeconds = bounded(p.overlapSeconds, 1, 2591999);
  if (overlapSeconds >= windowMinutes * 60) throw new SyncInputError("财务重叠回查必须小于窗口。");
  if (typeof p.requestsPerSecond !== "number" || !Number.isFinite(p.requestsPerSecond) || p.requestsPerSecond <= 0 || p.requestsPerSecond > .5) throw new SyncInputError("财务 listTransactions 预算不得超过 0.5 请求/秒。");
  let fx: FinancePolicy["fx"] = null;
  if (p.fx != null) {
    const f = configObject(p.fx);
    if (typeof f.targetCurrency !== "string" || !/^[A-Z]{3}$/.test(f.targetCurrency) || !["HALF_UP", "HALF_EVEN", "DOWN"].includes(String(f.rounding)) || !Array.isArray(f.rates) || f.rates.length > 200) throw new SyncInputError("财务汇率配置无效。");
    const rates = f.rates.map(raw => {
      const r = configObject(raw);
      if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency) || typeof r.rate !== "string" || !/^(?:0|[1-9]\d{0,19})(?:\.\d{1,30})?$/.test(r.rate) || !new Prisma.Decimal(r.rate).gt(0)) throw new SyncInputError("财务汇率须为明确的正十进制字符串。");
      const from = utcConfig(r.from), to = utcConfig(r.to);
      if (to <= from) throw new SyncInputError("财务汇率有效期无效。");
      return { currency: r.currency, rate: r.rate, source: label(r.source), version: label(r.version), from, to };
    });
    for (let i = 0; i < rates.length; i++) if (rates.slice(i + 1).some(r => r.currency === rates[i].currency && r.from < rates[i].to && r.to > rates[i].from)) throw new SyncInputError("同币种汇率有效期重叠，禁止猜测选取。");
    fx = { targetCurrency: f.targetCurrency, rounding: f.rounding as NonNullable<FinancePolicy["fx"]>["rounding"], scale: bounded(f.scale, 0, 30), rates };
  }
  return { initialFrom: utcConfig(p.initialFrom), windowMinutes, overlapSeconds, safetyLagSeconds: bounded(p.safetyLagSeconds, 121, 2592000), applicationId: label(p.applicationId), requestsPerSecond: p.requestsPerSecond, burst: bounded(p.burst, 1, 10), sellerWide: true, collectUnattributed: true, marketplaces, fx };
}
export function nextFinanceWindow(policy: FinancePolicy, cursor: { watermarkFrom: Date; watermarkTo: Date; status: string } | null, now: Date): FinanceWindow {
  if (cursor && cursor.status !== "SUCCEEDED") return { from: cursor.watermarkFrom.toISOString(), to: cursor.watermarkTo.toISOString() };
  const from = cursor ? Math.max(Date.parse(policy.initialFrom), cursor.watermarkTo.getTime() - policy.overlapSeconds * 1000) : Date.parse(policy.initialFrom);
  const to = Math.min(from + policy.windowMinutes * 60000, now.getTime() - policy.safetyLagSeconds * 1000);
  if (to <= from || (cursor && to <= cursor.watermarkTo.getTime())) throw new SyncInputError("财务窗口尚无可推进的新入账时间。", 409);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
export function financeWindowFromFrozen(value: unknown): FinanceWindow {
  const w = configObject(value), from = utcConfig(w.from), to = utcConfig(w.to);
  if (to <= from || Date.parse(to) - Date.parse(from) > 30 * 86400000) throw new SyncInputError("财务冻结窗口无效。");
  return { from, to };
}
export function attributeFinanceTransaction(row: FinanceTransaction, sellerId: string, policy: FinancePolicy) {
  if (row.sellingPartnerId !== sellerId) throw new SyncInputError("财务响应卖家身份缺失或与批准范围不匹配。", 403);
  const ids = [row.metadataMarketplaceId, row.detailsMarketplaceId].filter((id): id is string => !!id);
  if (ids.some(id => !policy.marketplaces.some(m => m.marketplaceId === id))) throw new SyncInputError("财务响应含批准范围之外的站点，整页未提交。", 403);
  if (new Set(ids).size > 1) return { marketplaceId: null, marketplaceTimeZone: null, reason: "CONFLICTING_MARKETPLACE" };
  const site = policy.marketplaces.find(m => m.marketplaceId === ids[0]);
  return site ? { ...site, reason: null } : { marketplaceId: null, marketplaceTimeZone: null, reason: "MISSING_MARKETPLACE" };
}
export function convertFinanceMoney(amount: FinanceMoney, postedAt: Date, policy: FinancePolicy) {
  const fx = policy.fx;
  const rate = fx?.rates.find(r => r.currency === amount.currency && Date.parse(r.from) <= postedAt.getTime() && postedAt.getTime() < Date.parse(r.to));
  if (!fx || !rate) return { status: "UNCONVERTED", amount: null, currency: fx?.targetCurrency ?? null, evidence: null };
  const Decimal = Prisma.Decimal.clone({ precision: 160 });
  const modes = { HALF_UP: Decimal.ROUND_HALF_UP, HALF_EVEN: Decimal.ROUND_HALF_EVEN, DOWN: Decimal.ROUND_DOWN };
  const converted = new Decimal(amount.original).mul(rate.rate).toDecimalPlaces(fx.scale, modes[fx.rounding]);
  if (converted.abs().gte("1e35")) throw new SyncInputError("财务折算金额超出无损存储范围，未提交。");
  return { status: "CONVERTED", amount: converted.toFixed(fx.scale), currency: fx.targetCurrency, evidence: { ...rate, targetCurrency: fx.targetCurrency, scale: fx.scale, rounding: fx.rounding } };
}
