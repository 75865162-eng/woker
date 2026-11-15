import { prisma } from "@/lib/db/prisma";
import { ensurePointsPeriod, recomputePointsAccount } from "./account";
import { PointsError } from "./errors";
import { findLedgerEntry, writeLedger } from "./ledger";
import { startOfDayInZone } from "./period";
import { loadActivePriceRule } from "./policy";

export type ReservePointsInput = {
  organizationId: string;
  userId: string;
  operationCode: string;
  requestKey: string;
  runId?: string | null;
  createdById?: string | null;
  /** 补账场景可指定记账时刻；默认当前时间。 */
  at?: Date;
};

export type ReservePointsResult = {
  requestKey: string;
  operationCode: string;
  cost: number;
  free: boolean;
  balanceAfter: number;
  reservedAfter: number;
  period: string;
};

export type SettlePointsResult = {
  requestKey: string;
  charged: number;
  refunded: number;
  overshoot: number;
  balanceAfter: number;
};

/**
 * 预扣。按定价的 maxCost 冻结额度，任务结束后由 settle 退差额。
 * 幂等：同一 requestKey 重复调用返回首次结果，不会重复扣分。
 */
export async function reservePoints(input: ReservePointsInput): Promise<ReservePointsResult> {
  const now = input.at ?? new Date();

  return prisma.$transaction(async (tx) => {
    const { period, policy } = await ensurePointsPeriod(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
    });

    const existing = await findLedgerEntry(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "RESERVE",
    });

    if (existing) {
      return {
        requestKey: input.requestKey,
        operationCode: existing.operationCode ?? input.operationCode,
        cost: Math.abs(existing.delta),
        free: existing.delta === 0,
        balanceAfter: existing.balanceAfter,
        reservedAfter: existing.reservedAfter,
        period,
      };
    }

    const price = await loadActivePriceRule(tx, input.organizationId, input.operationCode, now);

    // 未定价或显式 0 价：不计费，但仍写一条流水用于计次与审计
    if (!price || price.maxCost <= 0) {
      const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, now);
      await writeLedger(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        kind: "RESERVE",
        operationCode: input.operationCode,
        delta: 0,
        status: "SETTLED",
        balanceAfter: snapshot.balance,
        reservedAfter: snapshot.reserved,
        runId: input.runId ?? null,
        note: price ? `${price.label} 不计积分` : `${input.operationCode} 未配置定价，按免费处理`,
        createdById: input.createdById ?? null,
      });

      return {
        requestKey: input.requestKey,
        operationCode: input.operationCode,
        cost: 0,
        free: true,
        balanceAfter: snapshot.balance,
        reservedAfter: snapshot.reserved,
        period,
      };
    }

    if (price.dailyFreeCount > 0) {
      const dayStart = startOfDayInZone(now, policy.timezone);
      const usedToday = await tx.pointsLedger.count({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
          operationCode: input.operationCode,
          kind: "RESERVE",
          createdAt: { gte: dayStart },
        },
      });

      if (usedToday < price.dailyFreeCount) {
        const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, now);
        await writeLedger(tx, {
          organizationId: input.organizationId,
          userId: input.userId,
          requestKey: input.requestKey,
          kind: "RESERVE",
          operationCode: input.operationCode,
          delta: 0,
          status: "SETTLED",
          balanceAfter: snapshot.balance,
          reservedAfter: snapshot.reserved,
          priceRuleVersion: price.version,
          unitCost: price.unitCost,
          runId: input.runId ?? null,
          note: `${price.label} 命中每日免费次数（${usedToday + 1}/${price.dailyFreeCount}）`,
          createdById: input.createdById ?? null,
        });

        return {
          requestKey: input.requestKey,
          operationCode: input.operationCode,
          cost: 0,
          free: true,
          balanceAfter: snapshot.balance,
          reservedAfter: snapshot.reserved,
          period,
        };
      }
    }

    const cost = price.maxCost;
    const account = await tx.pointsAccount.findUnique({
      where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
      select: { balance: true },
    });

    const available = account?.balance ?? 0;

    if (available < cost) {
      throw new PointsError("POINTS_INSUFFICIENT", `积分不足：需要 ${cost} 分，当前可用 ${available} 分。`, {
        required: cost,
        available,
        operationCode: input.operationCode,
      });
    }

    const grants = await tx.pointsGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        remaining: { gt: 0 },
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    });

    let need = cost;
    const allocations: Array<{ grantId: string; amount: number }> = [];

    for (const grant of grants) {
      if (need <= 0) break;

      const grantAvailable = grant.remaining - grant.reserved;
      if (grantAvailable <= 0) continue;

      const take = Math.min(grantAvailable, need);
      await tx.pointsGrant.update({
        where: { id: grant.id },
        data: { reserved: { increment: take } },
      });
      await tx.pointsAllocation.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          requestKey: input.requestKey,
          grantId: grant.id,
          amount: take,
          status: "HELD",
        },
      });

      allocations.push({ grantId: grant.id, amount: take });
      need -= take;
    }

    if (need > 0) {
      // 账户余额与批次不一致：说明数据已损坏，宁可失败也不能扣成负数
      throw new PointsError("POINTS_INSUFFICIENT", "积分批次不足，请联系管理员对账。", {
        required: cost,
        available: cost - need,
        operationCode: input.operationCode,
      });
    }

    const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, now);

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "RESERVE",
      operationCode: input.operationCode,
      delta: -cost,
      status: "HELD",
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      priceRuleVersion: price.version,
      unitCost: price.unitCost,
      runId: input.runId ?? null,
      note: `${price.label} 预扣 ${cost} 分（跨 ${allocations.length} 个批次）`,
      createdById: input.createdById ?? null,
    });

    return {
      requestKey: input.requestKey,
      operationCode: input.operationCode,
      cost,
      free: false,
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      period,
    };
  });
}

