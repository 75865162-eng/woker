import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getProductEditRestriction, type ProductEditUser } from "@/lib/products/product-edit-access";
import { buildProductRecordIndex } from "@/lib/products/product-record-index";
import type { Product } from "@/lib/products/types";
import { sellfoxPost } from "@/lib/sellfox/client";
import { prisma } from "@/lib/db/prisma";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";
import { workspaceScopeFromRequest, type WorkspaceScopeInput } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type RecordLike = Record<string, unknown>;
type SyncResource = "stores" | "products" | "hourly" | "performance";

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}

function text(record: RecordLike, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function number(record: RecordLike, ...keys: string[]) {
  const value = Number(text(record, ...keys));
  return Number.isFinite(value) ? value : 0;
}

function recordsFrom(payload: unknown): RecordLike[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((value): value is RecordLike => Boolean(value));
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["records", "list", "rows", "itemList", "data", "result"]) {
    if (Array.isArray(record[key])) return record[key].map(asRecord).filter((value): value is RecordLike => Boolean(value));
    const nested = asRecord(record[key]);
    if (nested) {
      const rows = recordsFrom(nested);
      if (rows.length) return rows;
    }
  }
  return [];
}

function productFromSellfox(record: RecordLike): Product | null {
  const sku = text(record, "sku", "msku", "sellerSku", "merchantSku");
  if (!sku) return null;
  const now = new Date().toISOString();
  return {
    id: `sellfox-${sku}`,
    sku,
    chineseName: text(record, "commodityName", "productName", "name"),
    englishName: text(record, "title", "productTitle", "name"),
    asin: text(record, "asin", "childAsin"),
    developer: text(record, "developer", "developerName"),
    purchasePrice: number(record, "purchasePrice", "cost"),
    status: text(record, "onlineStatus", "status") === "active" ? "listed" : "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: text(record, "createTime", "createdAt") || now,
    keywords: "",
    note: "由赛狐在线产品 API 只读同步。",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: [],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
  };
}

async function syncStores(organizationId: string, workspaceId: string) {
  const payload = await sellfoxPost<unknown>("/api/shop/pageList.json", { pageNo: 1, pageSize: 100 });
  const rows = recordsFrom(payload);
  let synced = 0;
  for (const row of rows) {
    const externalId = text(row, "shopId", "id", "storeId");
    if (!externalId) continue;
    await prisma.sellfoxStore.upsert({
      where: { organizationId_workspaceId_externalId: { organizationId, workspaceId, externalId } },
      create: {
        organizationId, workspaceId, externalId,
        name: text(row, "shopName", "name", "storeName"),
        marketplace: text(row, "marketplace", "marketplaceName", "marketplaceId"),
        country: text(row, "country", "countryName"),
        status: text(row, "status", "shopStatus"),
        payload: row as Prisma.InputJsonValue,
      },
      update: {
        name: text(row, "shopName", "name", "storeName"), marketplace: text(row, "marketplace", "marketplaceName", "marketplaceId"),
        country: text(row, "country", "countryName"), status: text(row, "status", "shopStatus"), payload: row as Prisma.InputJsonValue, lastSyncedAt: new Date(),
      },
    });
    synced += 1;
  }
  return synced;
}

async function syncProducts(organizationId: string, userId: string, user: ProductEditUser, scope: WorkspaceScopeInput) {
  let synced = 0;
  const pageSize = 100;

  for (let pageNo = 1; pageNo <= 1_000; pageNo += 1) {
    const payload = await sellfoxPost<unknown>("/api/order/api/product/v2/pageList.json", { pageNo, pageSize, onlineStatusList: ["active"] });
    const rows = recordsFrom(payload);

    for (const row of rows) {
      const product = productFromSellfox(row);
      if (!product) continue;
      const existingRecord = await prisma.productRecord.findUnique({
        where: { organizationId_workspaceId_sku: { organizationId, workspaceId: scope.workspaceId, sku: product.sku } },
      });
      const existingProduct = existingRecord?.payload as unknown as Product | undefined;
      const editRestriction = getProductEditRestriction(existingProduct, product, user, "import_update");

      if (editRestriction) continue;

      const index = buildProductRecordIndex(product);
      await prisma.productRecord.upsert({
        where: { organizationId_workspaceId_sku: { organizationId, workspaceId: scope.workspaceId, sku: product.sku } },
        create: {
          id: product.id,
          organizationId,
          userId,
          workspaceId: scope.workspaceId,
          accountId: scope.accountId,
          marketplace: scope.marketplace,
          sku: product.sku,
          ...index,
          payload: { ...product, sellfoxPayload: row } as Prisma.InputJsonValue,
        },
        update: {
          userId,
          ...(scope.accountId ? { accountId: scope.accountId } : {}),
          ...(scope.marketplace ? { marketplace: scope.marketplace } : {}),
          ...index,
          payload: { ...product, sellfoxPayload: row } as Prisma.InputJsonValue,
        },
      });
      synced += 1;
    }

    if (rows.length < pageSize) break;
  }

  return synced;
}

