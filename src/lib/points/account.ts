import type { Prisma } from "@prisma/client";
import { PointsError } from "./errors";
import { writeLedger } from "./ledger";
import { computeCarryover, periodKeyOf, periodRange, previousPeriodKey } from "./period";
import { resolveMemberPointsPolicy, type EffectivePointsPolicy, ensureDefaultPriceRules } from "./policy";

type Tx = Prisma.TransactionClient;

export type PointsAccountSnapshot = {
  organizationId: string;
  userId: string;
  balance: number;
  reserved: number;
  lastPeriod: string | null;
  revision: number;
};

/**
 * 建立账户行并加行锁。必须先 INSERT ON CONFLICT 再 SELECT FOR UPDATE：
 * 否则并发首次调用时两边都查不到行，谁也没锁住。
 */
export async function lockPointsAccount(tx: Tx, organizationId: string, userId: string): Promise<PointsAccountSnapshot> {
  await tx.$executeRaw`
    INSERT INTO "PointsAccount" ("organizationId","userId","balance","reserved","revision","createdAt","updatedAt")
    VALUES (${organizationId}, ${userId}, 0, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("organizationId","userId") DO NOTHING`;

  const rows = await tx.$queryRaw<PointsAccountSnapshot[]>`
    SELECT "organizationId", "userId", "balance", "reserved", "lastPeriod", "revision"
    FROM "PointsAccount"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    FOR UPDATE`;

  const account = rows[0];
  if (!account) throw new Error(`PointsAccount lock failed: ${organizationId}/${userId}`);

  return account;
}

/** 从 Grant 聚合重算余额，杜绝增量更新漂移。 */
export async function recomputePointsAccount(
  tx: Tx,
  scope: { organizationId: string; userId: string },
  at: Date = new Date(),
): Promise<{ balance: number; reserved: number }> {
  const expired = await tx.pointsGrant.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: scope.userId,
      status: "ACTIVE",
      expiresAt: { lte: at },
      reserved: 0,
    },
  });

  for (const grant of expired) {
    await tx.pointsGrant.update({
      where: { id: grant.id },
      data: { status: "EXPIRED", remaining: 0 },
    });

    if (grant.remaining > 0) {
      await writeLedger(tx, {
        organizationId: scope.organizationId,
        userId: scope.userId,
        requestKey: `expire:${grant.id}`,
        kind: "EXPIRE",
        delta: -grant.remaining,
        balanceAfter: 0,
        grantId: grant.id,
        note: `${grant.kind === "BASE" ? "基础额度" : grant.kind === "CARRIED" ? "结转额度" : "补充额度"}到期作废 ${grant.remaining} 分`,
      });
    }
  }

  const active = await tx.pointsGrant.findMany({
    where: {
      organizationId: scope.organizationId,
      userId: scope.userId,
      status: "ACTIVE",
      expiresAt: { gt: at },
    },
    select: { remaining: true, reserved: true },
  });

  const balance = active.reduce((total, grant) => total + Math.max(0, grant.remaining - grant.reserved), 0);
  const reserved = active.reduce((total, grant) => total + Math.max(0, grant.reserved), 0);

  const account = await tx.pointsAccount.update({
    where: { organizationId_userId: { organizationId: scope.organizationId, userId: scope.userId } },
    data: { balance, reserved, revision: { increment: 1 } },
  });

  return { balance: account.balance, reserved: account.reserved };
}

/**
 * 确保当前周期已初始化（发放 + 结转）。幂等：同一周期重复调用只执行一次。
 * 这是所有积分读写的入口，定时任务只是兜底。
 */
