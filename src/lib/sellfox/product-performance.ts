import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "@/lib/sellfox/client";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
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
}) {
  const reportDate = input.reportDate ?? defaultSellfoxReportDate();
  const stores = await prisma.sellfoxStore.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(input.storeExternalId ? { externalId: input.storeExternalId } : {}) },
    orderBy: { externalId: "asc" },
  });
  let synced = 0;

  for (const store of stores) {
    for (let pageNo = 1; pageNo <= 1_000; pageNo += 1) {
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
        const sourceKey = msku || sku || asin || title;
        if (!sourceKey) continue;

        await prisma.sellfoxProductDailySnapshot.upsert({
          where: { storeId_reportDate_sourceKey: { storeId: store.id, reportDate, sourceKey } },
          create: {
            organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, reportDate, sourceKey,
            sku, msku, asin, parentAsin: text(row, "parentAsinList"), title, currency: text(row, "currency"),
            saleQuantity: Math.round(number(row, "saleNum")), fbaQuantity: Math.round(number(row, "saleNumFba")), fbmQuantity: Math.round(number(row, "saleNumFbm")),
            saleRevenue: number(row, "salePrice"), grossProfit: number(row, "profit"), grossProfitRate: number(row, "profitRate"),
            adCost: number(row, "adTotalCost"), refundRate: number(row, "refundPercent"), payload: row as Prisma.InputJsonValue,
          },
          update: {
            sku, msku, asin, parentAsin: text(row, "parentAsinList"), title, currency: text(row, "currency"),
            saleQuantity: Math.round(number(row, "saleNum")), fbaQuantity: Math.round(number(row, "saleNumFba")), fbmQuantity: Math.round(number(row, "saleNumFbm")),
            saleRevenue: number(row, "salePrice"), grossProfit: number(row, "profit"), grossProfitRate: number(row, "profitRate"),
            adCost: number(row, "adTotalCost"), refundRate: number(row, "refundPercent"), payload: row as Prisma.InputJsonValue, syncedAt: new Date(),
          },
        });
        synced += 1;
      }

      if (rows.length < 100 || (pagination.totalPage !== null && pageNo >= pagination.totalPage) || (pagination.totalSize !== null && pageNo * 100 >= pagination.totalSize)) break;
    }
  }

  return { reportDate, storeCount: stores.length, synced };
}