async function syncHourly(organizationId: string, workspaceId: string, storeOffset: number, storeLimit: number) {
  const stores = await prisma.sellfoxStore.findMany({
    where: { organizationId, workspaceId },
    orderBy: { externalId: "asc" },
    skip: storeOffset,
    take: storeLimit,
  });
  const reportDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  let synced = 0;
  for (const store of stores) {
    const campaigns = recordsFrom(await sellfoxPost<unknown>("/api/cpc/manageData/spCampaign.json", { shopId: store.externalId, pageSize: 100 }));
    for (const campaign of campaigns.slice(0, 5)) {
      const campaignId = text(campaign, "campaignId", "id");
      if (!campaignId) continue;
      const metrics = recordsFrom(await sellfoxPost<unknown>("/api/cpc/hourData/spCampaign.json", { aggregationType: "campaign", shopId: store.externalId, date: reportDate, campaignId }));
      for (const metric of metrics) {
        const hour = Math.min(Math.max(Math.floor(number(metric, "hour", "reportHour", "timeHour")), 0), 23);
        await prisma.sellfoxHourlyMetric.upsert({
          where: { storeId_reportDate_hour_adType_entityType_entityId: { storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId } },
          create: { organizationId, workspaceId, storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId, entityName: text(campaign, "campaignName", "name"), impressions: Math.floor(number(metric, "impressions")), clicks: Math.floor(number(metric, "clicks")), cost: number(metric, "cost", "costs", "spend"), sales: number(metric, "sales", "salesAmount"), orders: Math.floor(number(metric, "orders", "purchases")), payload: metric as Prisma.InputJsonValue },
          update: { impressions: Math.floor(number(metric, "impressions")), clicks: Math.floor(number(metric, "clicks")), cost: number(metric, "cost", "costs", "spend"), sales: number(metric, "sales", "salesAmount"), orders: Math.floor(number(metric, "orders", "purchases")), payload: metric as Prisma.InputJsonValue, syncedAt: new Date() },
        });
        synced += 1;
      }
    }
  }
  return synced;
}

export async function POST(request: Request) {
  const permission = await requireApiPermission(request, "sellfox", "create");
  if (!permission.ok) return permission.response;
  const body = await request.json().catch(() => ({})) as { resource?: SyncResource; storeOffset?: unknown; storeLimit?: unknown; storeExternalId?: unknown; reportDate?: unknown };
  const resource = body.resource;
  if (!resource || !["stores", "products", "hourly", "performance"].includes(resource)) return NextResponse.json({ error: "请选择同步资源。" }, { status: 400 });
  const storeOffset = Math.max(0, Number(body.storeOffset) || 0);
  const storeLimit = Math.min(Math.max(Number(body.storeLimit) || 1, 1), 1);
  const scope = workspaceScopeFromRequest(request);
  const run = await prisma.sellfoxSyncRun.create({ data: { organizationId: permission.user.organizationId, userId: permission.user.id, workspaceId: scope.workspaceId, resource } });
  try {
    const performance = resource === "performance" ? await syncSellfoxProductDailySnapshots({
      organizationId: permission.user.organizationId,
      workspaceId: scope.workspaceId,
      storeExternalId: typeof body.storeExternalId === "string" ? body.storeExternalId : undefined,
      reportDate: typeof body.reportDate === "string" ? body.reportDate : defaultSellfoxReportDate(),
    }) : null;
    const count = performance?.synced ?? (resource === "stores" ? await syncStores(permission.user.organizationId, scope.workspaceId) : resource === "products" ? await syncProducts(permission.user.organizationId, permission.user.id, permission.user, scope) : await syncHourly(permission.user.organizationId, scope.workspaceId, storeOffset, storeLimit));
    const summary = resource === "performance" ? { count, reportDate: performance?.reportDate, storeCount: performance?.storeCount } : resource === "hourly" ? { count, storeOffset, storeLimit } : { count };
    await prisma.sellfoxSyncRun.update({ where: { id: run.id }, data: { status: "done", summary, finishedAt: new Date() } });
    return NextResponse.json({ runId: run.id, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "赛狐同步失败。";
    await prisma.sellfoxSyncRun.update({ where: { id: run.id }, data: { status: "failed", error: message, finishedAt: new Date() } });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
