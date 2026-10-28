/**
 * BOX-LOCAL ONLY: seed workspace + TK店-US store, import sales (~30d from from-123 matrix),
 * performance (CSV days available), listings/inventory current snapshots.
 * Remaps foreign organizationId to local seeded org. No push/deploy/SSH.
 */
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const WORKSPACE_ID = "default";
const SHOP_EXTERNAL_ID = "124687";
const SHOP_NAME = "TK店-US";
const MARKETPLACE = "ATVPDKIKX0DER";
const WINDOW_START = "2026-09-29";
const WINDOW_END = "2026-10-28"; // T-1 from 2026-10-29
const CAPTURED_AT = new Date("2026-10-28T16:00:00.000Z");

function primaryMsku(mskuCell, skuCell) {
  const sku = String(skuCell ?? "").trim();
  if (sku) return sku;
  const parts = String(mskuCell ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const plain = parts.find((p) => !p.startsWith("amzn.gr."));
  return plain || parts[0] || "";
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

async function ensureWorkspace(orgId) {
  await prisma.workspaceScope.upsert({
    where: { organizationId_id: { organizationId: orgId, id: WORKSPACE_ID } },
    update: { name: "默认工作区", isDefault: true },
    create: { organizationId: orgId, id: WORKSPACE_ID, name: "默认工作区", isDefault: true },
  });
}

async function ensureStore(orgId) {
  const id = `sellfox-store-${orgId}-${WORKSPACE_ID}-${SHOP_EXTERNAL_ID}`;
  await prisma.sellfoxStore.upsert({
    where: { id },
    update: {
      name: SHOP_NAME,
      marketplace: MARKETPLACE,
      country: "US",
      status: "active",
      payload: { externalId: SHOP_EXTERNAL_ID, name: SHOP_NAME, marketplace: MARKETPLACE, importSource: "from-123+exports" },
      lastSyncedAt: CAPTURED_AT,
      updatedAt: new Date(),
    },
    create: {
      id,
      organizationId: orgId,
      workspaceId: WORKSPACE_ID,
      externalId: SHOP_EXTERNAL_ID,
      name: SHOP_NAME,
      marketplace: MARKETPLACE,
      country: "US",
      status: "active",
      payload: { externalId: SHOP_EXTERNAL_ID, name: SHOP_NAME, marketplace: MARKETPLACE, importSource: "from-123+exports" },
      lastSyncedAt: CAPTURED_AT,
      updatedAt: new Date(),
    },
  });
  return id;
}

function loadMatrixSheets(xlsxPath) {
  // Use exceljs via dynamic? Prefer python-written JSON for reliability with chinese sheets.
  // This function expects pre-extracted JSON beside the xlsx.
  const jsonPath = xlsxPath.replace(/\.xlsx$/i, `.window-${WINDOW_START}_${WINDOW_END}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`Missing extracted JSON: ${jsonPath}`);
  return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

async function importSales(orgId, storeId, matrix) {
  // matrix: { dates: string[], rows: [{asin,sku,msku,quantity:{},revenue:{},orders:{}}] }
  const syncedAt = CAPTURED_AT;
  let writes = 0;
  const dayWrites = new Map();
  const batch = [];
  for (const row of matrix.rows) {
    const sourceKey = primaryMsku(row.msku, row.sku);
    if (!sourceKey) continue;
    const asin = String(row.asin || "");
    const sku = String(row.sku || sourceKey);
    for (const date of matrix.dates) {
      if (date < WINDOW_START || date > WINDOW_END) continue;
      const quantity = num(row.quantity?.[date]);
      const revenue = num(row.revenue?.[date]);
      const orders = int(row.orders?.[date]);
      if (quantity == null && revenue == null && orders == null) continue;
      if ((quantity ?? 0) === 0 && (revenue ?? 0) === 0 && (orders ?? 0) === 0) {
        // keep zeros that are explicitly present as they matter for hideZero filters
      }
      const id = `sellfox-sales-${storeId}-${date}-${sourceKey}`;
      batch.push({
        id,
        organizationId: orgId,
        workspaceId: WORKSPACE_ID,
        storeId,
        sourceKey,
        reportDate: date,
        asin,
        msku: sourceKey,
        sku,
        quantity: quantity == null ? null : Math.trunc(quantity),
        revenue,
        orders,
        currency: "USD",
        payload: { importSource: "from-123-matrix", productNum: quantity, salePrice: revenue, orderNum: orders },
        syncedAt,
        updatedAt: new Date(),
      });
      dayWrites.set(date, (dayWrites.get(date) || 0) + 1);
      if (batch.length >= 500) {
        await upsertSalesBatch(batch);
        writes += batch.length;
        batch.length = 0;
      }
    }
  }
  if (batch.length) {
    await upsertSalesBatch(batch);
    writes += batch.length;
  }
  for (const [reportDate, rowWrites] of dayWrites) {
    await prisma.sellfoxSalesDayCoverage.upsert({
      where: { storeId_reportDate: { storeId, reportDate } },
      update: { capturedAt: syncedAt, rowWrites },
      create: { storeId, reportDate, capturedAt: syncedAt, rowWrites },
    });
  }
  return { writes, days: dayWrites.size };
}

async function upsertSalesBatch(rows) {
  await prisma.$transaction(
    rows.map((data) =>
      prisma.sellfoxSalesDailySnapshot.upsert({
        where: { storeId_reportDate_sourceKey: { storeId: data.storeId, reportDate: data.reportDate, sourceKey: data.sourceKey } },
        update: {
          asin: data.asin,
          msku: data.msku,
          sku: data.sku,
          quantity: data.quantity,
          revenue: data.revenue,
          orders: data.orders,
          currency: data.currency,
          payload: data.payload,
          syncedAt: data.syncedAt,
          updatedAt: data.updatedAt,
          organizationId: data.organizationId,
          workspaceId: data.workspaceId,
        },
        create: data,
      }),
    ),
  );
}

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true });
}

async function importPerformanceCsv(orgId, storeId, csvPath) {
  const rows = parseCsv(csvPath);
  let writes = 0;
  for (const row of rows) {
    const reportDate = row.reportDate;
    if (!reportDate || reportDate < WINDOW_START || reportDate > WINDOW_END) continue;
    if (row.shopExternalId && row.shopExternalId !== SHOP_EXTERNAL_ID && row.name !== SHOP_NAME) continue;
    const sourceKey = primaryMsku(row.msku || row.sourceKey, row.sku);
    if (!sourceKey) continue;
    const id = `sellfox-product-daily-${storeId}-${reportDate}-${sourceKey}`;
    const data = {
      id,
      organizationId: orgId,
      workspaceId: WORKSPACE_ID,
      storeId,
      sourceKey,
      reportDate,
      onlySettle: false,
      sku: String(row.sku || sourceKey),
      msku: sourceKey,
      asin: String(row.asin || ""),
      parentAsin: "",
      title: String(row.title || ""),
      currency: String(row.currency || "USD"),
      orderNum: int(row.orderNum),
      netRevenue: num(row.netRevenue),
      saleQuantity: int(row.saleQuantity),
      saleRevenue: num(row.saleRevenue),
      grossProfit: num(row.grossProfit),
      grossProfitRate: num(row.grossProfitRate),
      adCost: num(row.adCost),
      refundRate: num(row.refundRate),
      payload: { importSource: "export-csv-2026-10-26", ...row },
      syncedAt: CAPTURED_AT,
      updatedAt: new Date(),
    };
    await prisma.sellfoxProductDailySnapshot.upsert({
      where: {
        storeId_reportDate_sourceKey_onlySettle: {
          storeId,
          reportDate,
          sourceKey,
          onlySettle: false,
        },
      },
      update: data,
      create: data,
    });
    writes++;
  }
  return writes;
}

async function importListings(orgId, storeId, csvPath) {
  const rows = parseCsv(csvPath);
  let writes = 0;
  for (const row of rows) {
    if (row.shopExternalId && row.shopExternalId !== SHOP_EXTERNAL_ID) continue;
    const sourceKey = primaryMsku(row.msku || row.sourceKey, row.sku);
    if (!sourceKey) continue;
    const id = `sellfox-listing-${storeId}-${sourceKey}`;
    const data = {
      id,
      organizationId: orgId,
      workspaceId: WORKSPACE_ID,
      storeId,
      sourceKey,
      capturedAt: CAPTURED_AT,
      asin: String(row.asin || ""),
      msku: sourceKey,
      sku: String(row.sku || sourceKey),
      fnsku: row.fnsku || null,
      parentSku: row.parentSku || null,
      mainImage: row.mainImage || null,
      parentAsin: row.parentAsin || null,
      title: row.title || null,
      status: row.status || null,
      price: num(row.price),
      currency: row.currency || "USD",
      fulfillable: int(row.fulfillable),
      sales7: int(row.sales7),
      sales14: int(row.sales14),
      sales30: int(row.sales30),
      revenue7: num(row.revenue7),
      revenue14: num(row.revenue14),
      revenue30: num(row.revenue30),
      adSpend7: num(row.adSpend7),
      adSpend14: num(row.adSpend14),
      adSpend30: num(row.adSpend30),
      sourceUpdatedAt: row.sourceUpdatedAt || null,
      brand: row.brand || null,
      payload: { importSource: "listings-csv" },
    };
    await prisma.sellfoxListingSnapshot.upsert({
      where: { storeId_capturedAt_sourceKey: { storeId, capturedAt: CAPTURED_AT, sourceKey } },
      update: data,
      create: data,
    });
    writes++;
  }
  await prisma.sellfoxSnapshotHead.upsert({
    where: { storeId_resource: { storeId, resource: "listings" } },
    update: { capturedAt: CAPTURED_AT },
    create: { storeId, resource: "listings", capturedAt: CAPTURED_AT },
  });
  return writes;
}

async function importInventory(orgId, storeId, csvPath) {
  const rows = parseCsv(csvPath);
  let writes = 0;
  const reportDate = "2026-10-28";
  for (const row of rows) {
    if (row.shopExternalId && row.shopExternalId !== SHOP_EXTERNAL_ID) continue;
    const sourceKey = primaryMsku(row.msku || row.sourceKey, row.sku);
    if (!sourceKey) continue;
    const id = `sellfox-inv-${storeId}-${sourceKey}`;
    const data = {
      id,
      organizationId: orgId,
      workspaceId: WORKSPACE_ID,
      storeId,
      reportDate,
      capturedAt: CAPTURED_AT,
      sourceKey,
      sku: String(row.sku || sourceKey),
      msku: sourceKey,
      asin: String(row.asin || ""),
      fnsku: String(row.fnsku || ""),
      quantity: int(row.quantity),
      totalInventory: int(row.totalInventory),
      inTransit: int(row.inTransit),
      inboundWorking: int(row.inboundWorking),
      inboundShipped: int(row.inboundShipped),
      inboundReceiving: int(row.inboundReceiving),
      reservedTransfer: int(row.reservedTransfer),
      reservedProcessing: int(row.reservedProcessing),
      reservedCustomerorders: int(row.reservedCustomerorders),
      unfulfillable: int(row.unfulfillable),
      warehouseName: row.warehouseName || null,
      commodityName: row.commodityName || null,
      currency: row.currency || "USD",
      avgInventoryCost: num(row.avgInventoryCost),
      avgTransportCost: num(row.avgTransportCost),
      payload: { importSource: "inventory-csv" },
      syncedAt: CAPTURED_AT,
      updatedAt: new Date(),
    };
    await prisma.sellfoxFbaInventorySnapshot.upsert({
      where: { storeId_capturedAt_sourceKey: { storeId, capturedAt: CAPTURED_AT, sourceKey } },
      update: data,
      create: data,
    });
    writes++;
  }
  await prisma.sellfoxSnapshotHead.upsert({
    where: { storeId_resource: { storeId, resource: "inventory" } },
    update: { capturedAt: CAPTURED_AT },
    create: { storeId, resource: "inventory", capturedAt: CAPTURED_AT },
  });
  return writes;
}

async function main() {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("No organization; run db:seed-admin first");
  await ensureWorkspace(org.id);
  const storeId = await ensureStore(org.id);

  const matrixPath =
    "/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_销量统计_ASIN_按日_2025-10-01_2026-10-27.xlsx";
  const matrix = loadMatrixSheets(matrixPath);
  const sales = await importSales(org.id, storeId, matrix);
  const perfWrites = await importPerformanceCsv(
    org.id,
    storeId,
    "/workspace/sellfox-exports/2026-10-26/TK店-US_performance_2026-09-26_2026-10-25.csv",
  );
  // Prefer fresher listings/inventory from from-123 if present
  const listingsPath = fs.existsSync("/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_listings_current_now.csv")
    ? "/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_listings_current_now.csv"
    : "/workspace/sellfox-exports/2026-10-26/TK店-US_listings_current_now.csv";
  const inventoryPath = fs.existsSync("/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_inventory_current_now.csv")
    ? "/workspace/sellfox-exports/2026-10-28/from-123/TK店-US_inventory_current_now.csv"
    : "/workspace/sellfox-exports/2026-10-26/TK店-US_inventory_current_now.csv";
  let listingWrites = 0;
  let invWrites = 0;
  try {
    listingWrites = await importListings(org.id, storeId, listingsPath);
  } catch (e) {
    console.error("listings_import_error", e.message);
  }
  try {
    invWrites = await importInventory(org.id, storeId, inventoryPath);
  } catch (e) {
    console.error("inventory_import_error", e.message);
  }

  // Also merge sales_append 10/26-10/27 if matrix already has them; append fills gaps
  const appendPath = "/workspace/sellfox-exports/2026-10-28/from-123/sales_append_1026_1027.csv";
  let appendWrites = 0;
  if (fs.existsSync(appendPath)) {
    const rows = parseCsv(appendPath);
    for (const row of rows) {
      if (row.shop && row.shop !== SHOP_NAME) continue;
      const sourceKey = primaryMsku(row.msku, row.sku);
      if (!sourceKey) continue;
      const reportDate = row.reportDate;
      if (!reportDate || reportDate < WINDOW_START || reportDate > WINDOW_END) continue;
      const data = {
        id: `sellfox-sales-${storeId}-${reportDate}-${sourceKey}`,
        organizationId: org.id,
        workspaceId: WORKSPACE_ID,
        storeId,
        sourceKey,
        reportDate,
        asin: String(row.asin || ""),
        msku: sourceKey,
        sku: String(row.sku || sourceKey),
        quantity: int(row.quantity),
        revenue: num(row.revenue),
        orders: int(row.orders),
        currency: "USD",
        payload: { importSource: "sales_append" },
        syncedAt: CAPTURED_AT,
        updatedAt: new Date(),
      };
      await prisma.sellfoxSalesDailySnapshot.upsert({
        where: { storeId_reportDate_sourceKey: { storeId, reportDate, sourceKey } },
        update: data,
        create: data,
      });
      appendWrites++;
    }
  }

  const counts = {
    orgId: org.id,
    storeId,
    salesWrites: sales.writes,
    salesDays: sales.days,
    perfWrites,
    listingWrites,
    invWrites,
    appendWrites,
    salesTotal: await prisma.sellfoxSalesDailySnapshot.count({ where: { storeId } }),
    perfTotal: await prisma.sellfoxProductDailySnapshot.count({ where: { storeId } }),
    coverageDays: await prisma.sellfoxSalesDayCoverage.count({ where: { storeId } }),
  };
  console.log(JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