/**
 * 结算。按实际消耗退回差额；实际超过预扣时补扣并记 OVERSHOOT。
 * 幂等：已结算的 requestKey 直接返回首次结果。
 */
export async function settlePoints(input: {
  organizationId: string;
  userId: string;
  requestKey: string;
  actualCost: number;
  createdById?: string | null;
  at?: Date;
}): Promise<SettlePointsResult> {
  const now = input.at ?? new Date();
  const actualCost = Math.max(0, Math.trunc(input.actualCost));

  return prisma.$transaction(async (tx) => {
    const { period: currentPeriod } = await ensurePointsPeriod(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at: now,
    });

    const reserve = await findLedgerEntry(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "RESERVE",
    });

    if (!reserve) {
      throw new PointsError("POINTS_NOT_FOUND", `未找到预扣记录：${input.requestKey}`);
    }

    if (reserve.status !== "HELD") {
      const settled = await findLedgerEntry(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        kind: "SETTLE",
      });

      return {
        requestKey: input.requestKey,
        charged: actualCost,
        refunded: settled?.delta ?? 0,
        overshoot: 0,
        balanceAfter: settled?.balanceAfter ?? reserve.balanceAfter,
      };
    }

    const reservedCost = Math.abs(reserve.delta);
    const allocations = await tx.pointsAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        status: "HELD",
      },
    });

    const grants = allocations.length
      ? await tx.pointsGrant.findMany({
          where: { id: { in: allocations.map((allocation) => allocation.grantId) } },
          select: { id: true, expiresAt: true },
        })
      : [];
    const expiresByGrant = new Map(grants.map((grant) => [grant.id, grant.expiresAt.getTime()]));
    const ordered = [...allocations].sort(
      (a, b) => (expiresByGrant.get(a.grantId) ?? 0) - (expiresByGrant.get(b.grantId) ?? 0),
    );

    let remainingToCharge = actualCost;

    for (const allocation of ordered) {
      const charge = Math.min(allocation.amount, remainingToCharge);

      await tx.pointsGrant.update({
        where: { id: allocation.grantId },
        data: {
          reserved: { decrement: allocation.amount },
          remaining: { decrement: charge },
        },
      });
      await tx.pointsAllocation.update({
        where: { id: allocation.id },
        data: { status: "SETTLED", settledAmount: charge },
      });

      remainingToCharge -= charge;
    }

    // 实际消耗超过预扣上限：从剩余可用批次补扣，不足则记欠账（不阻断已完成的任务）
    let overshoot = 0;

    if (remainingToCharge > 0) {
      const spareGrants = await tx.pointsGrant.findMany({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
          status: "ACTIVE",
          expiresAt: { gt: now },
          remaining: { gt: 0 },
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      });

      for (const grant of spareGrants) {
        if (remainingToCharge <= 0) break;

        const available = grant.remaining - grant.reserved;
        if (available <= 0) continue;

        const take = Math.min(available, remainingToCharge);
        await tx.pointsGrant.update({
          where: { id: grant.id },
          data: { remaining: { decrement: take } },
        });
        remainingToCharge -= take;
        overshoot += take;
      }

      overshoot += remainingToCharge;
    }

    await tx.pointsGrant.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        remaining: 0,
        reserved: 0,
      },
      data: { status: "EXHAUSTED" },
    });

    const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, now);
    const refund = Math.max(0, reservedCost - actualCost);

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "SETTLE",
      operationCode: reserve.operationCode,
      delta: refund,
      status: "SETTLED",
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      priceRuleVersion: reserve.priceRuleVersion,
      unitCost: reserve.unitCost,
      runId: reserve.runId,
      note: refund > 0 ? `结算实际消耗 ${actualCost} 分，退还 ${refund} 分` : `结算实际消耗 ${actualCost} 分`,
      createdById: input.createdById ?? null,
    });

    if (refund === 0) {
      // 无差额时上面已写入 delta=0 的结算流水，(requestKey, SETTLE) 幂等键已存在，此处不再重复写。
    }

    if (overshoot > 0) {
      await writeLedger(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        kind: "OVERSHOOT",
        operationCode: reserve.operationCode,
        delta: -overshoot,
        status: "POSTED",
        balanceAfter: snapshot.balance,
        reservedAfter: snapshot.reserved,
        runId: reserve.runId,
        note: `实际消耗超出预扣 ${overshoot} 分，已补扣`,
        createdById: input.createdById ?? null,
      });
    }

    await tx.pointsLedger.update({ where: { id: reserve.id }, data: { status: "SETTLED" } });

    const periodKey = currentPeriod;
    await tx.pointsPeriod.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        period: periodKey,
        status: { not: "CLOSED" },
      },
      data: { consumed: { increment: actualCost } },
    });

    return {
      requestKey: input.requestKey,
      charged: actualCost,
      refunded: refund,
      overshoot,
      balanceAfter: snapshot.balance,
    };
  });
}

