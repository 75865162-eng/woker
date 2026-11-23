import { prisma } from "@/lib/db/prisma";
import type { SkuPivotRow } from "./settlement-sku-pivot";
import { FEE_POOL_KEYS, type FeePoolKey } from "./settlement-fee-classification";
import type { SyncScope } from "./policy";

/**
 * 利润报表（Wimoor 对标 §3 P7）——保守口径实现。
 *
 * 用户确认口径：原币不折算、成本/广告/税费分列不混算、标注来源与待确认项。
 * 因此本层「不」臆造一个跨口径的最终净利润数字；而是：
 * - 主干：结算 SKU 透视（收入本金 + 8 类平台费用 + 结算口径毛利，来自 P6）；
 * - 广告花费：按 advertisedAsin 独立聚合，作为「参考分摊列」单列展示，注明与 SKU 非一一对应；
 * - 采购成本 / 税费 / 本地费用：口径待业务确认（含税规则、汇率来源、SKU 映射），
 *   本层列出「待接入」状态，不并入合计、不补零。
 * - 两级视图：SKU 级 + 结算批次（店铺代理）级汇总。
 */

export type AdSpendByAsin = { asin: string; currency: string; spend: string };

export type ProfitSkuRow = {
  sku: string; currency: string;
  principal: string;
  platformFees: Record<FeePoolKey, string>;
  platformFeeTotal: string;
  settlementMargin: string; // 结算口径毛利（P6 定义，非最终利润）
  marginRate: string | null;
  adSpend: string | null; // 参考：按 asin 匹配的广告花费；无匹配 null
  adSpendNote: string | null;
  cost: null; tax: null; localExpense: null;
  pendingSources: string[];
};

export type ProfitStoreRow = {
  settlementId: string; currency: string; skuCount: number;
  principal: string; platformFeeTotal: string; settlementMargin: string;
};

function dec(v: unknown): number { const n = typeof v === "string" ? Number(v) : 0; return Number.isFinite(n) ? n : 0; }
function fmt(n: number): string { const r = Math.round(n * 1_000_000) / 1_000_000; return Object.is(r, -0) ? "0" : String(r); }

export const PROFIT_BASIS = [
  "利润口径（保守默认，待业务确认后固化）：",
  "1) 原币不折算：各列保留原币种金额，按 currency 分组；展示币种/折算汇率来源待确认。",
  "2) 成本、广告、税费分列不混算：不臆造跨来源相加的最终净利润。",
  "3) 结算口径毛利 = 结算本金 − 8 类平台费用（来自结算 SKU 透视），未含采购成本/广告全量/税费/本地费用。",
  "4) 广告花费按 advertisedAsin 聚合，与 Seller SKU 非一一对应，仅作参考列并标注；无匹配显示「—」。",
  "5) 采购成本 / 税费 / 本地费用：含税规则、SKU 映射与取数源待业务确认，本版列为待接入，不并入合计、不补零。",
  "6) 店铺级汇总以结算批次（settlementId）为代理维度，标记来源，避免伪造店铺归属。",
  "7) 所有金额字符串保真（最多 6 位小数），缺失保持 null。",
].join("\n");

