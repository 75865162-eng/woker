/** Research-service cost only. Product procurement, tariffs and logistics stay in economics.ts. */
export interface ResearchCharge {
  amount: number;
  unit: "CNY" | "USD" | "supplier_credits";
  cnyPerUnit: number;
  rateDate: string;
  rateSource: string;
  receipt: string;
  status: "estimated" | "confirmed";
}
export const researchCreditRule = { version: 1, cnyPerCredit: 0.01, precision: 3 } as const;

/** Preserve the original receipt and conversion. Never equate one request with one credit. */
export function researchChargeCredits(charge: ResearchCharge): number {
  if (!charge || Object.keys(charge).some(key => !["amount", "unit", "cnyPerUnit", "rateDate", "rateSource", "receipt", "status"].includes(key)) ||
    !Number.isFinite(charge.amount) || charge.amount < 0 || !Number.isFinite(charge.cnyPerUnit) || charge.cnyPerUnit <= 0 ||
    !["CNY", "USD", "supplier_credits"].includes(charge.unit) || (charge.unit === "CNY" && charge.cnyPerUnit !== 1) ||
    !["estimated", "confirmed"].includes(charge.status) || typeof charge.rateDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(charge.rateDate) ||
    !Number.isFinite(Date.parse(charge.rateDate)) || new Date(charge.rateDate).toISOString().slice(0, 10) !== charge.rateDate ||
    [charge.rateSource, charge.receipt].some(value => typeof value !== "string" || !value.trim() || value.length > 2000)) throw new Error("INVALID_RESEARCH_CHARGE");
  // Round to 0.001 credit per charge; aggregate in integer milli-credits.
  const milliCredits = Math.round(charge.amount * charge.cnyPerUnit * 100_000);
  if (!Number.isSafeInteger(milliCredits)) throw new Error("INVALID_RESEARCH_CHARGE");
  return milliCredits / 1000;
}

export function researchCreditUsage(run: { calls: { paid: boolean; dispatch?: string; researchCharge?: ResearchCharge }[] }) {
  let confirmed = 0, estimated = 0, pendingCalls = 0;
  for (const call of run.calls) {
    if (!call.paid || call.dispatch === "NOT_SENT") continue;
    if (!call.researchCharge) { pendingCalls++; continue; }
    const value = Math.round(researchChargeCredits(call.researchCharge) * 1000);
    if (call.researchCharge.status === "confirmed") confirmed += value;
    else { estimated += value; pendingCalls++; }
    if (!Number.isSafeInteger(confirmed) || !Number.isSafeInteger(estimated)) throw new Error("INVALID_RESEARCH_CHARGE");
  }
  return { unit: "research_credits", rule: researchCreditRule, confirmed: confirmed / 1000, estimated: estimated / 1000,
    pendingCalls, total: pendingCalls ? null : confirmed / 1000 };
}
