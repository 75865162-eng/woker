/**
 * 账本余额投影（报告3 P1-1）——由 POSTED 凭证增量重建的只读投影。
 *
 * 边界（红线）：
 * - 纯计算、零 IO：不写库、不过账、不授予任何过账权限；调用方负责持久化与事务。
 * - 口径与 rules.ts 的 trialBalance() 完全一致：仅账套本位币、仅 POSTED、
 *   借正贷负 signed 余额、BigInt 6 位定点、科目按 accountId 升序。
 * - 投影行带 sourceHash：同一组凭证 + 同一期初 + 同一 revision 产出相同哈希，
 *   便于上层做幂等重建与一致性校验（sourceHash 变化才需要落库）。
 * - 缺值不补零：科目未出现在期初或凭证中时该科目不产生行；不存在"隐式 0 科目"。
 */

export class BalanceProjectionError extends Error {}

const SCALE = BigInt(1000000);
const ZERO = BigInt(0);

function requireOk(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BalanceProjectionError(message);
}

/** 复用项目统一的 6 位非负金额解析（与 open-item-rules 的 amountUnits 同口径）。 */
function units(value: string): bigint {
  requireOk(typeof value === "string" && /^(?:0|[1-9]\d{0,23})(?:\.\d{1,6})?$/.test(value), "金额须为最多六位小数的非负十进制字符串。");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function amount(value: bigint): string {
  const abs = value < ZERO ? -value : value;
  return `${value < ZERO ? "-" : ""}${abs / SCALE}.${String(abs % SCALE).padStart(6, "0")}`;
}

export type ProjectionScope = {
  organizationId: string;
  workspaceId: string;
  bookId: string;
  currency: string;
};

export type ProjectionOpening = { accountId: string; amount: string; side: "DEBIT" | "CREDIT" };

/** 最小凭证形状：只需 id/sourceKey/status 与分录行；不依赖 rules.ts 的完整 Voucher 类型。 */
export type ProjectionVoucher = {
  id: string;
  sourceKey: string;
  status: "DRAFT" | "REVIEWED" | "POSTED";
  lines: readonly { accountId: string; debit: string; credit: string }[];
};

export type BalanceProjectionInput = ProjectionScope & {
  periodId: string;
  opening: readonly ProjectionOpening[];
  /** 仅 POSTED 会进入投影；传入非 POSTED 直接拒绝，绝不静默忽略。 */
  vouchers: readonly ProjectionVoucher[];
  /** 上一次投影的 revision；增量重建时 +1。默认 0。 */
  baseRevision?: number;
  /** 参与本次投影的已知末级科目 ID（用于校验分录科目合法性；可选）。 */
  knownSubjectIds?: readonly string[];
};

export type ProjectionRow = {
  accountId: string;
  openingSigned: string;
  debit: string;
  credit: string;
  closingSigned: string;
};

export type BalanceProjection = ProjectionScope & {
  periodId: string;
  revision: number;
  /** 稳定哈希：期初 + 凭证集合(排序) + revision + 期间 + 账套。 */
  sourceHash: string;
  rows: ProjectionRow[];
  openingDifference: string;
  movementDifference: string;
  closingDifference: string;
  balanced: boolean;
};

/** FNV-1a 32 位稳定哈希（纯函数、无 crypto/IO 依赖），用于 sourceHash。 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function canonicalSource(input: BalanceProjectionInput): string {
  const opening = [...input.opening]
    .map(o => `${o.accountId}:${o.side}:${o.amount}`)
    .sort()
    .join(",");
  const vouchers = input.vouchers
    .map(v => `${v.id}~${v.sourceKey}~${v.lines.map(l => `${l.accountId}/${l.debit}/${l.credit}`).sort().join(";")}`)
    .sort()
    .join(",");
  const revision = input.baseRevision ?? 0;
  return [
    input.organizationId, input.workspaceId, input.bookId, input.currency, input.periodId,
    String(revision), opening, vouchers,
  ].join("|");
}

/**
 * 增量重建余额投影。口径与 trialBalance() 对齐：
 * - 期初按 side 转 signed（借正贷负）；
 * - 每条分录 debit/credit 为非负字符串，closing = opening + Σdebit − Σcredit；
 * - 合计差额 openingDifference / movementDifference / closingDifference，balanced 三者归零。
 */
export function rebuildBalanceProjection(input: BalanceProjectionInput): BalanceProjection {
  requireOk(typeof input.organizationId === "string" && input.organizationId.length > 0, "organizationId 不能为空。");
  requireOk(typeof input.workspaceId === "string" && input.workspaceId.length > 0, "workspaceId 不能为空。");
  requireOk(typeof input.bookId === "string" && input.bookId.length > 0, "bookId 不能为空。");
  requireOk(/^[A-Z]{3}$/.test(input.currency), "须显式提供账套本位币（三位大写字母）。");
  requireOk(typeof input.periodId === "string" && input.periodId.length > 0, "periodId 不能为空。");
  const baseRevision = input.baseRevision ?? 0;
  requireOk(Number.isSafeInteger(baseRevision) && baseRevision >= 0, "baseRevision 须为非负安全整数。");

  const known = input.knownSubjectIds ? new Set(input.knownSubjectIds) : null;
  const balances = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();
  const row = (id: string) => {
    let r = balances.get(id);
    if (!r) { r = { opening: ZERO, debit: ZERO, credit: ZERO }; balances.set(id, r); }
    return r;
  };
  const validateAccount = (id: string) => {
    requireOk(typeof id === "string" && id.length > 0, "分录科目 ID 不能为空。");
    requireOk(!known || known.has(id), `分录科目 ${id} 不在已知末级科目集合内。`);
  };

  const seenOpening = new Set<string>();
  for (const o of input.opening) {
    validateAccount(o.accountId);
    requireOk(!seenOpening.has(o.accountId), "期初科目重复。");
    requireOk(o.side === "DEBIT" || o.side === "CREDIT", "期初余额方向无效。");
    seenOpening.add(o.accountId);
    row(o.accountId).opening = units(o.amount) * (o.side === "DEBIT" ? BigInt(1) : BigInt(-1));
  }

  const seenIds = new Set<string>();
  const seenSources = new Set<string>();
  for (const voucher of input.vouchers) {
    requireOk(voucher.status === "POSTED", `凭证 ${voucher.id} 非 POSTED，不能进入余额投影。`);
    requireOk(typeof voucher.id === "string" && voucher.id.length > 0, "凭证 ID 不能为空。");
    requireOk(typeof voucher.sourceKey === "string" && voucher.sourceKey.length > 0, "凭证来源键不能为空。");
    requireOk(!seenIds.has(voucher.id) && !seenSources.has(voucher.sourceKey), "凭证 ID 或来源键重复。");
    seenIds.add(voucher.id); seenSources.add(voucher.sourceKey);
    for (const line of voucher.lines) {
      validateAccount(line.accountId);
      const dr = units(line.debit);
      const cr = units(line.credit);
      requireOk(!(dr !== ZERO && cr !== ZERO), "每条分录须且只能有一侧非零金额。");
      row(line.accountId).debit += dr;
      row(line.accountId).credit += cr;
    }
  }

  let totalOpening = ZERO, totalDebit = ZERO, totalCredit = ZERO, totalClosing = ZERO;
  const rows: ProjectionRow[] = [...balances].sort(([a], [b]) => a.localeCompare(b)).map(([accountId, v]) => {
    const closing = v.opening + v.debit - v.credit;
    totalOpening += v.opening; totalDebit += v.debit; totalCredit += v.credit; totalClosing += closing;
    return {
      accountId,
      openingSigned: amount(v.opening),
      debit: amount(v.debit),
      credit: amount(v.credit),
      closingSigned: amount(closing),
    };
  });

  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    bookId: input.bookId,
    currency: input.currency,
    periodId: input.periodId,
    revision: baseRevision + 1,
    sourceHash: fnv1a(canonicalSource(input)),
    rows,
    openingDifference: amount(totalOpening),
    movementDifference: amount(totalDebit - totalCredit),
    closingDifference: amount(totalClosing),
    balanced: totalOpening === ZERO && totalDebit === totalCredit && totalClosing === ZERO,
  };
}

/**
 * 与 trialBalance() 的行级对账：把投影行转为 trialBalance 的可比形状。
 * 上层可用它验证「投影与试算一致」——逐字段相等即通过。
 */
export function projectionAsTrialRows(projection: BalanceProjection) {
  return projection.rows.map(r => ({
    accountId: r.accountId,
    openingSigned: r.openingSigned,
    debit: r.debit,
    credit: r.credit,
    closingSigned: r.closingSigned,
  }));
}

/** 两个投影的 sourceHash 是否一致（幂等判定：一致则无需重复落库）。 */
export function projectionUnchanged(a: BalanceProjection, b: BalanceProjection): boolean {
  return a.sourceHash === b.sourceHash && a.revision === b.revision && a.periodId === b.periodId;
}
