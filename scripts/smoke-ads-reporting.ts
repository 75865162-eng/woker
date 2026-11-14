/**
 * SP 五类绩效报表端到端冒烟：种子 Ads 授权/Profile/计划 → 五类报表任务 → 假传输（GZIP_JSON）
 * → 解析、入库、发布 → 用只读查询接口回读。默认清理所有种子数据，`--keep` 保留演示数据。
 */
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { prisma } from "../src/lib/db/prisma";
import { encryptAmazonAdsRefreshToken } from "../src/lib/amazon-ads/credentials";
import { AdsQueryError } from "../src/lib/amazon-ads/query-contract";
import { queryPublishedAdsReports } from "../src/lib/amazon-ads/report-query";
import { ensureSpReportTask, processAmazonAdsReportTask } from "../src/lib/amazon-ads/report-service";
import { spReportTypeIds, type SpReportType } from "../src/lib/amazon-ads/sp-report-types";
import type { SpReportReceipt, SpReportTransport } from "../src/lib/amazon-ads/reporting-v3-transport";

const keep = process.argv.includes("--keep");
const organizationId = process.env.SMOKE_ORGANIZATION_ID ?? "cmwdhm9ph0000o4ug8gd68zhd";
const workspaceId = process.env.SMOKE_WORKSPACE_ID ?? "default";
const scope = { organizationId, workspaceId };
const from = "2026-11-05";
const to = "2026-11-11";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rowsFor(type: SpReportType) {
  const base = { campaignBudgetCurrencyCode: "USD", campaignName: "SMOKE", campaignStatus: "ENABLED", impressions: 1000, clicks: 20, cost: 10.5, purchasesClicks: 2, salesClicks: 40, unitsSoldClicks: 2 };
  const days = [from, "2026-11-06"];
  return days.flatMap((date, index) => {
    const metrics = { ...base, date, impressions: 1000 + index * 100, clicks: 20 + index, cost: 10.5 + index, purchasesClicks: 2 + index, salesClicks: 40 + index * 10, unitsSoldClicks: 2 + index };
    switch (type) {
      case "campaign": return [{ ...metrics, campaignId: "C-1" }];
      case "placement": return [{ ...metrics, campaignId: "C-1", placementClassification: "TOP_OF_SEARCH" }, { ...metrics, campaignId: "C-1", placementClassification: "PRODUCT_PAGE", impressions: 300 }];
      case "advertised-product": return [{ ...metrics, campaignId: "C-1", adGroupId: "A-1", advertisedAsin: "B0SMOKE001", advertisedSku: "SKU-1" }];
      case "search-term": return [{ ...metrics, campaignId: "C-1", adGroupId: "A-1", keywordId: "K-1", keyword: "smoke test", keywordType: "EXACT", matchType: "EXACT", searchTerm: "smoke test" }];
      case "targeting": return [{ ...metrics, campaignId: "C-1", adGroupId: "A-1", targetingId: "T-1", targeting: "keyword=\"smoke test\"", keyword: "smoke test", keywordType: "EXACT", matchType: "EXACT" }];
    }
  });
}

/** 假传输：保留官方三步语义（创建 / 轮询 / 下载），不触网。 */
function fakeTransport(): SpReportTransport {
  const pending = new Map<string, { type: SpReportType; polls: number; bytes: Buffer }>();
  const typeByReportTypeId = new Map<string, SpReportType>();
  return {
    async create(input): Promise<SpReportReceipt> {
      const type = spReportTypeIds.find(value => value === inferType(input.request.configuration.groupBy))!;
      typeByReportTypeId.set(input.request.name, type);
      const reportId = `smoke-${randomUUID()}`;
      const rows = rowsFor(type);
      pending.set(reportId, { type, polls: 0, bytes: gzipSync(Buffer.from(JSON.stringify(rows), "utf8")) });
      return { reportId, status: "PENDING" };
    },
    async retrieve(input): Promise<SpReportReceipt> {
      const entry = pending.get(input.reportId);
      if (!entry) throw new AdsQueryError("ADS_REPORT_ENVELOPE_INVALID");
      entry.polls += 1;
      if (entry.polls < 2) return { reportId: input.reportId, status: "PROCESSING" };
      return { reportId: input.reportId, status: "COMPLETED", url: `https://s3.amazonaws.com/smoke/${input.reportId}.gz` };
    },
    async download(input) {
      const id = input.url.split("/").pop()!.replace(/\.gz$/, "");
      const entry = pending.get(id);
      if (!entry) throw new AdsQueryError("ADS_REPORT_DOWNLOAD_FAILED");
      return entry.bytes;
    },
  };
}