export async function ensurePointsPeriod(
  tx: Tx,
  input: { organizationId: string; userId: string; at?: Date },
): Promise<{ period: string; policy: EffectivePointsPolicy }> {
  const at = input.at ?? new Date();
  const account = await lockPointsAccount(tx, input.organizationId, input.userId);
  const { policy } = await resolveMemberPointsPolicy(tx, input.organizationId, input.userId);
  const currentPeriod = periodKeyOf(at, policy.timezone);

  if (account.lastPeriod === currentPeriod) {
    const existing = await tx.pointsPeriod.findUnique({
      where: {
        organizationId_userId_period: {
          organizationId: input.organizationId,
          userId: input.userId,
          period: currentPeriod,
        },
      },
    });

    // 自愈：账户已推进但周期记录缺失（历史数据或事务中断）
    if (!existing) {
      await createPeriodRecords(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        period: currentPeriod,
        policy,
        carriedIn: 0,
        at,
      });
    }

    return { period: currentPeriod, policy };
  }

  let carriedIn = 0;

  if (account.lastPeriod) {
    const held = await tx.pointsGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        period: account.lastPeriod,
        reserved: { gt: 0 },
      },
      select: { reserved: true },
    });

    const heldTotal = held.reduce((total, grant) => total + grant.reserved, 0);

    // 跨月瞬间仍有未结算的任务：拒绝切换，等结算完再继续。
    // reserve 有超时自动释放，这个窗口通常只有几分钟。
    if (heldTotal > 0) {
      throw new PointsError("POINTS_RESERVED_PENDING", "上一周期仍有未结算的任务，请稍后重试。", { reserved: heldTotal });
    }

    const previousBase = await tx.pointsGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        period: account.lastPeriod,
        kind: "BASE",
      },
      select: { id: true, remaining: true },
    });

    const baseRemaining = previousBase.reduce((total, grant) => total + grant.remaining, 0);
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    const grantable = user?.status === "active" || policy.grantToDisabled;
    carriedIn = grantable ? computeCarryover(baseRemaining, policy.carryoverCap) : 0;

    // 上一周期所有剩余批次归零，写 EXPIRE 流水
    const stale = await tx.pointsGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        period: { lt: currentPeriod },
        remaining: { gt: 0 },
      },
    });

    for (const grant of stale) {
      await tx.pointsGrant.update({
        where: { id: grant.id },
        data: { status: "EXPIRED", remaining: 0 },
      });
      await writeLedger(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: `expire:${grant.id}`,
        kind: "EXPIRE",
        delta: -grant.remaining,
        balanceAfter: 0,
        grantId: grant.id,
        note: `周期结算作废 ${grant.remaining} 分（${grant.kind}）`,
      });
    }

    await tx.pointsGrant.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        period: { lt: currentPeriod },
        remaining: 0,
      },
      data: { status: "EXPIRED" },
    });

    await tx.pointsPeriod.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        period: account.lastPeriod,
        status: { not: "CLOSED" },
      },
      data: { status: "CLOSED", closedAt: at },
    });
  }

  await createPeriodRecords(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    period: currentPeriod,
    policy,
    carriedIn,
    at,
  });

  // 首次初始化时补默认定价，否则所有操作都会被当成免费
  await ensureDefaultPriceRules(tx, input.organizationId);

  await tx.pointsAccount.update({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    data: { lastPeriod: currentPeriod },
  });

  await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, at);

  return { period: currentPeriod, policy };
}

async function createPeriodRecords(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    period: string;
    policy: EffectivePointsPolicy;
    carriedIn: number;
    at: Date;
  },
): Promise<void> {
  const { start, end } = periodRange(input.period, input.policy.timezone);
  const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
  const grantable = (user?.status === "active" || input.policy.grantToDisabled) && input.policy.grantOnCreate;

  await tx.pointsPeriod.upsert({
    where: {
      organizationId_userId_period: {
        organizationId: input.organizationId,
        userId: input.userId,
        period: input.period,
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      period: input.period,
      baseQuota: grantable ? input.policy.baseQuota : 0,
      carriedIn: grantable ? input.carriedIn : 0,
      status: "OPEN",
      openedAt: start,
    },
    update: {},
  });

  if (!grantable) return;

  const account = await tx.pointsAccount.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: input.userId } },
    select: { balance: true, reserved: true },
  });

  if (input.policy.baseQuota > 0) {
    const grant = await tx.pointsGrant.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        period: input.period,
        kind: "BASE",
        amount: input.policy.baseQuota,
        remaining: input.policy.baseQuota,
        carryable: true,
        status: "ACTIVE",
        expiresAt: end,
      },
    });

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: `grant:${grant.id}`,
      kind: "GRANT",
      delta: input.policy.baseQuota,
      balanceAfter: (account?.balance ?? 0) + input.policy.baseQuota,
      reservedAfter: account?.reserved ?? 0,
      grantId: grant.id,
      note: `${input.period} 基础额度发放 ${input.policy.baseQuota} 分`,
    });
  }

  if (input.carriedIn > 0) {
    const grant = await tx.pointsGrant.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        period: input.period,
        kind: "CARRIED",
        amount: input.carriedIn,
        remaining: input.carriedIn,
        carryable: false,
        status: "ACTIVE",
        expiresAt: end,
      },
    });

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: `grant:${grant.id}`,
      kind: "GRANT",
      delta: input.carriedIn,
      balanceAfter: (account?.balance ?? input.policy.baseQuota) + input.carriedIn,
      reservedAfter: account?.reserved ?? 0,
      grantId: grant.id,
      note: `${input.period} 上月结转 ${input.carriedIn} 分（限本月使用）`,
    });
  }

  void start;
}

/** 只读查询：不发放、不加锁，用于 UI 概览。缺失周期时返回零值而不写库。 */
export async function readPointsAccountSummary(
  tx: Tx,
  scope: { organizationId: string; userId: string },
): Promise<{ balance: number; reserved: number; lastPeriod: string | null }> {
  const account = await tx.pointsAccount.findUnique({
    where: { organizationId_userId: { organizationId: scope.organizationId, userId: scope.userId } },
    select: { balance: true, reserved: true, lastPeriod: true },
  });

  return {
    balance: account?.balance ?? 0,
    reserved: account?.reserved ?? 0,
    lastPeriod: account?.lastPeriod ?? null,
  };
}

export { previousPeriodKey };
