/**
 * Local-only proof of the Sellfox narrow-table write path.
 * Uses tests/fixtures/sellfox pages and the same sync functions as the worker.
 * Does not call OpenAPI and does not enable schedules.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { syncSellfoxListings } from "@/lib/sellfox/listing-sync";
import { syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";
import { isSellfoxScheduleDue, nextSellfoxScheduleAt } from "@/lib/sellfox/schedule-time";
import { syncSellfoxSnapshotStores } from "@/lib/sellfox/snapshot-sync";

const shopExternalId = "shop-fixture";
const reportDate = "2026-10-24";
const capturedAt = "2026-10-28T12:00:00.000Z";
const workspaceId = "default";

function loadJson(name: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/sellfox", name), "utf8")) as Record<string, unknown>;
}

function ordersPage() {
  const page = loadJson("sales-volume-page.json");
  const rows = page.rows as Array<Record<string, unknown>>;
  const days = rows[0].productSaleDayOpenVo as Array<Record<string, unknown>>;
  days[0] = { ...days[0], orderNum: 1 };
  return page;
}

function performancePage() {
  const fees = loadJson("performance-ad-channel-costs.json").insert as Record<string, unknown>;
  return {
    pageNo: 1,
    pageSize: 100,
    totalPage: 1,
    totalSize: 1,
    rows: [{
      mskuList: ["MSKU-FIXTURE"],
      skuList: ["SKU-FIXTURE"],
      asinList: ["ASIN-FIXTURE"],
      parentAsinList: ["PARENT-FIXTURE"],
      title: "Fixture title",
      currency: "USD",
      saleNum: 2,
      saleNumFba: 2,
      saleNumFbm: 0,
      salePrice: 19.99,
      salesPriceNet: 18.5,
      profit: 4.2,
      profitRate: 0.21,
      adTotalCost: 1,
      orderNum: 1,
      refundNum: 0,
      refundPrice: 0,
      ...fees,
    }],
  };
}

async function fixturePost<T>(requestPath: string, body: unknown, _options?: { retry?: boolean }): Promise<T> {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (requestPath === "/api/inventoryManage/fba/pageList.json") return loadJson("inventory-page.json") as T;
  if (requestPath === "/api/productSale/page.json") {
    if (record.type === "productNum") return loadJson("sales-volume-page.json") as T;
    if (record.type === "salePrice") return loadJson("sales-revenue-page.json") as T;
    if (record.type === "orderNum") return ordersPage() as T;
  }
  if (requestPath === "/api/order/api/product/v2/pageList.json") return loadJson("listing-page.json") as T;
  if (requestPath === "/api/sale/profit/product/pageList.json") return performancePage() as T;
  throw new Error(`fixture pipeline 未覆盖 ${requestPath}`);
}

async function main() {
  const credentialsConfigured = Boolean(process.env.SELLFOX_CLIENT_ID && process.env.SELLFOX_CLIENT_SECRET);
  const probe = { skipped: true, reason: "live OpenAPI paused until the Grok Bot whitelist pull" };
  const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!organization || !user) throw new Error("需要先运行 npm run db:seed-admin。");

  await prisma.workspaceScope.upsert({
    where: { organizationId_id: { organizationId: organization.id, id: workspaceId } },
    create: { organizationId: organization.id, id: workspaceId, name: "默认工作区", isDefault: true, updatedAt: new Date() },
    update: { name: "默认工作区", isDefault: true },
  });

  const store = await prisma.sellfoxStore.upsert({
    where: { organizationId_workspaceId_externalId: { organizationId: organization.id, workspaceId, externalId: shopExternalId } },
    create: {
      id: "sellfox-fixture-store",
      organizationId: organization.id,
      workspaceId,
      externalId: shopExternalId,
      name: "Fixture 演示店",
      marketplace: "ATVPDKIKX0DER",
      country: "US",
      status: "active",
      payload: { source: "tests/fixtures/sellfox", live: false },
      updatedAt: new Date(),
    },
    update: {
      name: "Fixture 演示店",
      marketplace: "ATVPDKIKX0DER",
      country: "US",
      status: "active",
      payload: { source: "tests/fixtures/sellfox", live: false },
    },
  });

  const scope = { organizationId: organization.id, workspaceId, shopExternalIds: [shopExternalId], capturedAt };
  const sales = await syncSellfoxSnapshotStores({
    ...scope,
    resource: "sales",
    reportDate,
    onProgress: async () => undefined,
  }, { db: prisma, post: fixturePost });
  const inventory = await syncSellfoxSnapshotStores({
    ...scope,
    resource: "inventory",
    reportDate,
    onProgress: async () => undefined,
  }, { db: prisma, post: fixturePost });
  const listings = await syncSellfoxListings({
    ...scope,
    onProgress: async () => undefined,
  }, { db: prisma, post: fixturePost });
  const secondPost = async <T>(requestPath: string, body: unknown, _options?: { retry?: boolean }): Promise<T> => {
    const page = await fixturePost<{ rows?: Array<Record<string, unknown>> }>(requestPath, body);
    const rows = (page.rows ?? []).map((row) => {
      const next = { ...row };
      if (Array.isArray(next.mskus)) next.mskus = ["MSKU-FIXTURE-2"];
      if (Array.isArray(next.asins)) next.asins = ["ASIN-FIXTURE-2"];
      if (Array.isArray(next.skus)) next.skus = ["SKU-FIXTURE-2"];
      if (Array.isArray(next.mskuList)) next.mskuList = ["MSKU-FIXTURE-2"];
      if (Array.isArray(next.skuList)) next.skuList = ["SKU-FIXTURE-2"];
      if (Array.isArray(next.asinList)) next.asinList = ["ASIN-FIXTURE-2"];
      if (next.id === "listing-fixture" || next.id === "inventory-fixture") next.id = `${next.id}-2`;
      if (typeof next.asin === "string") next.asin = "ASIN-FIXTURE-2";
      if (typeof next.sku === "string" && next.sku === "MSKU-FIXTURE") next.sku = "MSKU-FIXTURE-2";
      if (typeof next.commoditySku === "string") next.commoditySku = "SKU-FIXTURE-2";
      if (typeof next.title === "string") next.title = "Fixture title 2";
      return next;
    });
    return { ...page, rows } as T;
  };
  await syncSellfoxSnapshotStores({
    ...scope, resource: "sales", reportDate, onProgress: async () => undefined,
  }, { db: prisma, post: secondPost });
  await syncSellfoxSnapshotStores({
    ...scope, resource: "inventory", reportDate, onProgress: async () => undefined,
  }, { db: prisma, post: secondPost });
  await syncSellfoxListings({ ...scope, onProgress: async () => undefined }, { db: prisma, post: secondPost });
  await syncSellfoxProductDailySnapshots({
    organizationId: organization.id, workspaceId, storeExternalIds: [shopExternalId], reportDate, onlySettle: false, capturedAt, onProgress: async () => undefined,
  }, { db: prisma, post: secondPost });
  for (const item of [
    { productId: "fixture-product", asin: "ASIN-FIXTURE", msku: "MSKU-FIXTURE", impressions: 120, clicks: 6, cost: 1.5, adOrders: 1, adSales: 19.99 },
    { productId: "fixture-product-2", asin: "ASIN-FIXTURE-2", msku: "MSKU-FIXTURE-2", impressions: 40, clicks: 1, cost: 0.4, adOrders: 0, adSales: 0 },
  ]) {
    await prisma.sellfoxAdsProductDaily.upsert({
      where: { storeId_reportDate_adType_campaignId_adGroupId_productId: { storeId: store.id, reportDate, adType: "sp", campaignId: "fixture-campaign", adGroupId: "fixture-group", productId: item.productId } },
      create: { id: `sellfox-fixture-ads-${item.productId}`, organizationId: organization.id, workspaceId, storeId: store.id, reportDate, adType: "sp", campaignId: "fixture-campaign", adGroupId: "fixture-group", currency: "USD", payload: { source: "fixture", live: false }, syncedAt: new Date(capturedAt), ...item },
      update: { asin: item.asin, msku: item.msku, impressions: item.impressions, clicks: item.clicks, cost: item.cost, adOrders: item.adOrders, adSales: item.adSales, currency: "USD", payload: { source: "fixture", live: false } },
    });
  }

  const performance = await syncSellfoxProductDailySnapshots({
    organizationId: organization.id,
    workspaceId,
    storeExternalIds: [shopExternalId],
    reportDate,
    onlySettle: false,
    capturedAt,
    onProgress: async () => undefined,
  }, { db: prisma, post: fixturePost });

  const scheduleClock = { resource: "sales", intervalMinutes: 1440, lastEnqueuedAt: null };
  const scheduleDue = isSellfoxScheduleDue(scheduleClock);
  const nextRunAt = nextSellfoxScheduleAt(scheduleClock).toISOString();
  await prisma.sellfoxSyncSchedule.upsert({
    where: { organizationId_workspaceId_resource: { organizationId: organization.id, workspaceId, resource: "sales" } },
    create: {
      id: "sellfox-fixture-schedule-sales",
      organizationId: organization.id,
      workspaceId,
      userId: user.id,
      resource: "sales",
      enabled: false,
      intervalMinutes: 1440,
    },
    update: { enabled: false, userId: user.id },
  });
  await prisma.sellfoxSyncSchedule.updateMany({ where: { organizationId: organization.id, workspaceId }, data: { enabled: false } });
  await prisma.sellfoxSyncRun.upsert({
    where: { id: "sellfox-fixture-schedule-replay" },
    create: {
      id: "sellfox-fixture-schedule-replay",
      organizationId: organization.id,
      workspaceId,
      userId: user.id,
      resource: "sales",
      status: "done",
      summary: {
        trigger: "schedule",
        source: "fixture-pipeline",
        liveOpenApi: false,
        credentialsConfigured,
        openApiProbe: probe,
        scheduleWouldBeDue: scheduleDue,
        nextRunAt,
        reportDate,
        shopExternalIds: [shopExternalId],
        note: "未调用 OpenAPI。演示行只用于 /sellfox 界面验收，计划保持关闭。",
      },
      finishedAt: new Date(),
    },
    update: {
      status: "done",
      error: null,
      summary: {
        trigger: "schedule",
        source: "fixture-pipeline",
        liveOpenApi: false,
        credentialsConfigured,
        openApiProbe: probe,
        scheduleWouldBeDue: scheduleDue,
        nextRunAt,
        reportDate,
        shopExternalIds: [shopExternalId],
        note: "未调用 OpenAPI。演示行只用于 /sellfox 界面验收，计划保持关闭。",
      },
      finishedAt: new Date(),
    },
  });

  const [salesRows, inventoryRows, listingRows, performanceRows, adsRows, enabledSchedules] = await Promise.all([
    prisma.sellfoxSalesDailySnapshot.count({ where: { storeId: store.id } }),
    prisma.sellfoxFbaInventorySnapshot.count({ where: { storeId: store.id } }),
    prisma.sellfoxListingSnapshot.count({ where: { storeId: store.id } }),
    prisma.sellfoxProductDailySnapshot.count({ where: { storeId: store.id } }),
    prisma.sellfoxAdsProductDaily.count({ where: { storeId: store.id } }),
    prisma.sellfoxSyncSchedule.count({ where: { organizationId: organization.id, workspaceId, enabled: true } }),
  ]);
  console.log(JSON.stringify({
    credentialsConfigured,
    openApiProbe: probe,
    scheduleWouldBeDue: scheduleDue,
    nextRunAt,
    scheduleEnabled: false,
    writes: { sales, inventory, listings, performance },
    enabledSchedules,
    rows: { salesRows, inventoryRows, listingRows, performanceRows, adsRows },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
