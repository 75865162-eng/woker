/**
 * 今日订单看板（Wimoor 对标 §3 P2）——三日并列 + 库存拼合。
 *
 * 口径（保守、不造数）：
 * - 三个业务日键：今日 T、昨日 T-1、上周同日 T-7（按业务日期字符串 YYYY-MM-DD）。
 * - 销量 = 订单商品行 quantityOrdered 求和；净销售额 = proceedsOriginal 按币种分组求和（字符串保真）。
 * - 只统计已成功发布订单任务中的订单行；缺日用 null，不补零、不estimated。
 * - 库存拼合：可售 fulfillable / 预留 reserved / 在途 inbound(working+shipped+receiving)，按 SKU 最新捕获快照；缺失 null。
 * - 销售额按币种分组，不跨币种相加。
 */

export type TodayOrderLine = {
  sku: string; asin: string | null; businessDate: string;
  quantity: number; proceeds: string | null; currency: string | null;
};
export type TodayInventory = {
  sku: string; fulfillable: number | null; reserved: number | null; inbound: number | null;
};

export type DayCell = { quantity: number | null; sales: Array<{ currency: string; amount: string }> };
export type TodayRow = {
  sku: string; asin: string | null;
  today: DayCell; yesterday: DayCell; lastWeekSameDay: DayCell;
  fulfillable: number | null; reserved: number | null; inbound: number | null;
};

function dec(v: unknown): number { const n = typeof v === "string" ? Number(v) : 0; return Number.isFinite(n) ? n : 0; }
function fmt(n: number): string { const r = Math.round(n * 1_000_000) / 1_000_000; return Object.is(r, -0) ? "0" : String(r); }
export function shiftDay(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** 纯函数：三日订单行 + 库存 → 今日看板行。缺日/缺值 null。 */
export function buildTodayDashboard(lines: TodayOrderLine[], inventory: TodayInventory[], today: string): TodayRow[] {
  const keys = { today, yesterday: shiftDay(today, -1), lastWeekSameDay: shiftDay(today, -7) };
  const skus = new Map<string, string | null>();
  for (const l of lines) if (l.sku && !skus.has(l.sku)) skus.set(l.sku, l.asin ?? null);

  const cell = (sku: string, day: string): DayCell => {
    const dayLines = lines.filter(l => l.sku === sku && l.businessDate === day);
    if (!dayLines.length) return { quantity: null, sales: [] };
    const quantity = dayLines.reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
    const byCurrency = new Map<string, number>();
    for (const l of dayLines) {
      if (l.proceeds && l.currency) byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + dec(l.proceeds));
    }
    return { quantity, sales: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: fmt(amount) })).sort((a, b) => a.currency.localeCompare(b.currency)) };
  };

  const invBySku = new Map<string, TodayInventory>();
  for (const i of inventory) if (i.sku && !invBySku.has(i.sku)) invBySku.set(i.sku, i);

  return [...skus.entries()].map(([sku, asin]) => {
    const inv = invBySku.get(sku);
    return {
      sku, asin,
      today: cell(sku, keys.today),
      yesterday: cell(sku, keys.yesterday),
      lastWeekSameDay: cell(sku, keys.lastWeekSameDay),
      fulfillable: inv?.fulfillable ?? null,
      reserved: inv?.reserved ?? null,
      inbound: inv?.inbound ?? null,
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
}

export const TODAY_BASIS = [
  "今日看板口径（保守默认）：",
  "1) 三键业务日：今日 T、昨日 T-1、上周同日 T-7；业务日按订单业务日期（UTC）归集，站点本地时区差异待确认。",
  "2) 销量=已发布订单行的 quantityOrdered 求和；净销售额=proceedsOriginal 按币种求和（字符串保真，不跨币种相加）。",
  "3) 缺日/缺值显示 null（页面「—」），不补零、不估算。",
  "4) 库存为最新捕获快照：可售 fulfillable、预留 reserved、在途=working+shipped+receiving；采集时点快照，非历史每日库存。",
  "5) 仅统计成功发布任务的已发布订单行；PII 不落本看板。",
].join("\n");

import { prisma } from "@/lib/db/prisma";
import type { SyncScope } from "./policy";
import { amazonAccountReadAccess } from "./read-account";

const ORDER_LINE_CAP = 12000;
const INVENTORY_CAP = 6000;

/** 只读：三键业务日的已发布订单行 + 最新库存快照 → 今日看板。 */
export async function readTodayDashboard(scope: SyncScope, params: URLSearchParams, actor?: string): Promise<{
  rows: ReturnType<typeof buildTodayDashboard>; today: string; basis: string; asOf: string; truncated: boolean;
}> {
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, "orders");
  const requested = params.get("date")?.trim().slice(0, 10) ?? "";
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : new Date().toISOString().slice(0, 10);
  const from = shiftDay(today, -7);
  const fromDate = new Date(`${from}T00:00:00Z`), toExclusive = new Date(`${today}T23:59:59.999Z`);
  const sellerIds = access.allSellers ? [] : access.sellerIds;

  // 订单行通过 order 关联到订单头（含业务时间 / 店铺 / 任务状态）；只取已成功任务的行。
  const rawLines = await prisma.amazonOrderItemRecord.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      order: {
        createdTime: { gte: fromDate, lte: toExclusive },
        ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
        task: { status: "SUCCEEDED" },
      },
    },
    select: { asin: true, sellerSku: true, quantityOrdered: true, proceedsOriginal: true, currencyCode: true, order: { select: { createdTime: true } } },
    orderBy: { order: { createdTime: "desc" } },
    take: ORDER_LINE_CAP + 1,
  });
  const lines: TodayOrderLine[] = rawLines.slice(0, ORDER_LINE_CAP).map(l => ({
    sku: (l.sellerSku ?? l.asin ?? "").trim(),
    asin: l.asin ?? null,
    businessDate: l.order.createdTime.toISOString().slice(0, 10),
    quantity: l.quantityOrdered,
    proceeds: l.proceedsOriginal,
    currency: l.currencyCode,
  })).filter(l => l.sku);

  // 最新库存快照：按 SKU 去重（最新 capturedAt），限可见店铺。
  const rawInv = await prisma.amazonInventorySnapshot.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      capturedAt: { lte: toExclusive },
      ...(sellerIds.length ? { sellerAccountId: { in: sellerIds } } : {}),
    },
    select: { sellerSku: true, fulfillableQuantity: true, reservedQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true, capturedAt: true },
    orderBy: { capturedAt: "desc" },
    take: INVENTORY_CAP + 1,
  });
  const inventory: TodayInventory[] = [];
  const seenSku = new Set<string>();
  for (const inv of rawInv.slice(0, INVENTORY_CAP)) {
    const sku = (inv.sellerSku ?? "").trim();
    if (!sku || seenSku.has(sku)) continue;
    seenSku.add(sku);
    inventory.push({
      sku,
      fulfillable: inv.fulfillableQuantity,
      reserved: inv.reservedQuantity,
      inbound: inv.inboundWorkingQuantity + inv.inboundShippedQuantity + inv.inboundReceivingQuantity,
    });
  }

  return {
    rows: buildTodayDashboard(lines, inventory, today),
    today,
    basis: TODAY_BASIS,
    asOf: new Date().toISOString(),
    truncated: rawLines.length > ORDER_LINE_CAP || rawInv.length > INVENTORY_CAP,
  };
}
