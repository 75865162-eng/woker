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

export type CostField = Exclude<keyof UnitEconomicsInput, "currency">;
export interface CostBasis {
  kind: "observed" | "supplier_quote" | "estimated" | "assumption";
  evidenceIds: string[];
  note: string;
}
export interface ResearchEconomicsScenario {
  name: string;
  input: { currency: string } & Record<CostField, number | null>;
  basis: Partial<Record<CostField, CostBasis>>;
  quantity: number | null;
  fixedCosts: number | null;
}
export interface ProductScorecard {
  candidateId: string;
  dimensions: { name: string; weight: number; score: number | null; evidenceIds: string[]; rationale: string }[];
}
export interface DecisionAnalysis { scenarios: ResearchEconomicsScenario[]; scorecards: ProductScorecard[] }
const costFields: CostField[] = ["price", "procurement", "internationalFreight", "importCharges", "referralFee", "fbaFee", "advertising", "storage", "returnsAllowance"];

/** Unknown costs remain unknown; incomplete inputs never turn into a profitable zero-cost scenario. */
export function evaluateResearchEconomics(scenario: ResearchEconomicsScenario) {
  if (!scenario?.name?.trim() || !scenario.input || !/^[A-Z]{3}$/.test(scenario.input.currency) || !scenario.basis) throw new Error("INVALID_ECONOMICS_SCENARIO");
  if (scenario.quantity !== null && (!Number.isSafeInteger(scenario.quantity) || scenario.quantity <= 0) ||
    scenario.fixedCosts !== null && (!Number.isFinite(scenario.fixedCosts) || scenario.fixedCosts < 0)) throw new Error("INVALID_BATCH_COSTS");
  const missing: CostField[] = [];
  for (const field of costFields) {
    const value = scenario.input[field];
    if (value === null) { missing.push(field); continue; }
    if (!Number.isFinite(value) || value < 0 || field === "price" && value === 0) throw new Error("INVALID_SCENARIO_COST");
    const basis = scenario.basis[field];
    if (!basis || !["observed", "supplier_quote", "estimated", "assumption"].includes(basis.kind) || !basis.note?.trim() || !Array.isArray(basis.evidenceIds) ||
      ["observed", "supplier_quote"].includes(basis.kind) && !basis.evidenceIds.length) throw new Error("COST_BASIS_REQUIRED");
  }
  if (missing.length) return { status: "NEEDS_DATA" as const, missing, calculation: null };
  const unit = calculateUnitEconomics(scenario.input as UnitEconomicsInput);
  const batchContribution = scenario.quantity === null ? null : unit.profit * scenario.quantity;
  const breakEvenUnits = scenario.fixedCosts === null || unit.profit <= 0 ? null : Math.ceil(scenario.fixedCosts / unit.profit);
  const calculation = { ...unit, contribution: unit.profit, contributionRate: unit.margin,
    breakEvenPrice: unit.totalCost, breakEvenUnits,
    batchLandedCost: scenario.quantity === null ? null : unit.landedCost * scenario.quantity,
    batchContribution, batchAfterFixedCosts: batchContribution === null || scenario.fixedCosts === null ? null : batchContribution - scenario.fixedCosts,
    formulas: { breakEvenUnits: "ceil(fixedCosts / unitContribution), only when unitContribution > 0", batchLandedCost: "landedCost * quantity", batchAfterFixedCosts: "unitContribution * quantity - fixedCosts" } };
  if (Object.values(calculation).some(value => typeof value === "number" && !Number.isFinite(value))) throw new Error("ECONOMICS_OVERFLOW");
  return { status: "CALCULATED" as const, missing, calculation };
}

/** Missing dimensions are never assigned a neutral score or silently reweighted. */
export function evaluateProductScorecard(card: ProductScorecard) {
  if (!card?.candidateId?.trim() || !Array.isArray(card.dimensions) || !card.dimensions.length || new Set(card.dimensions.map(row => row.name)).size !== card.dimensions.length) throw new Error("INVALID_SCORECARD");
  let weight = 0, observedWeight = 0, total = 0;
  for (const row of card.dimensions) {
    if (!row.name?.trim() || !row.rationale?.trim() || !Number.isFinite(row.weight) || row.weight <= 0 || row.weight > 1 || !Array.isArray(row.evidenceIds) ||
      row.score !== null && (!Number.isFinite(row.score) || row.score < 0 || row.score > 100 || !row.evidenceIds.length)) throw new Error("INVALID_SCORE_DIMENSION");
    weight += row.weight;
    if (row.score !== null) { observedWeight += row.weight; total += row.score * row.weight; }
  }
  if (Math.abs(weight - 1) > 1e-6) throw new Error("SCORE_WEIGHTS_MUST_SUM_TO_ONE");
  return { total: card.dimensions.some(row => row.score === null) ? null : total, observedWeight,
    missingDimensions: card.dimensions.filter(row => row.score === null).map(row => row.name), formula: "sum(weight * score), weights sum to 1; missing scores keep total unknown" };
}
