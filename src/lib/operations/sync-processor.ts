import { setTimeout as delay } from "node:timers/promises";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { extractAmazonInventorySnapshots, resolveAmazonMarketplaceId } from "@/lib/amazon/inventory";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { assertAmazonSpApiScopeAllowed, getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";
import { prisma } from "@/lib/db/prisma";
import { extractMarketplaceParticipations } from "./readiness";
import { withAmazonSyncLock } from "./sync-lock";
import { getSellerBindings } from "@/lib/amazon/seller-bindings";
import { extractCatalogPage } from "@/lib/amazon/catalog";

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

  if (run.resource !== "inventory" && run.resource !== "catalog") {
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

  let externalRequestAttempted = false;
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
    const bindings = await getSellerBindings(run.organizationId, run.workspaceId, run.resource);
    if (!bindings.length) throw new Error("当前工作区没有显式配置 Amazon Seller ID、SellerAccount、站点及该同步域授权；accountKey 不会被当作 Seller ID。");
    const participations = extractMarketplaceParticipations({ payload: connection.marketplaceParticipations });
    const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration());
    const capturedAt = new Date();
    const enabledDomains = Array.isArray(connection.enabledDomains)
      ? connection.enabledDomains.filter((domain): domain is string => typeof domain === "string")
      : [];

    const inventoryRows: Prisma.AmazonInventorySnapshotCreateManyInput[] = [];
    const catalogRows: Prisma.AmazonCatalogSnapshotCreateManyInput[] = [];
    const outcomes: Array<{ sellerAccountId: string; marketplaceId: string; count: number }> = [];
    for (const binding of bindings) {
      const marketplaceId = resolveAmazonMarketplaceId(binding.marketplaceId, participations);
      externalRequestAttempted = true;
      if (run.resource === "inventory") {
        const snapshots = await fetchAllInventorySnapshots(client, marketplaceId);
        inventoryRows.push(...snapshots.map((snapshot) => ({
          id: `amazon-inventory-${randomUUID()}`, organizationId: run.organizationId,
          workspaceId: run.workspaceId, syncRunId: run.id, sellerAccountId: binding.sellerAccountId,
          marketplaceId, ...snapshot, capturedAt,
        })));
        outcomes.push({ sellerAccountId: binding.sellerAccountId, marketplaceId, count: snapshots.length });
      } else {
        const rows = await fetchAllCatalogItems(client, binding.amazonSellerId, marketplaceId);
        catalogRows.push(...rows.map((item) => ({
          id: `amazon-catalog-${randomUUID()}`, organizationId: run.organizationId,
          workspaceId: run.workspaceId, sellerAccountId: binding.sellerAccountId, marketplaceId,
          sellerSku: item.sellerSku, asin: item.asin, listingStatus: item.listingStatus,
          fulfillmentType: item.fulfillmentType, sourceRunId: run.id,
          fieldSources: { sellerSku: "Listings Items API", asin: "Listings Items API", listingStatus: "Listings Items API", fulfillmentType: "Listings Items API" },
          capturedAt,
        })));
        outcomes.push({ sellerAccountId: binding.sellerAccountId, marketplaceId, count: rows.length });
      }
      if (inventoryRows.length + catalogRows.length > maxInventoryRows) throw new Error("当前工作区同步超过总行数安全上限。");
    }

    await prisma.$transaction(async (tx) => {
      if (run.resource === "inventory") {
        await tx.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId } });
        for (let offset = 0; offset < inventoryRows.length; offset += snapshotInsertChunkSize) {
          await tx.amazonInventorySnapshot.createMany({ data: inventoryRows.slice(offset, offset + snapshotInsertChunkSize) });
        }
      } else {
        await tx.amazonCatalogSnapshot.deleteMany({ where: { sourceRunId: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId } });
        for (let offset = 0; offset < catalogRows.length; offset += snapshotInsertChunkSize) {
          await tx.amazonCatalogSnapshot.createMany({ data: catalogRows.slice(offset, offset + snapshotInsertChunkSize) });
        }
      }
      await tx.amazonSyncRun.update({
        where: { id: run.id },
        data: {
          status: "SUCCEEDED",
          summary: { provider: amazonProvider, externalRequestAttempted: true, resource: run.resource, outcomes, snapshotCount: outcomes.reduce((total, row) => total + row.count, 0) },
          error: null,
          finishedAt: new Date(),
        },
      });
      await tx.amazonIntegrationConnection.update({
        where: { organizationId_workspaceId_provider: { organizationId: run.organizationId, workspaceId: run.workspaceId, provider: amazonProvider } },
        data: {
          enabledDomains: [...new Set([...enabledDomains, run.resource])],
          lastSyncAt: new Date(),
          statusMessage: `${run.resource === "inventory" ? "库存" : "商品刊登"}同步已完成：${outcomes.reduce((total, row) => total + row.count, 0)} 条快照。`,
        },
      });
    }, { timeout: 60_000 });
  } catch (error) {
    const message = error instanceof AmazonSpApiError ? error.message : error instanceof Error ? error.message : "Amazon 库存同步失败。";
    await prisma.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId } });
    await prisma.amazonCatalogSnapshot.deleteMany({ where: { sourceRunId: run.id, organizationId: run.organizationId, workspaceId: run.workspaceId } });
    if (!options.isFinalAttempt && error instanceof AmazonSpApiError && error.retryable) {
      await prisma.amazonSyncRun.update({ where: { id: run.id }, data: { status: "QUEUED", error: message } });
      throw error;
    }
    await prisma.amazonSyncRun.update({
      where: { id: run.id },
      data: {
        status: externalRequestAttempted ? "FAILED" : "BLOCKED",
        summary: { provider: amazonProvider, externalRequestAttempted },
        error: message.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }
}

export async function enqueuePendingAmazonSyncRuns(limit = 50): Promise<string[]> {
  const runs = await prisma.amazonSyncRun.findMany({
    where: { status: "QUEUED", resource: { in: ["inventory", "catalog"] } },
    select: { id: true },
    orderBy: { startedAt: "asc" },
    take: limit,
  });
  return runs.map((run) => run.id);
}

export async function recoverStaleAmazonSyncRuns(staleAfterMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const stale = await prisma.amazonSyncRun.findMany({
    where: { status: "RUNNING", resource: { in: ["inventory", "catalog"] }, updatedAt: { lt: cutoff } },
    take: 50,
  });
  let count = 0;
  for (const run of stale) {
    count += await withAmazonSyncLock(run, async () => {
      const updated = await prisma.amazonSyncRun.updateMany({
        where: { id: run.id, status: "RUNNING", updatedAt: { lt: cutoff } },
        data: { status: "FAILED", error: "同步 worker 中断；本次运行已终止，请重新同步。", finishedAt: new Date() },
      });
      if (updated.count) {
        await prisma.amazonInventorySnapshot.deleteMany({ where: { syncRunId: run.id } });
        await prisma.amazonCatalogSnapshot.deleteMany({ where: { sourceRunId: run.id } });
      }
      return updated.count;
    }) ?? 0;
  }
  return count;
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
    await delay(600);
  }
  throw new Error(`库存同步超过 ${maxInventoryPages} 页安全上限。`);
}

async function fetchAllCatalogItems(client: AmazonSpApiClient, sellerId: string, marketplaceId: string) {
  const rows = new Map<string, ReturnType<typeof extractCatalogPage>["items"][number]>();
  let nextToken: string | undefined;
  for (let page = 0; page < maxInventoryPages; page += 1) {
    const result = extractCatalogPage(await client.searchListingsItems({ sellerId, marketplaceId, nextToken }), marketplaceId);
    for (const row of result.items) rows.set(row.sellerSku, row);
    if (rows.size > maxInventoryRows) throw new Error(`刊登同步超过 ${maxInventoryRows} 条安全上限。`);
    nextToken = result.nextToken;
    if (!nextToken) return [...rows.values()];
    await delay(600);
  }
  throw new Error(`刊登同步超过 ${maxInventoryPages} 页安全上限。`);
}

function nextPageToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const pagination = (value as Record<string, unknown>).pagination;
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) return undefined;
  const token = (pagination as Record<string, unknown>).nextToken;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}
