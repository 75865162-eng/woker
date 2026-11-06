export interface UnitEconomicsInput {
  currency: string; price: number; procurement: number; internationalFreight: number; importCharges: number;
  referralFee: number; fbaFee: number; advertising: number; storage: number; returnsAllowance: number;
}
/** All inputs must be explicit, in one currency and per unit. No default tax/FBA/ad rates. */
export function calculateUnitEconomics(input: UnitEconomicsInput) {
  if (!/^[A-Z]{3}$/.test(input.currency) || !Number.isFinite(input.price) || input.price <= 0) throw new Error("INVALID_ECONOMICS_PRICE_OR_CURRENCY");
  const costs = [input.procurement, input.internationalFreight, input.importCharges, input.referralFee, input.fbaFee, input.advertising, input.storage, input.returnsAllowance];
  if (costs.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("ALL_UNIT_COSTS_MUST_BE_EXPLICIT");
  const landedCost = input.procurement + input.internationalFreight + input.importCharges;
  const totalCost = costs.reduce((sum, value) => sum + value, 0);
  const profit = input.price - totalCost;
  return { landedCost, totalCost, profit, margin: profit / input.price, breakEvenAdvertising: input.price - (totalCost - input.advertising), formula: "profit = price - procurement - internationalFreight - importCharges - referralFee - fbaFee - advertising - storage - returnsAllowance" };
}
