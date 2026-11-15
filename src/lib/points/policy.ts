import type { Prisma, PrismaClient } from "@prisma/client";
import { defaultPointsTimezone, hardcodedBaseQuota, hardcodedCarryoverCap } from "./period";

export type PointsDbClient = PrismaClient | Prisma.TransactionClient;

export type EffectivePointsPolicy = {
  baseQuota: number;
  carryoverCap: number;
  maxRequestsPerPeriod: number;
  maxRequestAmount: number;
  maxExtraPerPeriod: number;
  requestExpireDays: number;
  reserveTimeoutMinutes: number;
  warnPercent: number;
  grantOnCreate: boolean;
  grantToDisabled: boolean;
  timezone: string;
};

export const hardcodedPointsPolicy: EffectivePointsPolicy = {
  baseQuota: hardcodedBaseQuota,
  carryoverCap: hardcodedCarryoverCap,
  maxRequestsPerPeriod: 3,
  maxRequestAmount: 200,
  maxExtraPerPeriod: 300,
  requestExpireDays: 7,
  reserveTimeoutMinutes: 15,
  warnPercent: 20,
  grantOnCreate: true,
  grantToDisabled: false,
  timezone: defaultPointsTimezone,
};

function positiveInt(value: unknown, fallback: number, allowZero = false): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;

  const truncated = Math.trunc(numeric);
  if (allowZero ? truncated >= 0 : truncated > 0) return truncated;

  return fallback;
}

export async function loadPointsPolicy(client: PointsDbClient, organizationId: string): Promise<EffectivePointsPolicy> {
  const policy = await client.pointsPolicy.findUnique({ where: { organizationId } });

  if (!policy) return { ...hardcodedPointsPolicy };

  return {
    baseQuota: positiveInt(policy.baseQuota, hardcodedPointsPolicy.baseQuota),
    carryoverCap: positiveInt(policy.carryoverCap, hardcodedPointsPolicy.carryoverCap, true),
    maxRequestsPerPeriod: positiveInt(policy.maxRequestsPerPeriod, hardcodedPointsPolicy.maxRequestsPerPeriod, true),
    maxRequestAmount: positiveInt(policy.maxRequestAmount, hardcodedPointsPolicy.maxRequestAmount),
    maxExtraPerPeriod: positiveInt(policy.maxExtraPerPeriod, hardcodedPointsPolicy.maxExtraPerPeriod, true),
    requestExpireDays: positiveInt(policy.requestExpireDays, hardcodedPointsPolicy.requestExpireDays),
    reserveTimeoutMinutes: positiveInt(policy.reserveTimeoutMinutes, hardcodedPointsPolicy.reserveTimeoutMinutes),
    warnPercent: positiveInt(policy.warnPercent, hardcodedPointsPolicy.warnPercent, true),
    grantOnCreate: policy.grantOnCreate,
    grantToDisabled: policy.grantToDisabled,
    timezone: policy.timezone?.trim() || hardcodedPointsPolicy.timezone,
  };
}

/** 成员生效策略：单人覆盖优先，未设置的字段继承组织默认。 */
export async function resolveMemberPointsPolicy(
  client: PointsDbClient,
  organizationId: string,
  userId: string,
): Promise<{ policy: EffectivePointsPolicy; override: { canApprove: boolean; canRequest: boolean; monthlyQuota: number | null; carryoverCap: number | null } | null }> {
  const [policy, override] = await Promise.all([
    loadPointsPolicy(client, organizationId),
    client.pointsMemberOverride.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    }),
  ]);

  if (!override) return { policy, override: null };

  const monthlyQuota = override.monthlyQuota && override.monthlyQuota > 0 ? override.monthlyQuota : null;
  const carryoverCap = override.carryoverCap !== null && override.carryoverCap >= 0 ? override.carryoverCap : null;

  return {
    policy: {
      ...policy,
      baseQuota: monthlyQuota ?? policy.baseQuota,
      carryoverCap: carryoverCap ?? policy.carryoverCap,
    },
    override: {
      canApprove: override.canApprove,
      canRequest: override.canRequest,
      monthlyQuota,
      carryoverCap,
    },
  };
}

