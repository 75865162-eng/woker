import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "@/lib/sellfox/client";
import { nextSellfoxPage } from "@/lib/sellfox/sync-contract";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function rowsFrom(value: unknown) {
  const record = asRecord(value);
  const rows = record?.rows;
  return Array.isArray(rows) ? rows.map(asRecord).filter((row): row is RecordLike => Boolean(row)) : [];
}

function paginationFrom(value: unknown) {
  const record = asRecord(value);
  const totalPage = Number(record?.totalPage);
  const totalSize = Number(record?.totalSize);
  return {
    totalPage: Number.isFinite(totalPage) && totalPage > 0 ? Math.floor(totalPage) : null,
    totalSize: Number.isFinite(totalSize) && totalSize >= 0 ? Math.floor(totalSize) : null,
  };
}

function text(row: RecordLike, key: string) {
  const value = row[key];
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(",");
  return value === undefined || value === null ? "" : String(value).trim();
}

function number(row: RecordLike, key: string) {
  const value = Number(text(row, key));
  return Number.isFinite(value) ? value : 0;
}

export function defaultSellfoxReportDate() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function syncSellfoxProductDailySnapshots(input: {
  organizationId: string;
  workspaceId: string;
  reportDate?: string;
  storeExternalId?: string;
  storeExternalIds?: string[];
  cursor?: { storeIndex?: number; pageNo?: number };
  onProgress?: (progress: { storeIndex: number; pageNo: number; synced: number; cursor: { storeIndex: number; pageNo: number }; failedStores?: string[] }) => Promise<void>;
}) {
  const reportDate = input.reportDate ?? defaultSellfoxReportDate();
  const storeExternalIds = input.storeExternalIds?.length ? input.storeExternalIds : input.storeExternalId ? [input.storeExternalId] : undefined;
  const stores = await prisma.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(storeExternalIds ? { externalId: { in: storeExternalIds } } : {}) },
    orderBy: { externalId: "asc" },
  });
  let synced = 0;
  const failedStores: string[] = [];
  let firstFailedCursor: { storeIndex: number; pageNo: number } | null = null;

  const startStoreIndex = Math.max(0, input.cursor?.storeIndex ?? 0);
  for (let storeIndex = startStoreIndex; storeIndex < stores.length; storeIndex += 1) {
    const store = stores[storeIndex];
    const startPageNo = storeIndex === startStoreIndex ? Math.max(1, input.cursor?.pageNo ?? 1) : 1;
    let currentPageNo = startPageNo;
    try {
    for (let pageNo = startPageNo; pageNo <= 10_000; pageNo += 1) {
      currentPageNo = pageNo;
      const payload = await sellfoxPost<unknown>("/api/sale/profit/product/pageList.json", {
        pageNo,
        pageSize: 100,
        shopIdList: [store.externalId],
        startDate: reportDate,
        endDate: reportDate,
        type: "msku",
        currency: "",
      });
      const rows = rowsFrom(payload);
      const pagination = paginationFrom(payload);

      for (const row of rows) {
        const msku = text(row, "mskuList");
        const sku = text(row, "skuList");
        const asin = text(row, "asinList");
        const title = text(row, "title");
        const sourceKey = msku || sku || asin;
        if (!sourceKey) continue;

        await prisma.sellfoxProductDailySnapshot.upsert({
          where: { storeId_reportDate_sourceKey: { storeId: store.id, reportDate, sourceKey } },
          create: {
            id: `sellfox-product-daily-${store.id}-${reportDate}-${sourceKey}`,
            organizationId: input.organizationId,
            workspaceId: input.workspaceId,
            storeId: store.id,
            reportDate,
            sourceKey,
            sku,
            msku,
            asin,
            parentAsin: text(row, "parentAsinList"),
            title,
            currency: text(row, "currency"),
            saleQuantity: Math.round(number(row, "saleNum")),
            fbaQuantity: Math.round(number(row, "saleNumFba")),
            fbmQuantity: Math.round(number(row, "saleNumFbm")),
            saleRevenue: number(row, "salePrice"),
            grossProfit: number(row, "profit"),
            grossProfitRate: number(row, "profitRate"),
            adCost: number(row, "adTotalCost"),
            refundRate: number(row, "refundPercent"),
            payload: row as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
          update: {
            sku,
            msku,
            asin,
            parentAsin: text(row, "parentAsinList"),
            title,
            currency: text(row, "currency"),
            saleQuantity: Math.round(number(row, "saleNum")),
            fbaQuantity: Math.round(number(row, "saleNumFba")),
            fbmQuantity: Math.round(number(row, "saleNumFbm")),
            saleRevenue: number(row, "salePrice"),
            grossProfit: number(row, "profit"),
            grossProfitRate: number(row, "profitRate"),
            adCost: number(row, "adTotalCost"),
            refundRate: number(row, "refundPercent"),
            payload: row as Prisma.InputJsonValue,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        synced += 1;
      }

      const nextPage = nextSellfoxPage(rows.length, pageNo, pagination.totalPage ?? (pagination.totalSize === null ? null : Math.ceil(pagination.totalSize / 100)));
      const cursor = nextPage === null ? { storeIndex: storeIndex + 1, pageNo: 1 } : { storeIndex, pageNo: nextPage };
      await input.onProgress?.({ storeIndex, pageNo, synced, cursor });
      if (nextPage === null) break;
    }
    } catch {
      failedStores.push(store.externalId);
      firstFailedCursor ??= { storeIndex, pageNo: currentPageNo };
    }
  }

  if (failedStores.length) {
    const cursor = firstFailedCursor ?? { storeIndex: startStoreIndex, pageNo: 1 };
    await input.onProgress?.({ ...cursor, synced, cursor, failedStores });
    throw new Error(`${failedStores.length} 个店铺产品表现同步失败，已继续处理其他店铺。`);
  }
  return { reportDate, storeCount: stores.length, synced, failedStores };
}
