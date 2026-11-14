import { prisma } from "@/lib/db/prisma";
import { ensurePointsPeriod } from "./account";
import { periodKeyOf, periodRange } from "./period";
import { loadPointsPolicy, priceRuleLabels } from "./policy";

export type PointsGrantView = {
  id: string;
  period: string;
  kind: string;
  amount: number;
  remaining: number;
  reserved: number;
  available: number;
  expiresAt: string;
  expiresInDays: number;
  source: string;
};

export type PointsSummary = {
  period: string;
  periodLabel: string;
  balance: number;
  reserved: number;
  baseQuota: number;
  carriedIn: number;
  extraGranted: number;
  consumed: number;
  totalQuota: number;
  warnPercent: number;
  expiresAt: string;
  grants: PointsGrantView[];
  pendingRequest: { id: string; requestNo: string; requestedAmount: number; createdAt: string } | null;
  approvers: Array<{ id: string; name: string; role: string }>;
  priceRules: Array<{ operationCode: string; label: string; unitCost: number; maxCost: number }>;
};

const kindLabels: Record<string, string> = {
  BASE: "基础额度",
  CARRIED: "上月结转",
  EXTRA: "审批补充",
  ADJUST: "管理员调整",
};

function daysUntil(target: Date, from: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

/** 当前用户的自助视图：会触发本周期初始化（幂等），保证首次打开就有额度。 */
export async function getMyPointsSummary(organizationId: string, userId: string): Promise<PointsSummary> {
  const now = new Date();
  const policy = await loadPointsPolicy(prisma, organizationId);
  const period = periodKeyOf(now, policy.timezone);

  await prisma.$transaction(async (tx) => {
    await ensurePointsPeriod(tx, { organizationId, userId, at: now });
  });

  const [account, periodRow, grants, pendingRequest, approvers, prices] = await Promise.all([
    prisma.pointsAccount.findUnique({ where: { organizationId_userId: { organizationId, userId } } }),
    prisma.pointsPeriod.findUnique({ where: { organizationId_userId_period: { organizationId, userId, period } } }),
    prisma.pointsGrant.findMany({
      where: { organizationId, userId, status: "ACTIVE", expiresAt: { gt: now } },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.pointsRequest.findFirst({
      where: { organizationId, applicantId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId, role: { in: ["owner", "database_admin", "operations_supervisor"] } },
      select: { userId: true, role: true, user: { select: { name: true } } },
      take: 10,
    }),
    prisma.pointsPriceRule.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: [{ operationCode: "asc" }, { version: "desc" }],
    }),
  ]);

  const { end } = periodRange(period, policy.timezone);
  const latestPrices = new Map<string, { operationCode: string; unitCost: number; maxCost: number }>();
  for (const price of prices) {
    if (latestPrices.has(price.operationCode)) continue;
    latestPrices.set(price.operationCode, {
      operationCode: price.operationCode,
      unitCost: price.unitCost,
      maxCost: price.maxCost,
    });
  }

  const totalQuota = (periodRow?.baseQuota ?? 0) + (periodRow?.carriedIn ?? 0) + (periodRow?.extraGranted ?? 0);

  return {
    period,
    periodLabel: period,
    balance: account?.balance ?? 0,
    reserved: account?.reserved ?? 0,
    baseQuota: periodRow?.baseQuota ?? 0,
    carriedIn: periodRow?.carriedIn ?? 0,
    extraGranted: periodRow?.extraGranted ?? 0,
    consumed: periodRow?.consumed ?? 0,
    totalQuota,
    warnPercent: policy.warnPercent,
    expiresAt: end.toISOString(),
    grants: grants.map((grant) => ({
      id: grant.id,
      period: grant.period,
      kind: grant.kind,
      amount: grant.amount,
      remaining: grant.remaining,
      reserved: grant.reserved,
      available: Math.max(0, grant.remaining - grant.reserved),
      expiresAt: grant.expiresAt.toISOString(),
      expiresInDays: daysUntil(grant.expiresAt, now),
      source: kindLabels[grant.kind] ?? grant.kind,
    })),
    pendingRequest: pendingRequest
      ? {
          id: pendingRequest.id,
          requestNo: pendingRequest.requestNo,
          requestedAmount: pendingRequest.requestedAmount,
          createdAt: pendingRequest.createdAt.toISOString(),
        }
      : null,
    approvers: approvers.map((member) => ({
      id: member.userId,
      name: member.user?.name ?? member.userId,
      role: member.role,
    })),
    priceRules: [...latestPrices.values()].map((price) => ({
      ...price,
      label: priceRuleLabels[price.operationCode] ?? price.operationCode,
    })),
  };
}

export type OrgPointsRow = {
  userId: string;
  name: string;
  department: string;
  title: string;
  roleId: string;
  status: string;
  balance: number;
  reserved: number;
  baseQuota: number;
  carriedIn: number;
  extraGranted: number;
  consumed: number;
  totalQuota: number;
  pendingRequests: number;
};

/** 组织级总览。只读，不初始化任何人的周期。 */
export async function getOrganizationPointsOverview(
  organizationId: string,
): Promise<{ period: string; rows: OrgPointsRow[]; totals: { consumed: number; balance: number; pending: number } }> {
  const policy = await loadPointsPolicy(prisma, organizationId);
  const period = periodKeyOf(new Date(), policy.timezone);

  const roster = await prisma.teamRosterMember.findMany({
    where: { organizationId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, department: true, title: true, roleId: true, status: true },
  });

  const userIds = roster.map((member) => member.id);

  if (userIds.length === 0) {
    return { period, rows: [], totals: { consumed: 0, balance: 0, pending: 0 } };
  }

  const [accounts, periods, pendingGroups] = await Promise.all([
    prisma.pointsAccount.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { userId: true, balance: true, reserved: true },
    }),
    prisma.pointsPeriod.findMany({
      where: { organizationId, period, userId: { in: userIds } },
      select: { userId: true, baseQuota: true, carriedIn: true, extraGranted: true, consumed: true },
    }),
    prisma.pointsRequest.groupBy({
      by: ["applicantId"],
      where: { organizationId, period, status: "PENDING" },
      _count: { _all: true },
    }),
  ]);

  const accountByUser = new Map(accounts.map((row) => [row.userId, row]));
  const periodByUser = new Map(periods.map((row) => [row.userId, row]));
  const pendingByUser = new Map(pendingGroups.map((row) => [row.applicantId, row._count._all]));

  const rows: OrgPointsRow[] = roster.map((member) => {
    const account = accountByUser.get(member.id);
    const periodRow = periodByUser.get(member.id);
    const totalQuota = (periodRow?.baseQuota ?? 0) + (periodRow?.carriedIn ?? 0) + (periodRow?.extraGranted ?? 0);

    return {
      userId: member.id,
      name: member.name,
      department: member.department,
      title: member.title,
      roleId: member.roleId,
      status: member.status,
      balance: account?.balance ?? 0,
      reserved: account?.reserved ?? 0,
      baseQuota: periodRow?.baseQuota ?? 0,
      carriedIn: periodRow?.carriedIn ?? 0,
      extraGranted: periodRow?.extraGranted ?? 0,
      consumed: periodRow?.consumed ?? 0,
      totalQuota,
      pendingRequests: pendingByUser.get(member.id) ?? 0,
    };
  });

  return {
    period,
    rows,
    totals: {
      consumed: rows.reduce((total, row) => total + row.consumed, 0),
      balance: rows.reduce((total, row) => total + row.balance, 0),
      pending: rows.reduce((total, row) => total + row.pendingRequests, 0),
    },
  };
}

export type LedgerRowView = {
  id: string;
  kind: string;
  operationCode: string | null;
  delta: number;
  status: string;
  balanceAfter: number;
  note: string;
  createdAt: string;
};

export async function listPointsLedger(input: {
  organizationId: string;
  userId: string;
  take?: number;
  cursor?: string | null;
}): Promise<{ items: LedgerRowView[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(input.take ?? 20, 1), 100);
  const rows = await prisma.pointsLedger.findMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: take + 1,
  });

  const pageRows = rows.slice(0, take);

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      operationCode: row.operationCode,
      delta: row.delta,
      status: row.status,
      balanceAfter: row.balanceAfter,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > take ? pageRows[pageRows.length - 1]?.id ?? null : null,
  };
}
