/**
 * 落地页数据保障框架 CLI。
 *
 * 用法（服务端 owner 身份，读取真实 scope）：
 *   npm run landing:scan              # 扫描全部 WIMOOR 迁移页的数据健康度
 *   npm run landing:scan -- --href /wimoor/sales/fba-feiyong
 *   npm run landing:reconcile         # 扫描 + 对"有源未发布"页自动触发重采
 *   npm run landing:reconcile -- --apply  # 同上，真实触发（默认 dry-run 仅列出）
 *
 * 身份与 scope：
 *   - 优先 OPS_CLI_ORGANIZATION_ID / OPS_CLI_WORKSPACE_IDS / OPS_CLI_ACTOR_USER_ID；
 *   - 未配置时回退 AMAZON_SYNC_CENTER_SCOPES 的第一对 scope，并从该 scope 选一名 owner。
 * 只读命令走 READ ONLY 事务语义；reconcile --apply 走既有受控审批链。
 */
import { applyRuntimeEnvironment } from "./runtime/environment.mjs";
import { prisma } from "../src/lib/db/prisma";
import {
  scanAllPages, formatScanSummary, collectReconcilableSourceIds,
  type ScanSummary,
} from "../src/lib/amazon-sync/landing-data-assurance";
import {
  reconcileSources, publishedSince, formatReconcileResults,
} from "../src/lib/amazon-sync/landing-reconciler";
import type { SyncScope } from "../src/lib/amazon-sync/policy";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

async function resolveIdentity(): Promise<{ scope: SyncScope; actor: string }> {
  const org = process.env.OPS_CLI_ORGANIZATION_ID?.trim();
  const ws = process.env.OPS_CLI_WORKSPACE_IDS?.split(",").map(v => v.trim()).filter(Boolean)[0];
  const actor = process.env.OPS_CLI_ACTOR_USER_ID?.trim();
  if (org && ws && actor) return { scope: { organizationId: org, workspaceId: ws }, actor };

  // 回退：从已启用 scope 中取第一对，并选一名 active owner。
  const raw = process.env.AMAZON_SYNC_CENTER_SCOPES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Array<[string, string]>;
      const [organizationId, workspaceId] = parsed[0] ?? [];
      if (organizationId && workspaceId) {
        const owner = await prisma.organizationMember.findFirst({
          where: { organizationId, role: "owner", user: { status: "active" } },
          select: { userId: true },
        });
        if (owner) return { scope: { organizationId, workspaceId }, actor: owner.userId };
      }
    } catch { /* 落到下方报错 */ }
  }
  throw new Error("无法确定 scope/actor：请配置 OPS_CLI_ORGANIZATION_ID/OPS_CLI_WORKSPACE_IDS/OPS_CLI_ACTOR_USER_ID 或 AMAZON_SYNC_CENTER_SCOPES（需存在 active owner）。");
}

async function main() {
  applyRuntimeEnvironment();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置。");
  const { scope, actor } = await resolveIdentity();

  const mode = has("--reconcile") ? "reconcile" : has("--cycle") ? "cycle" : "scan";
  const apply = has("--apply");
  const onlyHref = valueOf("--href");

  console.log(`[landing-assurance] mode=${mode} apply=${apply} scope=${scope.organizationId}/${scope.workspaceId} actor=${actor}`);

  const scan: ScanSummary = await scanAllPages(scope, actor, onlyHref ? [onlyHref] : undefined);
  console.log(formatScanSummary(scan));
  console.log("");
  console.log(JSON.stringify({ mode, stateCounts: scan.stateCounts, totalPages: scan.totalPages }));

  if (mode === "scan") return;

  const sourceIds = collectReconcilableSourceIds(scan);
  if (!sourceIds.length) {
    console.log("没有可自动补采的数据源（无数据的页均为需前置授权/未实现/业务空，框架不造数）。");
    return;
  }
  console.log(`\n可补采源 ${sourceIds.length} 个：${sourceIds.join(", ")}`);
  if (!apply) {
    console.log("dry-run：未触发。加 --apply 通过受控审批链提交重采。");
    return;
  }
  const results = await reconcileSources(scope, actor, sourceIds);
  console.log(formatReconcileResults(results));
  console.log("");
  // 已发布源提示（供下一次 --scan 复验）
  const published = await publishedSince(scope, sourceIds);
  console.log(`当前已发布源 ${published.length} 个：${published.map(p => `${p.resource}:${p.sourceId}`).join(", ") || "无"}`);
}

main()
  .catch((error: unknown) => {
    console.error("[landing-assurance] FAILED:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => { if (process.env.DATABASE_URL) await prisma.$disconnect(); });