export type PointsPriceRuleView = {
  id: string;
  operationCode: string;
  label: string;
  version: number;
  unitCost: number;
  maxCost: number;
  dailyFreeCount: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export const defaultPriceRuleSeeds: Array<{
  operationCode: string;
  label: string;
  unitCost: number;
  maxCost: number;
  dailyFreeCount: number;
}> = [
  { operationCode: "AI_CHAT", label: "AI 对话一回合", unitCost: 1, maxCost: 1, dailyFreeCount: 0 },
  { operationCode: "AGENT_RUN", label: "完整 Agent 任务", unitCost: 5, maxCost: 15, dailyFreeCount: 0 },
  { operationCode: "SELECTION_RESEARCH", label: "选品研究", unitCost: 10, maxCost: 30, dailyFreeCount: 0 },
  { operationCode: "LISTING_GENERATE", label: "生成 Listing", unitCost: 5, maxCost: 20, dailyFreeCount: 0 },
  { operationCode: "IMAGE_GENERATE", label: "生成图片", unitCost: 3, maxCost: 3, dailyFreeCount: 0 },
  { operationCode: "BULK_IMPORT", label: "批量导入", unitCost: 0, maxCost: 0, dailyFreeCount: 0 },
  { operationCode: "DATA_SYNC", label: "数据同步", unitCost: 0, maxCost: 0, dailyFreeCount: 0 },
];

export const priceRuleLabels: Record<string, string> = Object.fromEntries(
  defaultPriceRuleSeeds.map((seed) => [seed.operationCode, seed.label]),
);

/**
 * 首次读取定价时自动写入默认值。
 * 不做这一步，新组织的所有操作都会因为「查不到定价」而变成免费。
 */
export async function ensureDefaultPriceRules(client: PointsDbClient, organizationId: string): Promise<void> {
  const existing = await client.pointsPriceRule.count({ where: { organizationId } });
  if (existing > 0) return;

  await client.pointsPriceRule.createMany({
    data: defaultPriceRuleSeeds.map((seed) => ({
      organizationId,
      operationCode: seed.operationCode,
      version: 1,
      unitCost: seed.unitCost,
      maxCost: seed.maxCost,
      dailyFreeCount: seed.dailyFreeCount,
      status: "ACTIVE",
      // 必须早于任何可能的记账时刻，否则回溯补账会查不到定价、被当成免费
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      note: "系统初始化默认定价",
    })),
    skipDuplicates: true,
  });
}

export async function loadActivePriceRule(
  client: PointsDbClient,
  organizationId: string,
  operationCode: string,
  at: Date = new Date(),
): Promise<PointsPriceRuleView | null> {
  const row = await client.pointsPriceRule.findFirst({
    where: {
      organizationId,
      operationCode,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: [{ version: "desc" }],
  });

  if (!row) return null;

  return {
    id: row.id,
    operationCode: row.operationCode,
    label: priceRuleLabels[row.operationCode] ?? row.operationCode,
    version: row.version,
    unitCost: row.unitCost,
    maxCost: row.maxCost,
    dailyFreeCount: row.dailyFreeCount,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

export async function listPriceRules(client: PointsDbClient, organizationId: string): Promise<PointsPriceRuleView[]> {
  await ensureDefaultPriceRules(client, organizationId);

  const rows = await client.pointsPriceRule.findMany({
    where: { organizationId },
    orderBy: [{ operationCode: "asc" }, { version: "desc" }],
  });

  const latestByOperation = new Map<string, PointsPriceRuleView>();

  for (const row of rows) {
    if (latestByOperation.has(row.operationCode)) continue;
    latestByOperation.set(row.operationCode, {
      id: row.id,
      operationCode: row.operationCode,
      label: priceRuleLabels[row.operationCode] ?? row.operationCode,
      version: row.version,
      unitCost: row.unitCost,
      maxCost: row.maxCost,
      dailyFreeCount: row.dailyFreeCount,
      status: row.status,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    });
  }

  return [...latestByOperation.values()].sort((a, b) => a.operationCode.localeCompare(b.operationCode));
}