function inferType(groupBy: readonly string[]): SpReportType {
  if (groupBy.includes("campaignPlacement")) return "placement";
  if (groupBy.includes("searchTerm")) return "search-term";
  if (groupBy.includes("targeting")) return "targeting";
  if (groupBy.includes("advertiser")) return "advertised-product";
  return "campaign";
}

async function main() {
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, role: "owner" }, select: { userId: true } });
  assert(member, "缺少组织管理员，无法运行冒烟。");
  const actor = member.userId;
  const suffix = randomUUID().slice(0, 8);
  const sellerId = `smoke-seller-${suffix}`;
  const authorizationId = `smoke-auth-${suffix}`;
  const profileId = `smoke-profile-${suffix}`;
  const planId = `smoke-plan-${suffix}`;
  const credentialScope = { ...scope, authorizationId };
  console.log(`[smoke] org=${organizationId} actor=${actor}`);

  await prisma.sellerAccount.create({ data: { id: sellerId, ...scope, accountKey: `SMOKE-ADS-${suffix}`, displayName: "SMOKE-ADS-REPORT", marketplaceCode: "US", marketplaceId: null, status: "active" } });
  await prisma.amazonAdsAuthorization.create({ data: {
    id: authorizationId, ...scope, name: "SMOKE-ADS-REPORT", consentRegion: "NA", status: "CONNECTED", authorizedByUserId: actor,
    credentialsCiphertext: encryptAmazonAdsRefreshToken(`smoke-refresh-${suffix}`, credentialScope),
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000 * 30),
  } });
  await prisma.amazonAdsProfile.create({ data: {
    id: profileId, ...scope, authorizationId, region: "NA", profileId: `1234567890${suffix.length}`, advertiserAccountId: `amzn1.ads-account.g.${suffix}`,
    countryCode: "US", marketplaceId: "ATVPDKIKX0DER", currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: { name: "SMOKE-ADS-REPORT" }, sellerAccountId: sellerId,
  } });
  await prisma.amazonDataAccessGrant.create({ data: { id: `smoke-grant-${suffix}`, ...scope, userId: actor, sellerAccountId: sellerId, enabled: true, marketplaceIds: [], actions: ["view", "sync", "export", "edit"] } });
  await prisma.amazonAdsSyncPlan.create({ data: {
    id: planId, ...scope, profileId, actorUserId: actor, sellerAccountId: sellerId, authorizationRevision: 1,
    status: "ACTIVE", revision: 1, intervalMinutes: 1440, reportLookbackDays: 7,
  } });

  const transport = fakeTransport();
  const taskIds: string[] = [];
  for (const type of spReportTypeIds) {
    const created = await ensureSpReportTask(scope, planId, type, { from, to });
    taskIds.push(created.taskId);
    console.log(`[smoke] task ${type} -> ${created.taskId}`);
  }

  let clock = new Date("2026-11-13T03:00:00Z");
  for (const taskId of taskIds) {
    let settled = false;
    for (let step = 0; step < 24 && !settled; step += 1) {
      const task = await prisma.amazonAdsSyncTask.findUnique({ where: { id: taskId }, select: { dispatchVersion: true, status: true, errorCode: true } });
      assert(task, "任务消失");
      if (["SUCCEEDED", "BLOCKED", "FAILED", "CANCELLED"].includes(task.status)) {
        assert(task.status === "SUCCEEDED", `任务 ${taskId} 未成功：${task.status}/${task.errorCode}`);
        settled = true;
        break;
      }
      clock = new Date(clock.getTime() + 61_000);
      const result = await processAmazonAdsReportTask(taskId, task.dispatchVersion, { transport, accessToken: "smoke-token", clientId: "smoke-client", now: () => clock });
      if (result.outcome === "skipped") {
        // 同一 Profile 串行：等前一份报表结束，下一轮重新调度。
        await prisma.amazonAdsSyncTask.updateMany({ where: { id: taskId, status: { in: ["WAITING", "QUEUED"] } }, data: { nextAttemptAt: new Date(0) } });
      }
    }
    assert(settled, `任务 ${taskId} 未在步数上限内完成`);
  }

  const versions = await prisma.amazonAdsReportVersion.findMany({ where: { ...scope, profileId }, select: { id: true, status: true, rowCount: true, sourceTaskId: true } });
  assert(versions.length === 5 && versions.every(version => version.status === "PUBLISHED"), `应发布 5 个版本，实际 ${versions.length}`);
  const facts = await prisma.amazonAdsReportFact.groupBy({ by: ["reportType"], where: { ...scope, profileId }, _count: { _all: true }, _sum: { impressions: true } });
  console.log("[smoke] published versions:", versions.map(version => `${version.rowCount} rows`).join(", "));
  console.log("[smoke] facts by type:", facts.map(row => `${row.reportType}=${row._count._all}/imp=${row._sum.impressions}`).join(", "));
  for (const type of spReportTypeIds) {
    assert(facts.some(row => row.reportType === type), `缺少 ${type} 的事实行`);
  }

  const read = await queryPublishedAdsReports(scope, actor, { kind: "reports", from, to, reportType: "placement", sellerAccountId: sellerId, page: 1, pageSize: 50, sortBy: "reportDate", sortDirection: "asc" } as never);
  assert(Array.isArray(read.rows) && read.rows.length >= 2, "只读查询应返回位置报表事实");
  const placements = new Set(read.rows.map(row => row.placement));
  assert(placements.has("TOP_OF_SEARCH") && placements.has("PRODUCT_PAGE"), "位置维度应可区分");
  console.log(`[smoke] read-back placement rows=${read.rows.length} placements=${[...placements].join("|")}`);

  const states = await prisma.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId, dataDomain: "reports" }, select: { reportType: true, status: true } });
  assert(states.length === 5 && states.every(state => state.status === "CURRENT"), `五类域状态应为 CURRENT，实际 ${JSON.stringify(states)}`);
  console.log("[smoke] domain states:", states.map(state => `${state.reportType}:${state.status}`).join(", "));

  if (keep) {
    console.log(`[smoke] --keep 保留演示数据：profile=${profileId} plan=${planId}`);
  } else {
    await cleanup(profileId, planId, authorizationId, sellerId, scope);
    console.log("[smoke] 已清理种子数据");
  }
  await prisma.$disconnect();
  console.log("[smoke] PASS");
}