/** 纯函数：结算 SKU 透视 + 广告花费 → SKU 级利润表行。广告按 SKU 中合法 ASIN 匹配（SKU 常即 ASIN 或含 ASIN）。 */
export function buildProfitSkuRows(pivots: SkuPivotRow[], adSpend: AdSpendByAsin[]): ProfitSkuRow[] {
  const adByKey = new Map<string, { spend: number; currency: string }>();
  for (const a of adSpend) {
    const asin = (a.asin ?? "").trim().toUpperCase();
    const key = `${asin}\u0000${a.currency}`;
    const prev = adByKey.get(key);
    adByKey.set(key, { spend: (prev?.spend ?? 0) + dec(a.spend), currency: a.currency });
  }
  return pivots.map(p => {
    const platformFees = { ...p.fees } as Record<FeePoolKey, string>;
    // 尝试用 SKU 本身作为 ASIN 匹配广告花费；只有格式匹配且币种一致才采用，否则不臆造。
    const match = /^[A-Z0-9]{10}$/.test(p.sku) ? adByKey.get(`${p.sku}\u0000${p.currency}`) : undefined;
    return {
      sku: p.sku,
      currency: p.currency,
      principal: p.basis,
      platformFees,
      platformFeeTotal: p.feeTotal,
      settlementMargin: p.settlementMargin,
      marginRate: p.marginRate,
      adSpend: match ? fmt(match.spend) : null,
      adSpendNote: match ? "按 advertisedAsin=SKU 匹配，仅供参考，未并入毛利" : "未匹配到同币种广告花费（或缺 ASIN 映射）",
      cost: null,
      tax: null,
      localExpense: null,
      pendingSources: ["采购成本（含采购单/批次成本，SKU 映射与含税口径待确认）", "税费/VAT/所得税（取数源待确认）", "本地费用分摊（SKU 映射待确认）"],
    };
  });
}

/** 纯函数：SKU 利润行 → 结算批次（店铺代理）级汇总。 */
export function buildProfitStoreRows(skuRows: ProfitSkuRow[], settlementId: string): ProfitStoreRow[] {
  const groups = new Map<string, { currency: string; principal: number; fee: number; margin: number; skus: Set<string> }>();
  for (const r of skuRows) {
    let g = groups.get(r.currency);
    if (!g) { g = { currency: r.currency, principal: 0, fee: 0, margin: 0, skus: new Set() }; groups.set(r.currency, g); }
    g.principal += dec(r.principal);
    g.fee += dec(r.platformFeeTotal);
    g.margin += dec(r.settlementMargin);
    g.skus.add(r.sku);
  }
  return [...groups.entries()].map(([currency, g]) => ({
    settlementId, currency, skuCount: g.skus.size,
    principal: fmt(g.principal), platformFeeTotal: fmt(g.fee), settlementMargin: fmt(g.margin),
  })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export const PROFIT_PLATFORM_FEE_LABELS: Array<[FeePoolKey, string]> = FEE_POOL_KEYS.map(k => [k, ({
  storageFee: "仓储费", longStorageFee: "长期仓储费", advSpendFee: "平台广告费",
  couponRedemptionFee: "优惠券费", reserveFee: "预留金", reimbursementFee: "赔偿",
  disposalFee: "弃置费", shopOtherFee: "店铺其他费",
} as Record<FeePoolKey, string>)[k]]);

const AD_SPEND_ROW_CAP = 5000;

/**
 * 只读：聚合已发布广告事实的按 ASIN 花费（adProduct 报表族，仅 spend>0）。
 * 已发布判定与广告模块一致：version.status=PUBLISHED + sourceTask.status=SUCCEEDED + publishedAt 非空。
 */
export async function readAdSpendByAsin(scope: SyncScope): Promise<AdSpendByAsin[]> {
  const facts = await prisma.amazonAdsReportFact.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      advertisedAsin: { not: null },
      spend: { gt: 0 },
      version: { status: "PUBLISHED", publishedAt: { not: null }, sourceTask: { status: "SUCCEEDED" } },
    },
    select: { advertisedAsin: true, currencyCode: true, spend: true },
    take: AD_SPEND_ROW_CAP + 1,
  });
  const acc = new Map<string, number>();
  for (const f of facts.slice(0, AD_SPEND_ROW_CAP)) {
    const asin = (f.advertisedAsin ?? "").trim().toUpperCase();
    const currency = (f.currencyCode ?? "").trim() || "UNKNOWN";
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const key = `${asin}\u0000${currency}`;
    acc.set(key, (acc.get(key) ?? 0) + Number(f.spend ?? 0));
  }
  return [...acc.entries()].map(([key, spend]) => {
    const [asin, currency] = key.split("\u0000");
    return { asin, currency, spend: fmt(spend) };
  });
}
