import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ensurePointsPeriod, lockPointsAccount, recomputePointsAccount } from "./account";
import { PointsError } from "./errors";
import { writeLedger } from "./ledger";
import { periodKeyOf, periodRange } from "./period";
import { resolveMemberPointsPolicy } from "./policy";

type Tx = Prisma.TransactionClient;

const MIN_REASON_LENGTH = 10;

function assertReason(reason: string) {
  if (reason.trim().length < MIN_REASON_LENGTH) {
    throw new PointsError("POINTS_INVALID_INPUT", `申请理由至少 ${MIN_REASON_LENGTH} 个字。`);
  }
}

function buildRequestNo(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  return `PT-${stamp}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export type PointsRequestView = {
  id: string;
  requestNo: string;
  applicantId: string;
  applicantName: string | null;
  period: string;
  requestedAmount: number;
  approvedAmount: number | null;
  reason: string;
  usagePlan: string | null;
  status: string;
  approverId: string | null;
  approverName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  expiresAt: string;
  grantId: string | null;
  createdAt: string;
};

export async function createPointsRequest(input: {
  organizationId: string;
  applicantId: string;
  requestedAmount: number;
  reason: string;
  usagePlan?: string | null;
}): Promise<{ id: string; requestNo: string; status: string; expiresAt: Date }> {
  const at = new Date();
  const amount = Math.trunc(input.requestedAmount);
  const reason = input.reason.trim();
  assertReason(reason);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PointsError("POINTS_INVALID_INPUT", "申请数量必须是正整数。");
  }

  return prisma.$transaction(async (tx) => {
    const { policy, override } = await resolveMemberPointsPolicy(tx, input.organizationId, input.applicantId);

    if (override && !override.canRequest) {
      throw new PointsError("POINTS_FORBIDDEN", "当前账号没有提交积分申请的权限。");
    }

    if (amount > policy.maxRequestAmount) {
      throw new PointsError("POINTS_REQUEST_LIMIT", `单次申请不能超过 ${policy.maxRequestAmount} 分。`, {
        maxRequestAmount: policy.maxRequestAmount,
      });
    }

    const period = periodKeyOf(at, policy.timezone);

    const [pendingCount, approvedSum] = await Promise.all([
      tx.pointsRequest.count({
        where: {
          organizationId: input.organizationId,
          applicantId: input.applicantId,
          period,
          status: { in: ["PENDING", "APPROVED"] },
        },
      }),
      tx.pointsRequest.aggregate({
        where: {
          organizationId: input.organizationId,
          applicantId: input.applicantId,
          period,
          status: "APPROVED",
        },
        _sum: { approvedAmount: true },
      }),
    ]);

    if (pendingCount >= policy.maxRequestsPerPeriod) {
      throw new PointsError("POINTS_REQUEST_LIMIT", `每个周期最多提交 ${policy.maxRequestsPerPeriod} 次申请。`, {
        maxRequestsPerPeriod: policy.maxRequestsPerPeriod,
      });
    }

    const approvedTotal = approvedSum._sum.approvedAmount ?? 0;

    if (approvedTotal + amount > policy.maxExtraPerPeriod) {
      throw new PointsError("POINTS_REQUEST_LIMIT", `本周期补充总额不能超过 ${policy.maxExtraPerPeriod} 分，已批准 ${approvedTotal} 分。`, {
        maxExtraPerPeriod: policy.maxExtraPerPeriod,
        approvedTotal,
      });
    }

    const expiresAt = new Date(at.getTime() + policy.requestExpireDays * 24 * 60 * 60 * 1000);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const requestNo = buildRequestNo();

      try {
        const created = await tx.pointsRequest.create({
          data: {
            organizationId: input.organizationId,
            requestNo,
            applicantId: input.applicantId,
            period,
            requestedAmount: amount,
            reason,
            usagePlan: input.usagePlan?.trim() || null,
            status: "PENDING",
            expiresAt,
          },
          select: { id: true, requestNo: true, status: true, expiresAt: true },
        });

        return created;
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
        if (code !== "P2002" || attempt === 4) throw error;
      }
    }

    throw new PointsError("POINTS_INVALID_INPUT", "申请单号生成失败，请重试。");
  });
}

/** 批准申请：生成当月有效的 EXTRA 批次。跨周期申请直接失效。 */
export async function approvePointsRequest(input: {
  organizationId: string;
  requestId: string;
  approverId: string;
  approvedAmount?: number | null;
  decisionNote?: string | null;
}): Promise<{ requestId: string; grantedPoints: number; balanceAfter: number }> {
  const at = new Date();

  return prisma.$transaction(async (tx) => {
    const request = await tx.pointsRequest.findFirst({
      where: { id: input.requestId, organizationId: input.organizationId },
    });

    if (!request) throw new PointsError("POINTS_NOT_FOUND", "申请单不存在。");

    if (request.applicantId === input.approverId) {
      throw new PointsError("POINTS_SELF_APPROVAL", "不能审批自己的积分申请。");
    }

    if (request.status !== "PENDING") {
      throw new PointsError("POINTS_ALREADY_DECIDED", `申请单状态为 ${request.status}，无法再次审批。`);
    }

    if (request.expiresAt.getTime() <= at.getTime()) {
      await tx.pointsRequest.update({
        where: { id: request.id },
        data: { status: "EXPIRED", decidedAt: at, decisionNote: "超过处理时限自动失效" },
      });
      throw new PointsError("POINTS_ALREADY_DECIDED", "申请单已过期。");
    }

    await lockPointsAccount(tx, input.organizationId, request.applicantId);
    const { period, policy } = await ensurePointsPeriod(tx, {
      organizationId: input.organizationId,
      userId: request.applicantId,
      at,
    });

    if (request.period !== period) {
      await tx.pointsRequest.update({
        where: { id: request.id },
        data: { status: "EXPIRED", decidedAt: at, decisionNote: `所属周期 ${request.period} 已结算，补充额度不再生效` },
      });
      throw new PointsError("POINTS_PERIOD_CLOSED", `该申请属于 ${request.period}，周期已结束，无法发放。`);
    }

    const granted = Math.trunc(input.approvedAmount ?? request.requestedAmount);

    if (granted <= 0) {
      throw new PointsError("POINTS_INVALID_INPUT", "批准数量必须大于 0。");
    }

    const { end } = periodRange(period, policy.timezone);

    const grant = await tx.pointsGrant.create({
      data: {
        organizationId: input.organizationId,
        userId: request.applicantId,
        period,
        kind: "EXTRA",
        amount: granted,
        remaining: granted,
        carryable: false,
        status: "ACTIVE",
        expiresAt: end,
        sourceRequestId: request.id,
        reason: request.reason.slice(0, 500),
        operatorId: input.approverId,
      },
    });

    await tx.pointsRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        approvedAmount: granted,
        approverId: input.approverId,
        decisionNote: input.decisionNote?.trim() || null,
        decidedAt: at,
        grantId: grant.id,
      },
    });

    await tx.pointsPeriod.updateMany({
      where: { organizationId: input.organizationId, userId: request.applicantId, period },
      data: { extraGranted: { increment: granted } },
    });

    const snapshot = await recomputePointsAccount(tx, {
      organizationId: input.organizationId,
      userId: request.applicantId,
    }, at);

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: request.applicantId,
      requestKey: `request:${request.id}`,
      kind: "GRANT",
      delta: granted,
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      grantId: grant.id,
      requestId: request.id,
      note: `申请 ${request.requestNo} 批准补充 ${granted} 分（本周期有效）`,
      createdById: input.approverId,
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.approverId,
        action: "points_request_approve",
        entityType: "PointsRequest",
        entityId: request.id,
        metadata: { requestNo: request.requestNo, applicantId: request.applicantId, granted },
      },
    });

    return { requestId: request.id, grantedPoints: granted, balanceAfter: snapshot.balance };
  });
}

export async function rejectPointsRequest(input: {
  organizationId: string;
  requestId: string;
  approverId: string;
  decisionNote?: string | null;
}): Promise<{ requestId: string }> {
  const at = new Date();

  return prisma.$transaction(async (tx) => {
    const request = await tx.pointsRequest.findFirst({
      where: { id: input.requestId, organizationId: input.organizationId },
    });

    if (!request) throw new PointsError("POINTS_NOT_FOUND", "申请单不存在。");
    if (request.applicantId === input.approverId) {
      throw new PointsError("POINTS_SELF_APPROVAL", "不能审批自己的积分申请。");
    }
    if (request.status !== "PENDING") {
      throw new PointsError("POINTS_ALREADY_DECIDED", `申请单状态为 ${request.status}，无法处理。`);
    }

    await tx.pointsRequest.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        approverId: input.approverId,
        decisionNote: input.decisionNote?.trim() || null,
        decidedAt: at,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.approverId,
        action: "points_request_reject",
        entityType: "PointsRequest",
        entityId: request.id,
        metadata: { requestNo: request.requestNo, applicantId: request.applicantId, note: input.decisionNote ?? null },
      },
    });

    return { requestId: request.id };
  });
}

export async function withdrawPointsRequest(input: {
  organizationId: string;
  requestId: string;
  applicantId: string;
}): Promise<{ requestId: string }> {
  const request = await prisma.pointsRequest.findFirst({
    where: { id: input.requestId, organizationId: input.organizationId },
  });

  if (!request) throw new PointsError("POINTS_NOT_FOUND", "申请单不存在。");
  if (request.applicantId !== input.applicantId) {
    throw new PointsError("POINTS_FORBIDDEN", "只能撤回自己提交的申请。");
  }
  if (request.status !== "PENDING") {
    throw new PointsError("POINTS_ALREADY_DECIDED", `申请单状态为 ${request.status}，无法撤回。`);
  }

  await prisma.pointsRequest.update({
    where: { id: request.id },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });

  return { requestId: request.id };
}

/** 过期清理：PENDING 且超过 expiresAt 的申请置为 EXPIRED。 */
export async function expireStalePointsRequests(limit = 200): Promise<{ expired: number }> {
  const result = await prisma.pointsRequest.updateMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED", decidedAt: new Date(), decisionNote: "超过处理时限自动失效" },
  });

  void limit;

  return { expired: result.count };
}

/**
 * 管理员手动调额。正数新增一个 ADJUST 批次（本周期有效），负数从现有批次按到期顺序扣减。
 * 负数不允许扣成负余额。
 */
export async function adjustMemberPoints(input: {
  organizationId: string;
  userId: string;
  operatorId: string;
  amount: number;
  reason: string;
}): Promise<{ balanceAfter: number; applied: number }> {
  const at = new Date();
  const amount = Math.trunc(input.amount);
  const reason = input.reason.trim();

  if (!Number.isFinite(amount) || amount === 0) {
    throw new PointsError("POINTS_INVALID_INPUT", "调整数量不能为 0。");
  }
  if (reason.length < MIN_REASON_LENGTH) {
    throw new PointsError("POINTS_INVALID_INPUT", `调整原因至少 ${MIN_REASON_LENGTH} 个字。`);
  }

  return prisma.$transaction(async (tx) => {
    await lockPointsAccount(tx, input.organizationId, input.userId);
    const { period, policy } = await ensurePointsPeriod(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      at,
    });
    const { end } = periodRange(period, policy.timezone);

    if (amount > 0) {
      const grant = await tx.pointsGrant.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          period,
          kind: "ADJUST",
          amount,
          remaining: amount,
          carryable: false,
          status: "ACTIVE",
          expiresAt: end,
          reason,
          operatorId: input.operatorId,
        },
      });

      const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, at);

      await writeLedger(tx, {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: `adjust:${grant.id}`,
        kind: "ADJUST",
        delta: amount,
        balanceAfter: snapshot.balance,
        reservedAfter: snapshot.reserved,
        grantId: grant.id,
        note: `管理员增发 ${amount} 分：${reason}`,
        createdById: input.operatorId,
      });

      await writeAdjustAudit(tx, input, amount, snapshot.balance);

      return { balanceAfter: snapshot.balance, applied: amount };
    }

    let remaining = Math.abs(amount);
    const grants = await tx.pointsGrant.findMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: "ACTIVE",
        expiresAt: { gt: at },
        remaining: { gt: 0 },
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    });

    const available = grants.reduce((total, grant) => total + Math.max(0, grant.remaining - grant.reserved), 0);

    if (available < remaining) {
      throw new PointsError("POINTS_INSUFFICIENT", `可扣减额度不足：需要 ${remaining} 分，当前可用 ${available} 分。`, {
        required: remaining,
        available,
      });
    }

    for (const grant of grants) {
      if (remaining <= 0) break;

      const grantAvailable = grant.remaining - grant.reserved;
      if (grantAvailable <= 0) continue;

      const take = Math.min(grantAvailable, remaining);
      await tx.pointsGrant.update({
        where: { id: grant.id },
        data: { remaining: { decrement: take } },
      });
      remaining -= take;
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

    const snapshot = await recomputePointsAccount(tx, { organizationId: input.organizationId, userId: input.userId }, at);

    await writeLedger(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      requestKey: `adjust:${randomBytes(8).toString("hex")}`,
      kind: "ADJUST",
      delta: amount,
      balanceAfter: snapshot.balance,
      reservedAfter: snapshot.reserved,
      note: `管理员扣减 ${Math.abs(amount)} 分：${reason}`,
      createdById: input.operatorId,
    });

    await writeAdjustAudit(tx, input, amount, snapshot.balance);

    return { balanceAfter: snapshot.balance, applied: amount };
  });
}

async function writeAdjustAudit(
  tx: Tx,
  input: { organizationId: string; userId: string; operatorId: string; reason: string },
  amount: number,
  balanceAfter: number,
) {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.operatorId,
      action: "points_adjust",
      entityType: "PointsAccount",
      entityId: input.userId,
      metadata: { targetUserId: input.userId, amount, reason: input.reason, balanceAfter },
    },
  });
}

export async function listPointsRequests(
  client: Tx | typeof prisma,
  scope: {
    organizationId: string;
    applicantId?: string;
    status?: string;
    take?: number;
    cursor?: string | null;
  },
): Promise<{ items: PointsRequestView[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(scope.take ?? 20, 1), 100);
  const rows = await client.pointsRequest.findMany({
    where: {
      organizationId: scope.organizationId,
      ...(scope.applicantId ? { applicantId: scope.applicantId } : {}),
      ...(scope.status && scope.status !== "all" ? { status: scope.status } : {}),
      ...(scope.cursor ? { id: { lt: scope.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: take + 1,
  });

  const pageRows = rows.slice(0, take);
  const userIds = [...new Set(pageRows.flatMap((row) => [row.applicantId, row.approverId]).filter((id): id is string => Boolean(id)))];
  const users = userIds.length
    ? await client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((user) => [user.id, user.name]));

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      requestNo: row.requestNo,
      applicantId: row.applicantId,
      applicantName: nameById.get(row.applicantId) ?? null,
      period: row.period,
      requestedAmount: row.requestedAmount,
      approvedAmount: row.approvedAmount,
      reason: row.reason,
      usagePlan: row.usagePlan,
      status: row.status,
      approverId: row.approverId,
      approverName: row.approverId ? nameById.get(row.approverId) ?? null : null,
      decisionNote: row.decisionNote,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      grantId: row.grantId,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > take ? pageRows[pageRows.length - 1]?.id ?? null : null,
  };
}
