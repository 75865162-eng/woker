/**
 * 报告3 阶段 P0-2 / G7：业财科目映射主数据（纯函数契约层）。
 *
 * 背景：审计指出本项目把"费用类型→科目"映射内联在 offsetAccounts(Json)/ruleInput(Json)，
 * 不可视化、不可复用；WIMOOR 有 FinMappingErpAccount/Feetype 等七张映射表。
 *
 * 本模块提供映射的**纯函数契约**：注册、解析、优先级、租户隔离、冲突检测、版本。
 * 遵循项目红线：
 * - 映射必须显式声明（feeType → subjectId），不提供公司默认值、不臆造科目；
 * - 每条映射带租户/账套维度与 status/priority，解析时按优先级取启用项；
 * - 冲突（同 feeType+优先级 多启用项）视为配置错误，不静默任选。
 *
 * 这是纯内存契约层，不写库。落库模型（FinanceAccountMapping）作为受控 schema 变更单独处理。
 */
export class AccountMappingError extends Error {}

export type AccountMapping = {
  organizationId: string;
  workspaceId: string;
  bookId: string;
  /** 费用类型/业务来源编码（如 feeType:freight、source:amazon_settlement） */
  feeType: string;
  /** 目标科目 ID（须由调用方保证科目存在且启用） */
  subjectId: string;
  /** 优先级，数值越大越优先；默认 0 */
  priority: number;
  /** 启用状态；停用项不参与解析 */
  status: "ACTIVE" | "INACTIVE";
  /** 版本，映射变更递增，便于历史凭证溯源 */
  version: number;
};

function requireRule(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AccountMappingError(msg);
}
function text(v: string, label: string) {
  requireRule(typeof v === "string" && v.trim() === v && v.length > 0, `${label}不能为空或包含首尾空格。`);
}

export function validateMapping(m: AccountMapping): void {
  text(m.organizationId, "organizationId");
  text(m.workspaceId, "workspaceId");
  text(m.bookId, "bookId");
  text(m.feeType, "feeType");
  text(m.subjectId, "subjectId");
  requireRule(Number.isInteger(m.priority), "priority 须为整数。");
  requireRule(m.status === "ACTIVE" || m.status === "INACTIVE", "status 无效。");
  requireRule(Number.isInteger(m.version) && m.version >= 1, "version 须为 ≥1 的整数。");
}

/**
 * 解析某费用类型在指定租户/账套下的生效科目。
 * - 只看 status=ACTIVE 且租户/账套完全匹配的映射；
 * - 取 priority 最高者；同 feeType 最高 priority 有多条 → 冲突报错（不静默任选）；
 * - 无匹配 → 返回 null，由调用方显式处理（不臆造默认科目）。
 */
export function resolveAccount(
  mappings: readonly AccountMapping[],
  scope: { organizationId: string; workspaceId: string; bookId: string },
  feeType: string,
): AccountMapping | null {
  text(feeType, "feeType");
  const candidates = mappings.filter(
    (m) =>
      m.status === "ACTIVE" &&
      m.feeType === feeType &&
      m.organizationId === scope.organizationId &&
      m.workspaceId === scope.workspaceId &&
      m.bookId === scope.bookId,
  );
  if (!candidates.length) return null;
  for (const m of candidates) validateMapping(m);
  const maxPriority = Math.max(...candidates.map((m) => m.priority));
  const top = candidates.filter((m) => m.priority === maxPriority);
  requireRule(top.length === 1, `费用类型 ${feeType} 在优先级 ${maxPriority} 存在多条启用映射，配置冲突。`);
  return top[0];
}

/**
 * 批量解析：多个 feeType → subjectId 映射。任一冲突抛错；无匹配的 feeType 保留 null 并列入 unresolved。
 */
export function resolveAccounts(
  mappings: readonly AccountMapping[],
  scope: { organizationId: string; workspaceId: string; bookId: string },
  feeTypes: readonly string[],
): { resolved: Record<string, string | null>; unresolved: string[] } {
  const resolved: Record<string, string | null> = {};
  const unresolved: string[] = [];
  for (const feeType of feeTypes) {
    const hit = resolveAccount(mappings, scope, feeType);
    resolved[feeType] = hit?.subjectId ?? null;
    if (!hit) unresolved.push(feeType);
  }
  return { resolved, unresolved };
}

/**
 * 校验映射集合在租户/账套内无"同 feeType + 同 priority 多启用项"冲突（配置上架前检查）。
 */
export function assertNoMappingConflicts(mappings: readonly AccountMapping[]): void {
  const seen = new Map<string, string>();
  for (const m of mappings) {
    if (m.status !== "ACTIVE") continue;
    validateMapping(m);
    const key = `${m.organizationId}|${m.workspaceId}|${m.bookId}|${m.feeType}|${m.priority}`;
    const prior = seen.get(key);
    requireRule(!prior || prior === m.subjectId, `映射冲突：${key} 同时指向 ${prior} 与 ${m.subjectId}。`);
    seen.set(key, m.subjectId);
  }
}

/** 构造一条映射（带字段校验），方便服务层统一入口。 */
export function createMapping(input: AccountMapping): AccountMapping {
  validateMapping(input);
  return { ...input };
}
