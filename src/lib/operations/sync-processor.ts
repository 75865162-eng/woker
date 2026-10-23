import { randomUUID } from "node:crypto";
import { extractAmazonInventorySnapshots, resolveAmazonMarketplaceId } from "@/lib/amazon/inventory";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";
import { prisma } from "@/lib/db/prisma";
import { extractMarketplaceParticipations } from "./readiness";
import { withAmazonSyncLock } from "./sync-lock";

const amazonProvider = "amazon_sp_api";
const maxInventoryPages = 1_000;
const maxInventoryRows = 50_000;
const snapshotInsertChunkSize = 1_000;

export async function processAmazonSyncRun(runId: string, options: { isFinalAttempt: boolean }) {
  const candidate = await prisma.amazonSyncRun.findUnique({ where: { id: runId } });
  if (!candidate || candidate.status !== "QUEUED") return;
  await withAmazonSyncLock(candidate, () => processLockedAmazonSyncRun(runId, options));
}

async function processLockedAmazonSyncRun(runId: string, options: { isFinalAttempt: boolean }) {
  const claimed = await prisma.amazonSyncRun.updateMany({
    where: { id: runId, status: "QUEUED" },
    data: { status: "RUNNING", error: null, finishedAt: null },
  });
  if (claimed.count === 0) return;

  const run = await prisma.amazonSyncRun.findUnique({ where: { id: runId } });
  if (!run) return;

  if (run.resource !== "inventory") {
    await prisma.amazonInventorySnapshot.deleteMany({
      where: { syncRunId: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId },
    });
    await prisma.amazonSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        summary: { provider: amazonProvider, externalRequestAttempted: false, reason: "unsupported_resource" },
        error: `Amazon worker 未实现 ${run.resource} 数据域；未向 Amazon 发出请求。`,
        finishedAt: new Date(),
      },
    });
    return;
  }

  try {
    const connection = await prisma.amazonIntegrationConnection.findUnique({
      where: {
        organizationId_workspaceId_provider: {
          organizationId: run.organizationId,
          workspaceId: run.workspaceId,
          provider: amazonProvider,
        },
      },
    });
    if (!connection || connection.status !== "CONFIGURED") throw new Error("Amazon 连接未验证或已停用。");

    assertAmazonSpApiScopeAllowed({ organizationId: run.organizationId, workspaceId: run.workspaceId });
    const marketplaceId = resolveAmazonMarketplaceId(
      // The active workspace identifier must be a real Marketplace ID or match a verified country/domain mapping.
      await workspaceMarketplace(run.organizationId, run.workspaceId),
      extractMarketplaceParticipations({ payload: connection.marketplaceParticipations }),
    );
    const snapshots = await fetchAllInventorySnapshots(new AmazonSpApiClient(getAmazonSpApiServerConfiguration()), marketplaceId);
    const capturedAt = new Date();
    const enabledDomains = Array.isArray(connection.enabledDomains)
      ? connection.enabledDomains.filter((domain): domain is string => typeof domain === "string")
      : [];

    await prisma.$transaction(async (tx) => {
      await tx.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id } });
      for (let offset = 0; offset < snapshots.length; offset += snapshotInsertChunkSize) {
        const chunk = snapshots.slice(offset, offset + snapshotInsertChunkSize).map((snapshot) => ({
          id: `amazon-inventory-${randomUUID()}`,
          organizationId: run.organizationId,
          workspaceId: run.workspaceId,
          syncRunId: run.id,
          marketplaceId,
          ...snapshot,
          capturedAt,
        }));
        await tx.amazonInventorySnapshot.createMany({ data: chunk });
      }
      await tx.amazonSyncRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          summary: { provider: amazonProvider, externalRequestAttempted: true, marketplaceId, snapshotCount: snapshots.length },
          error: null,
          finishedAt: new Date(),
        },
      });
      await tx.amazonIntegrationConnection.update({
        where: { organizationId_workspaceId_provider: { organizationId: run.organizationId, workspaceId: run.workspaceId, provider: amazonProvider } },
        data: {
          enabledDomains: [...new Set([...enabledDomains, "inventory"])],
          lastSyncAt: new Date(),
          statusMessage: `库存同步已完成：${snapshots.length} 条快照。`,
        },
      });
    }, { timeout: 60_000 });
  } catch (error) {
    const message = error instanceof AmazonSpApiError ? error.message : error instanceof Error ? error.message : "Amazon 库存同步失败。";
    await prisma.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id } });
    if (!options.isFinalAttempt && error instanceof AmazonSpApiError && error.retryable) {
      await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { status: "QUEUED", error: message } });
      throw error;
    }
    await prisma.amazonSyncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        summary: { provider: amazonProvider, externalRequestAttempted: error instanceof AmazonSpApiError },
        error: message.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }
}

export async function enqueuePendingAmazonSyncRuns(limit = 50): Promise<string[]> {
  const runs = await prisma.amazonSyncRun.findMany({
    where: { status: "QUEUED", resource: "inventory" },
    select: { id: true },
    orderBy: { startedAt: "asc" },
    take: limit,
  });
  return runs.map((run) => run.id);
}

export async function recoverStaleAmazonSyncRuns(staleAfterMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = await prisma.amazonSyncRun.findMany({
    where: { status: "RUNNING", resource: "inventory", updatedAt: { lt: cutoff } },
    take: 50,
  });
  let count = 0;
  for (const run of stale) {
    count += await withAmazonSyncLock(run, async () => {
      const updated = await prisma.amazonSyncRun.updateMany({
        where: { id: run.id, status: "RUNNING", updatedAt: { lt: cutoff } },
        data: { status: "FAILED", error: "同步 worker 中断；本次运行已终止，请重新同步。", finishedAt: new Date() },
      });
      if (updated.count) await prisma.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id } });
      return updated.count;
    }) ?? 0;
  }
  return count;
}

async function workspaceMarketplace(organizationId: string, workspaceId: string): Promise<string> {
  const workspace = await prisma.workspaceScope.findUnique({
    where: { organizationId_id: { organizationId, id: workspaceId } },
    select: { marketplace: true },
  });
  if (!workspace?.marketplace.trim()) throw new Error("当前工作区未配置 Amazon 站点，无法同步库存。");
  return workspace.marketplace;
}

async function fetchAllInventorySnapshots(client: AmazonSpApiClient, marketplaceId: string) {
  const snapshots = new Map<string, ReturnType<typeof extractAmazonInventorySnapshots>[number]>();
  let nextToken: string | undefined;
  for (let page = 0; page < maxInventoryPages; page += 1) {
    const response = await client.getInventorySummaries({ marketplaceId, nextToken });
    for (const snapshot of extractAmazonInventorySnapshots(response)) {
      snapshots.set(`${snapshot.sellerSku}\u0000${snapshot.condition}`, snapshot);
      if (snapshots.size > maxInventoryRows) throw new Error(`库存同步超过 ${maxInventoryRows} 条安全上限。`);
    }
    nextToken = nextPageToken(response);
    if (!nextToken) return [...snapshots.values()];
  }
  throw new Error(`库存同步超过 ${maxInventoryPages} 页安全上限。`);
}

function nextPageToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const pagination = (value as Record<string, unknown>).pagination;
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) return undefined;
  const token = (pagination as Record<string, unknown>).nextToken;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