/** 释放预扣。任务失败或取消时全额退回。 */
export async function releasePoints(input: {
  organizationId: string;
  userId: string;
  requestKey: string;
  createdById?: string | null;
  at?: Date;
}): Promise<{ released: number; balanceAfter: number }> {
  const now = input.at ?? new Date();

  return prisma.$transaction(async (tx) => {
    const reserve = await findLedgerEntry(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "RESERVE",
    });

    if (!reserve) {
      throw new PointsError("POINTS_NOT_FOUND", `未找到预扣记录：${input.requestKey}`);
    }

    if (reserve.status !== "HELD") {
      const release = await findLedgerEntry(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        kind: "RELEASE",
      });

      return { released: release?.delta ?? 0, balanceAfter: release?.balanceAfter ?? reserve.balanceAfter };
    }

    const reservedCost = Math.abs(reserve.delta);
    const allocations = await tx.pointsAllocation.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        status: "HELD",
      },
    });

    for (const allocation of allocations) {
      await tx.pointsGrant.update({
        where: { id: allocation.grantId },
        data: { reserved: { decrement: allocation.amount } },
      });
      await tx.pointsAllocation.update({
        where: { id: allocation.id },
        data: { status: "RELEASED", settledAmount: 0 },
      });
    }

    const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, now);

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: input.requestKey,
      kind: "RELEASE",
      operationCode: reserve.operationCode,
      delta: reservedCost,
      status: "RELEASED",
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      runId: reserve.runId,
      note: `任务未结算，释放预扣 ${reservedCost} 分`,
      createdById: input.createdById ?? null,
    });

    await tx.pointsLedger.update({ where: { id: reserve.id }, data: { status: "RELEASED" } });

    return { released: reservedCost, balanceAfter: snapshot.balance };
  });
}

/** 回收超时未结算的预扣（HELD 超过 reserveTimeoutMinutes）。返回处理条数。 */
export async function releaseStaleReservations(limit = 200): Promise<{ released: number; scanned: number }> {
  const stale = await prisma.pointsLedger.findMany({
    where: {
      kind: "RESERVE",
      status: "HELD",
      createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
    },
    select: { organizationId: true, userId: true, requestKey: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let released = 0;

  for (const entry of stale) {
    try {
      await releasePoints({
        organizationId: entry.organizationId,
        userId: entry.userId,
        requestKey: entry.requestKey,
        createdById: "system:points-timeout",
      });
      released += 1;
    } catch {
      // 单条失败不阻塞整批；下轮重试
    }
  }

  return { released, scanned: stale.length };
}
