/**
 * 赛狐/亚马逊广告写回闸门与执行计划（可审计、幂等、fail-closed）。
 *
 * 事实边界（2026-11-23 勘察）：
 * - 生产无赛狐写端点、无 AMAZON_ADS_WRITE_ENABLED 开关；本代码库的 Amazon Ads HTTP transport
 *   明确为 NOT_IMPLEMENTED（见 src/lib/amazon/ads-client.ts:unimplementedAmazonAdsBidClient）。
 * - 因此本模块只做：能力判定 + 执行计划构建 + 逐条结果裁决。**绝不伪造成功、绝不在未授权/未实现时写库为 EXECUTED**。
 * - 真实写回必须先：绑定 Amazon Ads 授权 → 实现 transport → 小额契约验证 → 打开开关，
 *   并经「生成方案 → 双人复核 → 变更单」链（复用 amazon-action-audit 的 preview/confirm/apply 语义）。
 */
import { createHash } from "node:crypto";

export type AdsWriteCapability = {
  /** 环境开关是否允许写回意图进入执行阶段。 */
  enabled: boolean;
  /** 外部 HTTP transport 是否可用；当前版本恒为 unimplemented。 */
  transport: "unimplemented" | "ready";
  note: string;
};

/** 能力判定：开关与传输必须同时满足才可能真实写回。当前传输未实现，故 ready 恒为 false。 */
export function adsWriteCapability(env: Record<string, string | undefined> = process.env): AdsWriteCapability {
  const enabled = env.AMAZON_ADS_WRITE_ENABLED === "1";
  const transport: AdsWriteCapability["transport"] = "unimplemented";
  const note = !enabled
    ? "写回未开启（AMAZON_ADS_WRITE_ENABLED≠1）；方案仅可生成/审批，不会执行。"
    : "Amazon Ads 真实写回 transport 尚未实现；开关不能绕过此闸门，整批不会发送。";
  return { enabled, transport, note };
}

export type WritableProposal = {
  id: string;
  action: string;
  entityType: string;
  externalId: string;
  status: string;
  current: unknown;
  proposed: unknown;
};

export type AdsBidUpdate = { entity: "keyword" | "target"; entityId: string; bid: number };

export type AdsPlanItem =
  | { proposalId: string; status: "READY"; update: AdsBidUpdate }
  | { proposalId: string; status: "SKIPPED"; reason: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function currentBidOf(current: unknown): number | null {
  const value = asRecord(current).bid;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * 由已批准方案构建写回批次。逐条裁决，任何不满足契约的项跳过并带原因，不猜 bid、不用 text: hash 当官方 ID。
 * bidMultiplier 是相对倍率，必须乘以「审批时快照的 current.bid」得到绝对价；缺 current 即跳过（fail-closed）。
 */
export function buildAdsBidPlan(proposals: WritableProposal[]): { updates: AdsBidUpdate[]; items: AdsPlanItem[] } {
  const updates: AdsBidUpdate[] = [];
  const items: AdsPlanItem[] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    const skip = (reason: string) => items.push({ proposalId: proposal.id, status: "SKIPPED", reason });
    if (proposal.status !== "APPROVED") { skip(`状态非 APPROVED（${proposal.status}）`); continue; }
    if (proposal.action !== "LOWER_BID" && proposal.action !== "RAISE_BID") {
      skip(`非出价动作（${proposal.action}）不在 bid transport 支持范围`); continue;
    }
    let entity: "keyword" | "target";
    if (proposal.entityType === "SP:keyword") entity = "keyword";
    else if (proposal.entityType === "SP:target") entity = "target";
    else { skip(`实体类型不支持写回（${proposal.entityType}）`); continue; }
    if (!/^\d+$/.test(proposal.externalId)) { skip("外部 ID 非官方数字 ID（疑似 text: hash）"); continue; }
    const multiplier = asRecord(proposal.proposed).bidMultiplier;
    if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier <= 0) { skip("bidMultiplier 无效"); continue; }
    const currentBid = currentBidOf(proposal.current);
    if (currentBid == null) { skip("缺少审批时 current.bid 快照，无法计算绝对出价"); continue; }
    const bid = Math.round(currentBid * multiplier * 100) / 100;
    if (bid < 0.02 || bid > 100) { skip(`计算出价 ${bid} 超出 [0.02,100]`); continue; }
    const key = `${entity}:${proposal.externalId}`;
    if (seen.has(key)) { skip("同批次重复实体 ID"); continue; }
    seen.add(key);
    const update: AdsBidUpdate = { entity, entityId: proposal.externalId, bid };
    updates.push(update);
    items.push({ proposalId: proposal.id, status: "READY", update });
  }
  return { updates, items };
}

/** 幂等键：绑定组织/工作区/提议/倍率；同一审批重放得到同一键，参数变更则键变化。 */
export function adsWriteIdempotencyKey(input: {
  organizationId: string; workspaceId: string; proposalId: string; action: string; proposed: unknown;
}): string {
  const basis = JSON.stringify([
    input.organizationId, input.workspaceId, input.proposalId, input.action,
    asRecord(input.proposed).bidMultiplier ?? null,
    asRecord(input.proposed).state ?? null,
  ]);
  return `ads-write:${createHash("sha256").update(basis).digest("hex").slice(0, 32)}`;
}

export type AdsExecutionResult = {
  capability: AdsWriteCapability;
  idempotencyKey: string;
  /** 无任何项被真实写回；FAILED 的 code 说明闸门。 */
  items: Array<{ proposalId: string; status: "FAILED" | "SKIPPED"; code: string; message: string }>;
  applied: number;
};

/**
 * 执行裁决：在当前版本恒不写回。返回逐条结果，code 精确标注 NOT_ENABLED / NOT_IMPLEMENTED，
 * 供前端与审计展示。禁止把本函数返回值写成「已执行成功」。
 */
export function decideAdsExecution(input: {
  capability: AdsWriteCapability;
  plan: ReturnType<typeof buildAdsBidPlan>;
  idempotencyKey: string;
}): AdsExecutionResult {
  const { capability, plan, idempotencyKey } = input;
  const items = plan.items.map((item): AdsExecutionResult["items"][number] => {
    if (item.status === "SKIPPED") return { proposalId: item.proposalId, status: "SKIPPED", code: "INVALID_PLAN", message: item.reason };
    if (!capability.enabled) return { proposalId: item.proposalId, status: "FAILED", code: "NOT_ENABLED", message: capability.note };
    return { proposalId: item.proposalId, status: "FAILED", code: "NOT_IMPLEMENTED", message: capability.note };
  });
  return { capability, idempotencyKey, items, applied: 0 };
}
