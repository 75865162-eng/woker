/**
 * 落地页数据保障的定时巡检钩子（无人值守）。
 *
 * 由 scheduler.tickSyncCenter 的维护阶段调用，默认关闭，需设置
 * LANDING_ASSURANCE_AUTO=1 开启。开启后每个 tick：
 *   - 扫描全部迁移页，找出"有数据源但未发布且无活动任务"的站点；
 *   - 对满足冷却期的源，经受控审批链触发一次补采；
 *   - 触发/跳过结果写入结构化审计日志，便于观测。
 *
 * 安全边界：
 *   - 只补采"有源、授权 CONFIGURED、enabled、无 activeRunId、无活动任务"的站点，
 *     且同 resource 至少有一个其它站点已成功发布（局部缺口）；整类全失败属需人工根因问题，跳过；
 *   - 不建源、不改策略、不造数、不绕过 processor 的站点归属校验；
 *   - 冷却期（LANDING_ASSURANCE_COOLDOWN_MINUTES，默认 180）防止与自动计划/恢复竞争，
 *     也避免对反复失败的报告（如缺归档原件）无限重试；
 *   - 单 scope 单 tick 最多触发 LANDING_ASSURANCE_MAX_PER_TICK（默认 4）个源，限速。
 */
import { prisma } from "@/lib/db/prisma";
import { randomUUID } from "node:crypto";
import { scanAllPages, collectReconcilableSourceIds } from "./landing-data-assurance";
import { reconcileSources } from "./landing-reconciler";
import type { SyncScope } from "./policy";

export type LandingAutoTickResult = {
  enabled: boolean;
  skipped?: string;
  scannedPages?: number;
  candidates?: number;
  triggered?: number;
  detail?: string;
};

const COOLDOWN_MINUTES = Number(process.env.LANDING_ASSURANCE_COOLDOWN_MINUTES ?? "180") || 180;
const MAX_PER_TICK = Number(process.env.LANDING_ASSURANCE_MAX_PER_TICK ?? "4") || 4;
const AUDIT_ACTION = "amazon.sync.landing.auto-reconcile";

/**
 * 局部缺口门槛：仅当同 resource 下已有其它站点成功发布（activeRunId 非空）时，
 * 该源的未发布才视为"偶发缺口"，值得自动补采。整类 resource 全站点失败
 * （如缺站点归属证据 / 无归档原件 / 需额外角色）属于需人工排查的根因问题，
 * 自动重试只会反复失败并消耗 Amazon API 配额，故跳过。
 */
async function hasPublishedSibling(scope: SyncScope, sourceId: string): Promise<boolean> {
  const source = await prisma.amazonSyncDataSource.findFirst({
    where: { ...scope, id: sourceId }, select: { resource: true },
  });
  if (!source) return false;
  const published = await prisma.amazonSyncDataSource.count({
    where: { ...scope, resource: source.resource, id: { not: sourceId }, activeRunId: { not: null } },
  });
  return published > 0;
}

/** 距上次自动补采审计记录是否过了冷却期。 */
async function coolingDown(scope: SyncScope, sourceId: string, now: Date): Promise<boolean> {
  const prior = await prisma.auditLog.findFirst({
    // AuditLog 无 workspaceId 字段；sourceId 为全局唯一 UUID，organizationId + action + entityId 足够定位。
    where: { organizationId: scope.organizationId, action: AUDIT_ACTION, entityId: sourceId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!prior) return false;
  return now.getTime() - prior.createdAt.getTime() < COOLDOWN_MINUTES * 60_000;
}

/** 找该 scope 一名 active owner 作为补采 actor（审批需 approve 权限）。 */
async function resolveOwner(scope: SyncScope): Promise<string | null> {
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: scope.organizationId, role: "owner", user: { status: "active" } },
    select: { userId: true },
  });
  return member?.userId ?? null;
}

/** 单个 scope 的巡检 tick。 */
export async function tickLandingAssuranceForScope(scope: SyncScope, now = new Date()): Promise<LandingAutoTickResult> {
  if (process.env.LANDING_ASSURANCE_AUTO !== "1") return { enabled: false, skipped: "disabled" };
  if (!process.env.DATABASE_URL) return { enabled: false, skipped: "no_database" };

  const actor = await resolveOwner(scope);
  if (!actor) return { enabled: true, skipped: "no_owner" };

  try {
    const scan = await scanAllPages(scope, actor);
    let candidates = collectReconcilableSourceIds(scan);
    // 冷却过滤 + 每 tick 限量
    const eligible: string[] = [];
    for (const sourceId of candidates) {
      if (eligible.length >= MAX_PER_TICK) break;
      if (!(await hasPublishedSibling(scope, sourceId))) continue; // 整类全失败 → 需人工排查，不自动重试
      if (!(await coolingDown(scope, sourceId, now))) eligible.push(sourceId);
    }
    candidates = eligible;
    if (!candidates.length) return { enabled: true, scannedPages: scan.totalPages, candidates: 0, triggered: 0 };

    const results = await reconcileSources(scope, actor, candidates);
    for (const r of results) {
      await prisma.auditLog.create({ data: {
        id: randomUUID(), organizationId: scope.organizationId, userId: actor, action: AUDIT_ACTION,
        entityType: "AmazonSyncDataSource", entityId: r.sourceId,
        metadata: { workspaceId: scope.workspaceId, resource: r.resource, status: r.status,
          changeRequestId: r.changeRequestId ?? null, detail: r.detail.slice(0, 200), at: now.toISOString() },
      } }).catch(() => undefined);
    }
    return {
      enabled: true, scannedPages: scan.totalPages, candidates: candidates.length,
      triggered: results.filter(r => r.status === "TRIGGERED").length,
      detail: results.map(r => `${r.resource}:${r.status}`).join(", "),
    };
  } catch (error) {
    return { enabled: true, skipped: "error", detail: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

/** 所有启用 scope 的巡检（供 scheduler 调用）；单个 scope 失败不影响其它。 */
export async function tickLandingAssurance(scopes?: SyncScope[], now = new Date()): Promise<LandingAutoTickResult[]> {
  if (process.env.LANDING_ASSURANCE_AUTO !== "1") return [{ enabled: false, skipped: "disabled" }];
  const list = scopes ?? [];
  const results: LandingAutoTickResult[] = [];
  for (const scope of list) results.push(await tickLandingAssuranceForScope(scope, now));
  return results;
}
