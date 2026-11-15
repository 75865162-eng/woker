/**
 * 积分系统真实链路冒烟。
 * 用一个临时用户跑完整流程，结束后删除该用户（积分数据随 CASCADE 清理）。
 *
 * 运行：npm run verify:points
 */
import { prisma } from "@/lib/db/prisma";
import { getMyPointsSummary } from "@/lib/points/summary";
import { releasePoints, reservePoints, settlePoints } from "@/lib/points/spend";
import { approvePointsRequest, createPointsRequest } from "@/lib/points/requests";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function main() {
  const organization = await prisma.organization.findFirst({
    where: { members: { some: {} } },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  if (!organization) throw new Error("没有可用组织，无法冒烟。");

  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId: organization.id, role: "owner" },
    select: { userId: true },
  });

  const stamp = Date.now();
  const email = `points-smoke-${stamp}@local.test`;

  const user = await prisma.user.create({
    data: {
      email,
      name: `积分冒烟 ${stamp}`,
      passwordHash: "smoke-not-a-real-hash",
      status: "active",
      memberships: {
        create: {
          organizationId: organization.id,
          role: "operations",
        },
      },
    },
  });

  console.log(`\n组织：${organization.name} / 临时用户：${user.id}\n`);

  try {
    const summary = await getMyPointsSummary(organization.id, user.id);
    record("首次初始化发放基础额度", summary.balance === 50 && summary.baseQuota === 50, `余额 ${summary.balance}，基础 ${summary.baseQuota}`);

    const runKey = `smoke-run-${stamp}`;
    const reserved = await reservePoints({
      organizationId: organization.id,
      userId: user.id,
      operationCode: "AGENT_RUN",
      requestKey: runKey,
      createdById: user.id,
    });
    record("预扣按 maxCost 冻结", reserved.cost === 15 && reserved.balanceAfter === 35, `冻结 ${reserved.cost}，可用 ${reserved.balanceAfter}`);

    const replay = await reservePoints({
      organizationId: organization.id,
      userId: user.id,
      operationCode: "AGENT_RUN",
      requestKey: runKey,
      createdById: user.id,
    });
    const accountAfterReplay = await prisma.pointsAccount.findUnique({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    });
    record("重复 requestKey 不重复扣分", replay.cost === 15 && accountAfterReplay?.balance === 35, `余额仍为 ${accountAfterReplay?.balance}`);

    const settled = await settlePoints({
      organizationId: organization.id,
      userId: user.id,
      requestKey: runKey,
      actualCost: 12,
      createdById: user.id,
    });
    record("结算按实际消耗退差", settled.charged === 12 && settled.refunded === 3 && settled.balanceAfter === 38, `消耗 12，退还 ${settled.refunded}，余额 ${settled.balanceAfter}`);

    const releaseKey = `smoke-release-${stamp}`;
    await reservePoints({ organizationId: organization.id, userId: user.id, operationCode: "AI_CHAT", requestKey: releaseKey, createdById: user.id });
    const released = await releasePoints({ organizationId: organization.id, userId: user.id, requestKey: releaseKey, createdById: user.id });
    record("失败任务释放预扣", released.balanceAfter === 38, `释放 ${released.released}，余额 ${released.balanceAfter}`);

    // 先把可用额度压到 8 分，再申请一次需要 30 分的操作，必须被拒绝
    const drainKey = `smoke-drain-${stamp}`;
    await reservePoints({
      organizationId: organization.id,
      userId: user.id,
      operationCode: "SELECTION_RESEARCH",
      requestKey: drainKey,
      createdById: user.id,
    });
    await settlePoints({
      organizationId: organization.id,
      userId: user.id,
      requestKey: drainKey,
      actualCost: 30,
      createdById: user.id,
    });

    const insufficientKey = `smoke-insufficient-${stamp}`;
    const insufficient = await reservePoints({
      organizationId: organization.id,
      userId: user.id,
      operationCode: "SELECTION_RESEARCH",
      requestKey: insufficientKey,
      createdById: user.id,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const insufficientCode = insufficient && typeof insufficient === "object" && "code" in insufficient ? (insufficient as { code: string }).code : null;
    record("余额不足时拒绝执行", insufficientCode === "POINTS_INSUFFICIENT", `错误码 ${insufficientCode ?? "无"}`);

    const request = await createPointsRequest({
      organizationId: organization.id,
      applicantId: user.id,
      requestedAmount: 40,
      reason: "冒烟测试：验证审批补充额度链路是否正常",
      usagePlan: "自动化验证",
    });
    record("提交补充申请", request.status === "PENDING", `单号 ${request.requestNo}`);

    const selfApprove = await approvePointsRequest({
      organizationId: organization.id,
      requestId: request.id,
      approverId: user.id,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    const selfCode = selfApprove && typeof selfApprove === "object" && "code" in selfApprove ? (selfApprove as { code: string }).code : null;
    record("禁止审批自己的申请", selfCode === "POINTS_SELF_APPROVAL", `错误码 ${selfCode ?? "无"}`);

    if (owner) {
      const beforeApprove = await getMyPointsSummary(organization.id, user.id);
      const approved = await approvePointsRequest({
        organizationId: organization.id,
        requestId: request.id,
        approverId: owner.userId,
        decisionNote: "冒烟通过",
      });
      const afterApprove = await getMyPointsSummary(organization.id, user.id);
      record(
        "审批通过后发放当月补充额",
        approved.grantedPoints === 40 &&
          afterApprove.extraGranted === 40 &&
          afterApprove.balance === beforeApprove.balance + 40,
        `批准 ${approved.grantedPoints}，余额 ${beforeApprove.balance} → ${afterApprove.balance}，补充额 ${afterApprove.extraGranted}`,
      );
    } else {
      record("审批通过后发放当月补充额", false, "组织内没有 owner，跳过");
    }

    const ledgerCount = await prisma.pointsLedger.count({ where: { organizationId: organization.id, userId: user.id } });
    record("流水完整写入", ledgerCount >= 6, `共 ${ledgerCount} 条`);

    const account = await prisma.pointsAccount.findUnique({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    });
    // account.balance 已经把 HELD 的预扣扣掉了，因此对账必须包含全部流水（含 HELD）
    const ledgerSum = await prisma.pointsLedger.aggregate({
      where: { organizationId: organization.id, userId: user.id },
      _sum: { delta: true },
    });
    record(
      "对账：流水净额 = 账户余额",
      (ledgerSum._sum.delta ?? 0) === (account?.balance ?? -1),
      `流水净额 ${ledgerSum._sum.delta ?? 0}，账户余额 ${account?.balance ?? -1}`,
    );
  } finally {
    await prisma.pointsRequest.deleteMany({ where: { applicantId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }

  await verifyCarryover(organization.id, stamp);

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/** 跨月结转：上月剩 30 → 本月 50 + 30 = 80，且结转额不可再结转。 */
async function verifyCarryover(organizationId: string, stamp: number) {
  const email = `points-carry-${stamp}@local.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `结转冒烟 ${stamp}`,
      passwordHash: "smoke-not-a-real-hash",
      status: "active",
      memberships: { create: { organizationId, role: "operations" } },
    },
  });

  try {
    const lastMonth = new Date("2026-10-15T04:00:00Z");
    const thisMonth = new Date("2026-11-14T04:00:00Z");

    await prisma.$transaction(async (tx) => {
      const { ensurePointsPeriod } = await import("@/lib/points/account");
      await ensurePointsPeriod(tx, { organizationId, userId: user.id, at: lastMonth });
    });

    const drainKey = `carry-drain-${stamp}`;
    await reservePoints({
      organizationId,
      userId: user.id,
      operationCode: "SELECTION_RESEARCH",
      requestKey: drainKey,
      createdById: user.id,
      at: lastMonth,
    });
    await settlePoints({
      organizationId,
      userId: user.id,
      requestKey: drainKey,
      actualCost: 20,
      createdById: user.id,
      at: lastMonth,
    });

    const { ensurePointsPeriod } = await import("@/lib/points/account");
    await prisma.$transaction(async (tx) => {
      await ensurePointsPeriod(tx, { organizationId, userId: user.id, at: thisMonth });
    });

    const account = await prisma.pointsAccount.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    const grants = await prisma.pointsGrant.findMany({
      where: { organizationId, userId: user.id, status: "ACTIVE" },
      orderBy: { kind: "asc" },
    });
    const carried = grants.find((grant) => grant.kind === "CARRIED");

    record(
      "跨月结转 30 分，本月可用 80",
      account?.balance === 80 && carried?.amount === 30,
      `余额 ${account?.balance}，结转批次 ${carried?.amount ?? 0}`,
    );

    record(
      "结转批次不可再结转",
      carried ? carried.carryable === false : false,
      `carryable=${carried ? String(carried.carryable) : "无结转批次"}`,
    );

    // 再跨一个月且不使用：结转额作废，只剩 50 基础
    const nextMonth = new Date("2026-12-14T04:00:00Z");
    await prisma.$transaction(async (tx) => {
      await ensurePointsPeriod(tx, { organizationId, userId: user.id, at: nextMonth });
    });
    const nextAccount = await prisma.pointsAccount.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    record("连续两月不用仍是 100 上限", nextAccount?.balance === 100, `第三月可用 ${nextAccount?.balance}`);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}
