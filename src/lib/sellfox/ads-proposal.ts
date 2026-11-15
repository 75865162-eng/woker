/**
 * 库存×广告联动优化方案生成器。
 *
 * 数据源：SellfoxAdsTargetingDaily（关键词/投放级 14 天聚合）× 加权日销与 FBA 在手（补货口径同 restock.ts）。
 * 规则（全部可审计，basis 记录完整计算依据）：
 *  - NO_CONVERSION   点击≥15 且 0 单且花费≥$5          → 降价 30%（止血）
 *  - HIGH_ACOS       ACOS≥50% 且花费≥$20              → 降价 20%
 *  - STOCKOUT_RISK   可售天数≤7 且近 7 天有花费        → 暂停（省库存给自然单）
 *  - HIGH_POTENTIAL  ACOS≤20% 且花费≥$15 且可售>21 天 → 加价 15%（抢量）
 * 阈值集中在 THRESHOLDS，调整幅度记录在 proposed.bidMultiplier，执行期以 Amazon 侧当前 bid 为基准计算。
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { mergeRestockDays, restockDailyRates, type RestockDay } from "@/lib/sellfox/restock";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";

export type ProposalKind = "NO_CONVERSION" | "HIGH_ACOS" | "STOCKOUT_RISK" | "HIGH_POTENTIAL";

export const THRESHOLDS = {
  windowDays: 14,
  noConversion: { minClicks: 15, bidMultiplier: 0.7 },
  highAcos: { acosPct: 50, bidMultiplier: 0.8 },
  stockoutRisk: { maxCoverDays: 7, minSpend7d: 5 },
  highPotential: { maxAcosPct: 20, minSpend: 15, minCoverDays: 21, bidMultiplier: 1.15 },
} as const;

type AggRow = {
  storeId: string; targetingId: string; adGroupId: string; campaignId: string; currency: string | null;
  targetingText: string | null; matchType: string | null; asin: string | null; msku: string | null;
  clicks: number; cost: number; adOrders: number; adSales: number; spend7d: number;
};
type SalesDayRow = { storeId: string; msku: string; date: string; quantity: number | null };
type InventoryDayRow = { storeId: string; msku: string; date: string; quantity: number | null };
type StockRow = { storeId: string; msku: string; fulfillable: number | null };
type CoverageRow = { storeId: string; reportDate: string };
type CoverRow = { storeId: string; msku: string; coverDays: number; onHand: number; dailyRate: number };
const proposalThresholdsByCurrency: Record<string, { noConversionSpend: number; highAcosSpend: number; highPotentialSpend: number }> = {
  USD: { noConversionSpend: 5, highAcosSpend: 20, highPotentialSpend: 15 },
};

export type GeneratedProposal = {
  storeId: string; asin: string; msku: string | null; kind: ProposalKind; action: string;
  entityType: string; externalId: string; label: string | null;
  current: Prisma.InputJsonValue | null; proposed: Prisma.InputJsonValue;
  basis: Prisma.InputJsonValue; expectedImpact: string;
};

function entityTypeOf(row: AggRow) {
  // asin+无 matchType → 商品投放（SP:target），其余按关键词处理。
  return row.asin && !row.matchType ? "SP:target" : "SP:keyword";
}

function toProposal(row: AggRow, cover: CoverRow | undefined, kind: ProposalKind): GeneratedProposal | null {
  const acosPct = row.adSales > 0 ? (row.cost / row.adSales) * 100 : null;
  const amount = `${row.currency ?? ""} ${row.cost.toFixed(2)}`.trim();
  const basis = {
    windowDays: THRESHOLDS.windowDays,
    clicks: row.clicks, cost: Number(row.cost.toFixed(2)), adOrders: row.adOrders, adSales: Number(row.adSales.toFixed(2)),
    acosPct: acosPct == null ? null : Number(acosPct.toFixed(1)),
    spend7d: row.spend7d == null ? null : Number(row.spend7d.toFixed(2)),
    currency: row.currency,
    coverDays: cover ? Number(cover.coverDays.toFixed(1)) : null,
    onHand: cover?.onHand ?? null, dailyRate: cover ? Number(cover.dailyRate.toFixed(2)) : null,
    targetingText: row.targetingText, matchType: row.matchType,
  };
  const asin = row.asin ?? row.msku ?? row.targetingId;
  const msku = row.msku ?? null;
  if (kind === "NO_CONVERSION") {
    return { storeId: row.storeId, asin, msku, kind, action: "LOWER_BID", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { bidMultiplier: THRESHOLDS.noConversion.bidMultiplier }, basis,
      expectedImpact: `点击 ${row.clicks} 次 0 转化、花费 ${amount}；降价 30% 预期以少量曝光损失止损。` };
  }
  if (kind === "HIGH_ACOS") {
    return { storeId: row.storeId, asin, msku, kind, action: "LOWER_BID", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { bidMultiplier: THRESHOLDS.highAcos.bidMultiplier }, basis,
      expectedImpact: `ACOS ${acosPct?.toFixed(0)}%（花费 ${amount}）；降价 20% 预期在不显著丢量的情况下压 ACOS。` };
  }
  if (kind === "STOCKOUT_RISK") {
    return { storeId: row.storeId, asin, msku, kind, action: "PAUSE", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { state: "PAUSED" }, basis,
      expectedImpact: `可售仅 ${cover ? cover.coverDays.toFixed(1) : "?"} 天（在手 ${cover?.onHand ?? 0}）；暂停广告把流量让给自然单，避免广告加速断货。` };
  }
  if (kind === "HIGH_POTENTIAL") {
    return { storeId: row.storeId, asin, msku, kind, action: "RAISE_BID", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { bidMultiplier: THRESHOLDS.highPotential.bidMultiplier }, basis,
      expectedImpact: `ACOS ${acosPct?.toFixed(0)}% 且库存可售 ${cover ? cover.coverDays.toFixed(0) : "?"} 天；加价 15% 抢更多曝光。` };
  }
  return null;
}

export async function generateAdsProposals(organizationId: string, workspaceId: string, options?: { days?: number }) {
  const windowDays = options?.days ?? THRESHOLDS.windowDays;
  const from = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const [agg, salesDays, inventoryDays, stocks, coverage] = await Promise.all([
    prisma.$queryRaw<AggRow[]>`
      select a."storeId", a."targetingId", max(a."adGroupId") as "adGroupId", max(a."campaignId") as "campaignId",
             max(a."targetingText") as "targetingText", max(a."matchType") as "matchType", max(a.currency) as currency,
             max(a.asin) as asin, max(a."msku") as msku,
             sum(a.clicks)::int as clicks, sum(a.cost) as cost, sum(a."adOrders")::int as "adOrders", sum(a."adSales") as "adSales",
             sum(a.cost) filter (where a."reportDate"::date > current_date - 7) as "spend7d"
      from "SellfoxAdsTargetingDaily" a
      where a."organizationId" = ${organizationId} and a."workspaceId" = ${workspaceId} and a."reportDate"::date >= ${from}::date
        and a."adType" = 'sp'
      group by a."storeId", a."targetingId", a.currency`,
    prisma.$queryRaw<SalesDayRow[]>`
      select "storeId", "msku", "reportDate"::date::text as date,
        case when bool_and(complete) and count(quantity) = count(*) then sum(quantity) end as quantity
      from "sellfox_sales_daily"
      where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId}
        and "reportDate"::date > current_date - 32 and "reportDate"::date <= current_date - 2
      group by 1, 2, 3`,
    prisma.$queryRaw<InventoryDayRow[]>`
      with latest as (
        select "storeId", "reportDate", max("capturedAt") as "capturedAt"
        from "SellfoxFbaInventorySnapshot"
        where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId}
          and "reportDate" > to_char(current_date - 32, 'YYYY-MM-DD') and "reportDate" <= to_char(current_date - 2, 'YYYY-MM-DD')
        group by 1, 2
      )
      select i."storeId", i.msku, i."reportDate"::date::text as date,
        case when count(i.quantity) = count(*) then sum(i.quantity)::double precision else null end as quantity
      from "SellfoxFbaInventorySnapshot" i
      join latest l on l."storeId" = i."storeId" and l."reportDate" = i."reportDate" and l."capturedAt" = i."capturedAt"
      where i."organizationId" = ${organizationId} and i."workspaceId" = ${workspaceId}
      group by 1, 2, 3`,
    prisma.$queryRaw<StockRow[]>`
      select l."storeId", l.msku, sum(l.fulfillable)::double precision as fulfillable
      from sellfox_listing_current l
      where l."organizationId" = ${organizationId} and l."workspaceId" = ${workspaceId}
      group by 1, 2`,
    prisma.$queryRaw<CoverageRow[]>`
      select c."storeId", c."reportDate"
      from "SellfoxSalesDayCoverage" c
      join "SellfoxStore" s on s.id = c."storeId"
      where s."organizationId" = ${organizationId} and s."workspaceId" = ${workspaceId}
        and c."reportDate" > to_char(current_date - 32, 'YYYY-MM-DD')
        and c."reportDate" <= to_char(current_date - 2, 'YYYY-MM-DD')`,
  ]);

  const salesByKey = new Map<string, SalesDayRow[]>();
  for (const row of salesDays) {
    const key = `${row.storeId}|${row.msku}`;
    salesByKey.set(key, [...(salesByKey.get(key) ?? []), row]);
  }
  const inventoryByKey = new Map<string, InventoryDayRow[]>();
  for (const row of inventoryDays) {
    const key = `${row.storeId}|${row.msku}`;
    inventoryByKey.set(key, [...(inventoryByKey.get(key) ?? []), row]);
  }
  const stockByKey = new Map(stocks.map(row => [`${row.storeId}|${row.msku}`, row.fulfillable]));
  const coveredDatesByStore = new Map<string, Set<string>>();
  for (const row of coverage) {
    const dates = coveredDatesByStore.get(row.storeId) ?? new Set<string>();
    dates.add(row.reportDate);
    coveredDatesByStore.set(row.storeId, dates);
  }
  const coverByKey = new Map<string, CoverRow>();
  for (const [key, rows] of salesByKey) {
    const inventoryByDate = new Map((inventoryByKey.get(key) ?? []).map(day => [day.date, day.quantity]));
    const merged = mergeRestockDays(rows.map(row => {
      const inventory = inventoryByDate.get(row.date);
      return { date: row.date, quantity: row.quantity, stockout: inventory == null ? undefined : inventory === 0 };
    }));
    const byDate = new Map(merged.map(day => [day.date, day]));
    const today = sellfoxDateAt(new Date());
    const dayMs = 86_400_000;
    const requiredDates = Array.from({ length: 30 }, (_, index) => new Date(`${today}T00:00:00+08:00`).getTime() - (31 - index) * dayMs)
      .map(timestamp => new Date(timestamp).toISOString().slice(0, 10));
    const coveredDates = coveredDatesByStore.get(key.slice(0, key.indexOf("|")));
    if (!coveredDates || requiredDates.some(date => !coveredDates.has(date))) continue;
    const completeWindow: RestockDay[] = requiredDates.map(date => byDate.get(date) ?? { date, quantity: null });
    const rates = restockDailyRates(completeWindow, today);
    const onHand = stockByKey.get(key);
    if (onHand == null || rates.weighted == null || rates.weighted <= 0) continue;
    const separator = key.indexOf("|");
    const storeId = key.slice(0, separator);
    const msku = key.slice(separator + 1);
    coverByKey.set(key, { storeId, msku, coverDays: onHand / rates.weighted, onHand, dailyRate: rates.weighted });
  }
  const candidates: GeneratedProposal[] = [];
  for (const row of agg) {
    if (row.clicks <= 0 && row.cost <= 0) continue;
    const metrics = [row.clicks, row.cost, row.adOrders, row.adSales, row.spend7d];
    if (metrics.some(value => !Number.isFinite(value) || value < 0)) continue;
    const currency = (row.currency ?? "").trim().toUpperCase();
    const threshold = proposalThresholdsByCurrency[currency];
    if (!threshold) continue;
    const coverKey = `${row.storeId}|${row.msku ?? ""}`;
    const cover = coverByKey.get(coverKey);
    const acosPct = row.adSales > 0 ? (row.cost / row.adSales) * 100 : null;
    // 优先级：断货 > 止血 > 压ACOS > 抢量（同一关键词只出一条最优先方案）。
    if (cover && cover.coverDays != null && cover.coverDays <= THRESHOLDS.stockoutRisk.maxCoverDays && row.spend7d >= THRESHOLDS.stockoutRisk.minSpend7d) {
      const proposal = toProposal(row, cover, "STOCKOUT_RISK");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (row.clicks >= THRESHOLDS.noConversion.minClicks && row.adOrders === 0 && row.cost >= threshold.noConversionSpend) {
      const proposal = toProposal(row, cover, "NO_CONVERSION");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (acosPct != null && acosPct >= THRESHOLDS.highAcos.acosPct && row.cost >= threshold.highAcosSpend) {
      const proposal = toProposal(row, cover, "HIGH_ACOS");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (acosPct != null && acosPct <= THRESHOLDS.highPotential.maxAcosPct && row.cost >= threshold.highPotentialSpend
      && cover != null && cover.coverDays >= THRESHOLDS.highPotential.minCoverDays) {
      const proposal = toProposal(row, cover, "HIGH_POTENTIAL");
      if (proposal) candidates.push(proposal);
    }
  }

  let created = 0, updated = 0;
  for (const candidate of candidates) {
    const existing = await prisma.sellfoxAdsProposal.findUnique({
      where: { organizationId_workspaceId_storeId_entityType_externalId_kind: { organizationId, workspaceId, storeId: candidate.storeId, entityType: candidate.entityType, externalId: candidate.externalId, kind: candidate.kind } },
      select: { id: true, status: true, basis: true },
    });
    const basisChanged = !existing || JSON.stringify(existing.basis) !== JSON.stringify(candidate.basis);
    if (existing && !basisChanged && existing.status === "PENDING") continue; // 无变化不刷新
    const data = {
      storeId: candidate.storeId, asin: candidate.asin, msku: candidate.msku, action: candidate.action,
      entityType: candidate.entityType, externalId: candidate.externalId, label: candidate.label, current: candidate.current ?? Prisma.DbNull,
      proposed: candidate.proposed, basis: candidate.basis, expectedImpact: candidate.expectedImpact,
    };
    if (existing) {
      if (basisChanged && existing.status === "PENDING") { await prisma.sellfoxAdsProposal.update({ where: { id: existing.id }, data }); updated++; }
    } else {
      await prisma.sellfoxAdsProposal.create({ data: { id: `sellfox-proposal-${randomUUID()}`, organizationId, workspaceId, kind: candidate.kind, ...data } });
      created++;
    }
  }
  const byKind = candidates.reduce<Record<string, number>>((acc, p) => { acc[p.kind] = (acc[p.kind] ?? 0) + 1; return acc; }, {});
  return { generated: candidates.length, created, updated, byKind };
}
