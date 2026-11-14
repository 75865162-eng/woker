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
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type ProposalKind = "NO_CONVERSION" | "HIGH_ACOS" | "STOCKOUT_RISK" | "HIGH_POTENTIAL";

export const THRESHOLDS = {
  windowDays: 14,
  noConversion: { minClicks: 15, minSpend: 5, bidMultiplier: 0.7 },
  highAcos: { acosPct: 50, minSpend: 20, bidMultiplier: 0.8 },
  stockoutRisk: { maxCoverDays: 7, minSpend7d: 5 },
  highPotential: { maxAcosPct: 20, minSpend: 15, minCoverDays: 21, bidMultiplier: 1.15 },
  minCoverDaysForRaise: 21,
} as const;

type AggRow = {
  storeId: string; targetingId: string; adGroupId: string; campaignId: string;
  targetingText: string | null; matchType: string | null; asin: string | null; msku: string | null;
  clicks: number; cost: number; adOrders: number; adSales: number; spend7d: number;
};
type CoverRow = { storeId: string; msku: string; coverDays: number; onHand: number; dailyRate: number };

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
  const basis = {
    windowDays: THRESHOLDS.windowDays,
    clicks: row.clicks, cost: Number(row.cost.toFixed(2)), adOrders: row.adOrders, adSales: Number(row.adSales.toFixed(2)),
    acosPct: acosPct == null ? null : Number(acosPct.toFixed(1)),
    spend7d: Number(row.spend7d.toFixed(2)),
    coverDays: cover ? Number(cover.coverDays.toFixed(1)) : null,
    onHand: cover?.onHand ?? null, dailyRate: cover ? Number(cover.dailyRate.toFixed(2)) : null,
    targetingText: row.targetingText, matchType: row.matchType,
  };
  const asin = row.asin ?? row.msku ?? row.targetingId;
  const msku = row.msku ?? null;
  if (kind === "NO_CONVERSION") {
    return { storeId: row.storeId, asin, msku, kind, action: "LOWER_BID", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { bidMultiplier: THRESHOLDS.noConversion.bidMultiplier }, basis,
      expectedImpact: `点击 ${row.clicks} 次 0 转化、花费 $${row.cost.toFixed(2)}；降价 30% 预期以少量曝光损失止损。` };
  }
  if (kind === "HIGH_ACOS") {
    return { storeId: row.storeId, asin, msku, kind, action: "LOWER_BID", entityType: entityTypeOf(row), externalId: row.targetingId, label: row.targetingText,
      current: null, proposed: { bidMultiplier: THRESHOLDS.highAcos.bidMultiplier }, basis,
      expectedImpact: `ACOS ${acosPct?.toFixed(0)}%（花费 $${row.cost.toFixed(2)}）；降价 20% 预期在不显著丢量的情况下压 ACOS。` };
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
  const [agg, covers] = await Promise.all([
    // 每关键词/投放 14 天聚合 + 近 7 天花费
    prisma.$queryRaw<AggRow[]>`
      select "storeId", "targetingId", max("adGroupId") as "adGroupId", max("campaignId") as "campaignId",
             max("targetingText") as "targetingText", max("matchType") as "matchType",
             max("asin") as asin, max("msku") as msku,
             sum(clicks)::int as clicks, sum(cost) as cost, sum("adOrders")::int as "adOrders", sum("adSales") as "adSales",
             coalesce(sum(cost) filter (where "reportDate"::date > current_date - 7), 0) as "spend7d"
      from "SellfoxAdsTargetingDaily"
      where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId} and "reportDate"::date >= ${from}::date
        and "adType" = 'sp'
      group by 1, 2`,
    // 补货口径（与 restock.ts 相同的 7/14/30 加权）
    prisma.$queryRaw<CoverRow[]>`
      with rates as (
        select "storeId", "msku",
          (0.5 * avg(qty) filter (where d::date >= current_date - 7)
         + 0.3 * avg(qty) filter (where d::date between current_date - 14 and current_date - 8)
         + 0.2 * avg(qty) filter (where d::date between current_date - 30 and current_date - 15)) as daily_rate
        from (
          select "storeId", "msku", "reportDate" as d, sum(quantity) as qty
          from "SellfoxSalesDailySnapshot"
          where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId} and "reportDate"::date > current_date - 32
          group by 1, 2, 3
        ) s
        where qty is not null
        group by 1, 2
      ),
      stock as (
        select "storeId", "msku", sum(quantity) as on_hand
        from "SellfoxFbaInventorySnapshot"
        where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId}
          and ("reportDate", id) in (
            select distinct on ("storeId", "msku") "reportDate", id from "SellfoxFbaInventorySnapshot"
            where "organizationId" = ${organizationId} and "workspaceId" = ${workspaceId}
            order by "storeId", "msku", "reportDate" desc
          )
        group by 1, 2
      )
      select r."storeId", r."msku",
        case when r.daily_rate > 0 then (st.on_hand / r.daily_rate) else null end as "coverDays",
        st.on_hand, r.daily_rate
      from rates r join stock st on st."storeId" = r."storeId" and st."msku" = r."msku"
      where r.daily_rate > 0`,
  ]);

  const coverByKey = new Map(covers.map(c => [`${c.storeId}|${c.msku}`, c]));
  const candidates: GeneratedProposal[] = [];
  for (const row of agg) {
    if (row.clicks <= 0 && row.cost <= 0) continue;
    const coverKey = `${row.storeId}|${row.msku ?? row.asin ?? ""}`;
    const cover = coverByKey.get(coverKey);
    const acosPct = row.adSales > 0 ? (row.cost / row.adSales) * 100 : null;
    // 优先级：断货 > 止血 > 压ACOS > 抢量（同一关键词只出一条最优先方案）。
    if (cover && cover.coverDays != null && cover.coverDays <= THRESHOLDS.stockoutRisk.maxCoverDays && row.spend7d >= THRESHOLDS.stockoutRisk.minSpend7d) {
      const proposal = toProposal(row, cover, "STOCKOUT_RISK");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (row.clicks >= THRESHOLDS.noConversion.minClicks && row.adOrders === 0 && row.cost >= THRESHOLDS.noConversion.minSpend) {
      const proposal = toProposal(row, cover, "NO_CONVERSION");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (acosPct != null && acosPct >= THRESHOLDS.highAcos.acosPct && row.cost >= THRESHOLDS.highAcos.minSpend) {
      const proposal = toProposal(row, cover, "HIGH_ACOS");
      if (proposal) candidates.push(proposal);
      continue;
    }
    if (acosPct != null && acosPct <= THRESHOLDS.highPotential.maxAcosPct && row.cost >= THRESHOLDS.highPotential.minSpend
      && (!cover || cover.coverDays == null || cover.coverDays >= THRESHOLDS.highPotential.minCoverDays)) {
      const proposal = toProposal(row, cover, "HIGH_POTENTIAL");
      if (proposal) candidates.push(proposal);
    }
  }

  let created = 0, updated = 0;
  for (const candidate of candidates) {
    const existing = await prisma.sellfoxAdsProposal.findUnique({
      where: { organizationId_workspaceId_externalId_kind: { organizationId, workspaceId, externalId: candidate.externalId, kind: candidate.kind } },
      select: { id: true, status: true, basis: true },
    });
    const basisChanged = !existing || JSON.stringify(existing.basis) !== JSON.stringify(candidate.basis);
    if (existing && !basisChanged && existing.status === "PENDING") continue; // 无变化不刷新
    const data = {
      storeId: candidate.storeId, asin: candidate.asin, msku: candidate.msku, action: candidate.action,
      entityType: candidate.entityType, externalId: candidate.externalId, label: candidate.label, current: candidate.current,
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
