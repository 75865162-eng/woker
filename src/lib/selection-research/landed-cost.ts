import type { CostBasis } from "./economics";

const fields = ["fob", "freight", "insurance", "brokerage", "warehouseInbound", "otherFees", "customsValue"] as const;
export type LandedCostField = typeof fields[number];
export interface TariffSource {
  evidenceIds: string[]; sourceUrl: string | null; applicableDate: string | null; note: string;
}
export interface LandedCostScenario {
  name: string; currency: string; originCountry: string; destinationCountry: string; asOf: string;
  quantity: number | null;
  classification: TariffSource & { code: string; status: "candidate" | "verified" };
  method: "ad_valorem_additive" | "unsupported";
  costs: Record<LandedCostField, number | null>;
  basis: Partial<Record<LandedCostField, CostBasis>>;
  rates: (TariffSource & { name: string; kind: "base" | "additional"; rate: number | null; status: "verified" | "pending" | "stress_test" })[];
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function sourceValid(source: TariffSource, verified: boolean) {
  if (!Array.isArray(source.evidenceIds) || source.evidenceIds.some(id => typeof id !== "string" || !id) || !source.note?.trim() ||
    source.sourceUrl !== null && (typeof source.sourceUrl !== "string" || !source.sourceUrl.startsWith("https://")) ||
    source.applicableDate !== null && !validDate(source.applicableDate)) throw new Error("INVALID_TARIFF_SOURCE");
  if (verified && (!source.evidenceIds.length || !source.sourceUrl || !source.applicableDate)) throw new Error("VERIFIED_TARIFF_SOURCE_REQUIRED");
}

/** Arithmetic is explicit and per-unit. Customs value is a tax basis, never added twice as a cost. */
export function calculateLandedCostScenario(scenario: LandedCostScenario) {
  if (!scenario?.name?.trim() || !/^[A-Z]{3}$/.test(scenario.currency) || !/^[A-Z]{2}$/.test(scenario.originCountry) || !/^[A-Z]{2}$/.test(scenario.destinationCountry) || !validDate(scenario.asOf) ||
    !["ad_valorem_additive", "unsupported"].includes(scenario.method) || !scenario.costs || !scenario.basis || !scenario.classification ||
    !/^[0-9]{4,10}(?:\.[0-9]{1,4})*$/.test(scenario.classification.code) || !["candidate", "verified"].includes(scenario.classification.status) ||
    !Array.isArray(scenario.rates) || !scenario.rates.length || scenario.rates.filter(rate => rate.kind === "base").length !== 1 || new Set(scenario.rates.map(rate => rate.name)).size !== scenario.rates.length ||
    scenario.quantity !== null && (!Number.isSafeInteger(scenario.quantity) || scenario.quantity <= 0)) throw new Error("INVALID_LANDED_COST_SCENARIO");
  sourceValid(scenario.classification, scenario.classification.status === "verified");
  if (scenario.classification.status === "verified" && scenario.classification.applicableDate! > scenario.asOf) throw new Error("INVALID_TARIFF_APPLICABILITY");
  const missing: string[] = [];
  for (const field of fields) {
    const value = scenario.costs[field];
    if (value === null) { missing.push(field); continue; }
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_LANDED_COST_INPUT");
    const basis = scenario.basis[field];
    if (!basis || !["observed", "supplier_quote", "estimated", "assumption"].includes(basis.kind) || !basis.note?.trim() || !Array.isArray(basis.evidenceIds) || ["observed", "supplier_quote"].includes(basis.kind) && !basis.evidenceIds.length) throw new Error("COST_BASIS_REQUIRED");
  }
  for (const rate of scenario.rates) {
    if (!rate.name?.trim() || !["base", "additional"].includes(rate.kind) || !["verified", "pending", "stress_test"].includes(rate.status) ||
      rate.rate !== null && (!Number.isFinite(rate.rate) || rate.rate < 0)) throw new Error("INVALID_TARIFF_RATE");
    sourceValid(rate, rate.status === "verified");
    if (rate.rate === null) missing.push(`rate:${rate.name}`);
    if (rate.status === "verified" && (rate.rate === null || rate.applicableDate! > scenario.asOf)) throw new Error("INVALID_TARIFF_APPLICABILITY");
  }
  if (scenario.method === "unsupported") missing.push("unsupported_tax_method");
  if (missing.length) return { status: "NEEDS_DATA" as const, missing, calculation: null };
  const value = scenario.costs as Record<LandedCostField, number>;
  const taxes = scenario.rates.map(rate => ({ name: rate.name, kind: rate.kind, status: rate.status, rate: rate.rate!, unitTax: value.customsValue * rate.rate! }));
  const baseDuty = taxes.filter(tax => tax.kind === "base").reduce((sum, tax) => sum + tax.unitTax, 0);
  const additionalDuty = taxes.filter(tax => tax.kind === "additional").reduce((sum, tax) => sum + tax.unitTax, 0);
  const unitLandedCost = value.fob + value.freight + value.insurance + baseDuty + additionalDuty + value.brokerage + value.warehouseInbound + value.otherFees;
  const batchLandedCost = scenario.quantity === null ? null : unitLandedCost * scenario.quantity;
  if (![baseDuty, additionalDuty, unitLandedCost, ...(batchLandedCost === null ? [] : [batchLandedCost])].every(Number.isFinite)) throw new Error("LANDED_COST_OVERFLOW");
  return { status: "SCENARIO_CALCULATED" as const, missing, calculation: { taxes, baseDuty, additionalDuty, unitLandedCost, batchLandedCost,
    hasUnverifiedInputs: scenario.classification.status !== "verified" || scenario.rates.some(rate => rate.status !== "verified") || fields.some(field => !["observed", "supplier_quote"].includes(scenario.basis[field]!.kind)),
    formulas: { duty: "customsValue * rate (rates are fractions; 10% = 0.10; additive, no compounding)", unit: "fob + freight + insurance + baseDuty + additionalDuty + brokerage + warehouseInbound + otherFees", batch: "unitLandedCost * quantity" },
    limitations: ["仅支持明确的从价税相加情景；不支持的从量税、复合税、抵扣或税率适用条件需另行核实", "结果未应用报关机构的法定舍入规则；情景算术不能证明税率当前有效"] } };
}

export function landedCostEvidenceIds(scenarios: LandedCostScenario[] = []) {
  return [...new Set(scenarios.flatMap(scenario => [
    ...scenario.classification.evidenceIds, ...scenario.rates.flatMap(rate => rate.evidenceIds),
    ...Object.values(scenario.basis).flatMap(basis => basis?.evidenceIds ?? []),
  ]))];
}