async function cleanup(profileId: string, planId: string, authorizationId: string, sellerId: string, scope: { organizationId: string; workspaceId: string }) {
  const requests = await prisma.amazonAdsReportRequest.findMany({ where: { ...scope, profileId }, select: { id: true } });
  const requestIds = requests.map(request => request.id);
  const documents = requestIds.length ? await prisma.amazonAdsReportDocument.findMany({ where: { ...scope, requestId: { in: requestIds } }, select: { storageFileId: true } }) : [];
  const fileIds = documents.map(document => document.storageFileId).filter((id): id is string => Boolean(id));
  await prisma.$transaction([
    prisma.amazonAdsReportFact.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsReportDocument.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsReportRequest.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsReportVersion.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsSyncAttempt.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsSyncDomainState.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsSyncTask.deleteMany({ where: { ...scope, profileId } }),
    prisma.amazonAdsSyncPlan.deleteMany({ where: { id: planId } }),
    prisma.amazonAdsProfile.deleteMany({ where: { id: profileId } }),
    prisma.amazonAdsAuthorization.deleteMany({ where: { id: authorizationId } }),
    prisma.amazonDataAccessGrant.deleteMany({ where: { ...scope, sellerAccountId: sellerId } }),
    prisma.sellerAccount.deleteMany({ where: { id: sellerId } }),
    ...(fileIds.length ? [prisma.fileObject.deleteMany({ where: { ...scope, id: { in: fileIds } } })] : []),
  ]);
}

main().catch(async error => {
  console.error("[smoke] FAIL", error instanceof AdsQueryError ? `${error.message} (${error.status})` : error);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
