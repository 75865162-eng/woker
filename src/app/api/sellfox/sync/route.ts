import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { buildProductRecordIndex } from "@/lib/products/product-record-index";
import { sellfoxPost } from "@/lib/sellfox/client";
import { defaultSellfoxReportDate, syncSellfoxProductDailySnapshots } from "@/lib/sellfox/product-performance";
import { productFromSellfoxApiRow, sellfoxProductUpsertData } from "@/lib/sellfox/product-records";
import { workspaceScopeFromRequest, type WorkspaceScopeInput } from "@/lib/workspace/scope";

export const runtime = "nodejs";

type RecordLike = Record<string, unknown>;
type SyncResource = "stores" | "products" | "hourly" | "performance";

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
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
        id: `sellfox-store-${organizationId}-${workspaceId}-${externalId}`,
        organizationId,
        workspaceId,
        externalId,
        name: text(row, "shopName", "name", "storeName"),
        marketplace: text(row, "marketplace", "marketplaceName", "marketplaceId"),
        country: text(row, "country", "countryName"),
        status: text(row, "status", "shopStatus"),
        payload: row as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
      update: {
        name: text(row, "shopName", "name", "storeName"),
        marketplace: text(row, "marketplace", "marketplaceName", "marketplaceId"),
        country: text(row, "country", "countryName"),
        status: text(row, "status", "shopStatus"),
        payload: row as Prisma.InputJsonValue,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    synced += 1;
  }

  return synced;
}

async function syncProducts(organizationId: string, userId: string, scope: WorkspaceScopeInput) {
  let synced = 0;
  const pageSize = 100;

  for (let pageNo = 1; pageNo <= 1_000; pageNo += 1) {
    const payload = await sellfoxPost<unknown>("/api/order/api/product/v2/pageList.json", { pageNo, pageSize, onlineStatusList: ["active"] });
    const rows = recordsFrom(payload);

    for (const row of rows) {
      const product = productFromSellfoxApiRow(row);
      if (!product) continue;

      const recordData = sellfoxProductUpsertData(product, { id: userId }, scope);
      const index = buildProductRecordIndex(product);
      await prisma.sellfoxProductRecord.upsert({
        where: { organizationId_workspaceId_sku: { organizationId, workspaceId: scope.workspaceId, sku: product.sku } },
        create: {
          id: product.id,
          organizationId,
          sku: product.sku,
          ...recordData,
          ...index,
          payload: { ...product, sellfoxPayload: row } as Prisma.InputJsonValue,
        },
      update: {
        ...recordData,
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
      const metrics = recordsFrom(
        await sellfoxPost<unknown>("/api/cpc/hourData/spCampaign.json", { aggregationType: "campaign", shopId: store.externalId, date: reportDate, campaignId }),
      );
      for (const metric of metrics) {
        const hour = Math.min(Math.max(Math.floor(number(metric, "hour", "reportHour", "timeHour")), 0), 23);
        await prisma.sellfoxHourlyMetric.upsert({
          where: { storeId_reportDate_hour_adType_entityType_entityId: { storeId: store.id, reportDate, hour, adType: "sp", entityType: "campaign", entityId: campaignId } },
          create: {
            id: `sellfox-hourly-${store.id}-${reportDate}-${hour}-sp-campaign-${campaignId}`,
            organizationId,
            workspaceId,
            storeId: store.id,
            reportDate,
            hour,
            adType: "sp",
            entityType: "campaign",
            entityId: campaignId,
            entityName: text(campaign, "campaignName", "name"),
            impressions: Math.floor(number(metric, "impressions")),
            clicks: Math.floor(number(metric, "clicks")),
            cost: number(metric, "cost", "costs", "spend"),
            sales: number(metric, "sales", "salesAmount"),
            orders: Math.floor(number(metric, "orders", "purchases")),
            payload: metric as Prisma.InputJsonValue,
          },
          update: {
            impressions: Math.floor(number(metric, "impressions")),
            clicks: Math.floor(number(metric, "clicks")),
            cost: number(metric, "cost", "costs", "spend"),
            sales: number(metric, "sales", "salesAmount"),
            orders: Math.floor(number(metric, "orders", "purchases")),
            payload: metric as Prisma.InputJsonValue,
            syncedAt: new Date(),
          },
        });
        synced += 1;
      }
    }
  }

  return synced;
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("products", "create", request);
  if (!permission.ok) return permission.response;

  const body = (await request.json().catch(() => ({}))) as { resource?: SyncResource; storeOffset?: unknown; storeLimit?: unknown; storeExternalId?: unknown; reportDate?: unknown };
  const resource = body.resource;
  if (!resource || !["stores", "products", "hourly", "performance"].includes(resource)) {
    return NextResponse.json({ error: "请选择同步资源。" }, { status: 400 });
  }

  const storeOffset = Math.max(0, Number(body.storeOffset) || 0);
  const storeLimit = Math.min(Math.max(Number(body.storeLimit) || 1, 1), 1);
  const scope = workspaceScopeFromRequest(request);
  const run = await prisma.sellfoxSyncRun.create({
    data: {
      id: `sellfox-sync-${permission.user.organizationId}-${scope.workspaceId}-${resource}-${Date.now()}`,
      organizationId: permission.user.organizationId,
      userId: permission.user.id,
      workspaceId: scope.workspaceId,
      resource,
    },
  });

  try {
    const performance =
      resource === "performance"
        ? await syncSellfoxProductDailySnapshots({
            organizationId: permission.user.organizationId,
            workspaceId: scope.workspaceId,
            storeExternalId: typeof body.storeExternalId === "string" ? body.storeExternalId : undefined,
            reportDate: typeof body.reportDate === "string" ? body.reportDate : defaultSellfoxReportDate(),
          })
        : null;
    const count =
      performance?.synced ??
      (resource === "stores"
        ? await syncStores(permission.user.organizationId, scope.workspaceId)
        : resource === "products"
          ? await syncProducts(permission.user.organizationId, permission.user.id, scope)
          : await syncHourly(permission.user.organizationId, scope.workspaceId, storeOffset, storeLimit));
    const summary = resource === "performance" ? { count, reportDate: performance?.reportDate, storeCount: performance?.storeCount } : resource === "hourly" ? { count, storeOffset, storeLimit } : { count };
    await prisma.sellfoxSyncRun.update({ where: { id: run.id }, data: { status: "done", summary, finishedAt: new Date() } });
    return NextResponse.json({ runId: run.id, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "赛狐同步失败。";
    await prisma.sellfoxSyncRun.update({ where: { id: run.id }, data: { status: "failed", error: message, finishedAt: new Date() } });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
