/**
 * 影子计量验证：确认 Agent 计量在不阻断业务的前提下正确记账。
 *
 * 覆盖：
 * 1. 正常余额：预扣 → 结算，按单价扣分，余额回调。
 * 2. 释放路径：预扣后释放，余额回到预扣前。
 * 3. 余额不足：不抛异常，reserved=false，带 skipReason。
 *
 * 用法：npm run verify:points:usage（需要真实库，脚本自建自删临时用户）
 */
import { prisma } from "@/lib/db/prisma";
import { getMyPointsSummary } from "@/lib/points/summary";
import { operationCodeForAgent, startAgentMeter } from "@/lib/points/usage";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function main() {
  const stamp = Date.now();
  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) throw new Error("没有可用组织，无法验证");

  const user = await prisma.user.create({
    data: {
      email: `points-usage-${stamp}@example.invalid`,
      name: `积分计量临时用户 ${stamp}`,
      passwordHash: "smoke-not-a-real-hash",
      status: "active",
      memberships: { create: { organizationId: organization.id, role: "operations" } },
    },
  });

  try {
    const initial = await getMyPointsSummary(organization.id, user.id);

    // 1. listing agent → LISTING_GENERATE，单价 5，预扣上限 20
    const meter = await startAgentMeter({ organizationId: organization.id, userId: user.id, agentId: "listing" });
    record("预扣成功", meter.reserved, `requestKey=${meter.requestKey}`);

    const held = await getMyPointsSummary(organization.id, user.id);
    record("预扣按 maxCost 冻结", held.reserved === 20, `冻结 ${held.reserved}，余额 ${held.balance}`);

    const settled = await meter.settle("execution-smoke");
    record("结算按单价扣分", settled?.charged === 5, `实扣 ${settled?.charged ?? "null"}，期望 5`);

    const afterSettle = await getMyPointsSummary(organization.id, user.id);
    record(
      "结算后余额回到初始减单价",
      afterSettle.balance === initial.balance - 5 && afterSettle.reserved === 0,
      `余额 ${initial.balance} → ${afterSettle.balance}，冻结 ${afterSettle.reserved}`,
    );

    record(
      "agent → operationCode 映射",
      operationCodeForAgent("listing") === "LISTING_GENERATE" && operationCodeForAgent("market") === "SELECTION_RESEARCH",
      `listing=${operationCodeForAgent("listing")} market=${operationCodeForAgent("market")}`,
    );

    // 2. 失败任务释放：预扣后 release，余额回到预扣前
    const beforeRelease = await getMyPointsSummary(organization.id, user.id);
    const meter2 = await startAgentMeter({ organizationId: organization.id, userId: user.id, agentId: "orchestrator" });
    const heldBeforeRelease = await getMyPointsSummary(organization.id, user.id);
    await meter2.release();
    const afterRelease = await getMyPointsSummary(organization.id, user.id);
    record(
      "释放后余额回到预扣前",
      afterRelease.balance === beforeRelease.balance && afterRelease.reserved === 0 && heldBeforeRelease.reserved > 0,
      `预扣前 ${beforeRelease.balance}，冻结 ${heldBeforeRelease.reserved} → 释放后 ${afterRelease.balance}`,
    );

    // 3. 余额不足：不抛异常
    let remaining = afterRelease.balance;
    while (remaining > 0) {
      const drain = await startAgentMeter({ organizationId: organization.id, userId: user.id, agentId: "product" });
      if (!drain.reserved) break;
      const result = await drain.settle();
      if (!result || result.charged === 0) break;
      remaining -= result.charged;
    }
    const drained = await getMyPointsSummary(organization.id, user.id);

    let threw: unknown = null;
    let meter3 = null;
    try {
      meter3 = await startAgentMeter({ organizationId: organization.id, userId: user.id, agentId: "market" });
    } catch (error) {
      threw = error;
    }
    record(
      "余额不足不阻断业务",
      threw === null && meter3 !== null && meter3.reserved === false,
      `余额 ${drained.balance}，异常=${threw ? "有" : "无"}，reserved=${meter3?.reserved ?? "null"}，原因=${meter3?.skipReason ?? "无"}`,
    );
  } finally {
    await prisma.pointsAllocation.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsLedger.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsGrant.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsPeriod.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsAccount.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsMemberOverride.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.pointsRequest.deleteMany({ where: { applicantId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
