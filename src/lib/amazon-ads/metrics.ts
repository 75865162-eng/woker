import { Prisma } from "@prisma/client";

export type AdsMetricInput = {
  impressions?: unknown;
  clicks?: unknown;
  spend?: unknown;
  orders?: unknown;
  sales?: unknown;
};

export type AdsDerivedMetrics = {
  ctr: string | null;
  cpc: string | null;
  cvr: string | null;
  acos: string | null;
  roas: string | null;
};

function decimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const result = Prisma.Decimal.isDecimal(value)
      ? value
      : typeof value === "bigint"
        ? new Prisma.Decimal(value.toString())
        : new Prisma.Decimal(String(value));
    return result.isFinite() ? result : null;
  } catch {
    return null;
  }
}

function ratio(numerator: unknown, denominator: unknown, multiplier = 1) {
  const top = decimal(numerator);
  const bottom = decimal(denominator);
  if (!top || !bottom || bottom.isZero()) return null;
  const value = top.div(bottom).mul(multiplier);
  // Keep a stable, transport-safe decimal string without implying precision the source did not provide.
  return value.toFixed(6).replace(/\.?(0+)$/, "") || "0";
}

/**
 * Derived metrics are null when the source metric or denominator is unavailable.
 * Percentage fields are returned in percentage points (for example, 12.5 means 12.5%).
 */
export function deriveAdsMetrics(input: AdsMetricInput): AdsDerivedMetrics {
  return {
    ctr: ratio(input.clicks, input.impressions, 100),
    cpc: ratio(input.spend, input.clicks),
    cvr: ratio(input.orders, input.clicks, 100),
    acos: ratio(input.spend, input.sales, 100),
    roas: ratio(input.sales, input.spend),
  };
}
