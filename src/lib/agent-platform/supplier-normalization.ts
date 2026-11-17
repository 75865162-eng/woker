import { isRecord, clampScore, normalizeStringArray, extractJsonObject, toJsonValue } from "./supplier-values";
import type { JsonObject, JsonValue } from "./types";
import type { ProductDevelopmentReport, ProductHandoffPayload, ProductPrdSection } from "./product";
import type { SupplierExecutionRequest, SupplierRecommendation, SupplierQuotation, SupplierRfQSection } from "./supplier-contracts";
import { buildRfQDraft, buildProjectDraft } from "./supplier-drafts";

export function normalizeSupplierExecutionInput(request: SupplierExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const productHandoff = extractJsonObject(toJsonValue(request.productHandoff ?? currentData.productHandoff));
  const productReport = extractJsonObject(toJsonValue(request.productReport ?? currentData.productReport));
  const prd = extractPrdObject(request.prd ?? currentData.prd);

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? prd?.summary ?? "Turn the product plan into supplier recommendations."),
    marketplace: String(request.marketplace ?? productReport.marketplace ?? productHandoff.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    category: String(request.category ?? productReport.category ?? productHandoff.category ?? currentData.category ?? "general"),
    prd,
    productReport,
    productHandoff: Object.keys(productHandoff).length ? (productHandoff as unknown as ProductHandoffPayload) : null,
    currentSkuContext: request.currentSkuContext ?? currentData ?? null,
  };
}

export function summarizeProduct(prd: ProductPrdSection | JsonObject | null, report: ProductDevelopmentReport | JsonObject | null) {
  if (isRecord(prd) && typeof prd.summary === "string") return prd.summary;
  if (isRecord(report) && typeof report.summary === "string") return report.summary;
  return "No product context supplied.";
}

export function extractSupplierRecommendations(value: JsonValue | undefined): SupplierRecommendation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const suppliers = Array.isArray(record.suppliers) ? record.suppliers : [];

  return suppliers
    .map((item): SupplierRecommendation | null => {
      if (!isRecord(item)) return null;
      return {
        supplierId: String(item.supplierId ?? item.id ?? "supplier"),
        supplierName: String(item.supplierName ?? item.name ?? "Supplier"),
        summary: String(item.summary ?? "Supplier candidate"),
        strengths: normalizeStringArray(item.strengths),
        risks: normalizeStringArray(item.risks),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
      };
    })
    .filter((item): item is SupplierRecommendation => Boolean(item));
}

export function extractSupplierQuotations(value: JsonValue | undefined): SupplierQuotation[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const quotations = Array.isArray(record.quotations) ? record.quotations : [];

  return quotations
    .map((item): SupplierQuotation | null => {
      if (!isRecord(item)) return null;
      return {
        supplierId: String(item.supplierId ?? "supplier"),
        supplierName: String(item.supplierName ?? "Supplier"),
        contactName: String(item.contactName ?? "Contact"),
        contactEmail: String(item.contactEmail ?? "sales@example.com"),
        contactPhone: typeof item.contactPhone === "string" ? item.contactPhone : undefined,
        moq: String(item.moq ?? "-"),
        unitPrice: String(item.unitPrice ?? "-"),
        shippingEstimate: String(item.shippingEstimate ?? "-"),
        leadTime: String(item.leadTime ?? "-"),
        sampleCost: String(item.sampleCost ?? "-"),
        notes: String(item.notes ?? ""),
        score: item.score === null ? null : typeof item.score === "number" ? clampScore(item.score) : 70,
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
      };
    })
    .filter((item): item is SupplierQuotation => Boolean(item));
}

export function extractSupplierRecommendationItems(
  value: JsonValue | undefined,
  suppliers: SupplierRecommendation[],
  quotations: SupplierQuotation[],
): SupplierRecommendation[] {
  const extracted = extractSupplierRecommendations(value);
  if (extracted.length) return extracted;
  return suppliers.length ? suppliers : quotations.map((quotation) => ({
    supplierId: quotation.supplierId,
    supplierName: quotation.supplierName,
    summary: quotation.notes,
    strengths: ["Quotation available"],
    risks: ["Synthetic quotation requires validation"],
    confidence: quotation.score === null ? 0 : quotation.score / 100,
  }));
}

export function extractRfQSection(value: JsonValue | undefined): SupplierRfQSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildRfQDraft({}, 0);
  }

  const record = value as Record<string, unknown>;

  return {
    subject: String(record.subject ?? "RFQ"),
    objective: String(record.objective ?? "Request quotation"),
    productSummary: String(record.productSummary ?? "Product summary"),
    requiredCapabilities: normalizeStringArray(record.requiredCapabilities),
    targetPrice: String(record.targetPrice ?? "$5.00 - $5.50"),
    targetLeadTime: String(record.targetLeadTime ?? "18-24 days"),
    questions: normalizeStringArray(record.questions),
  };
}

export function extractProjectDraft(value: JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildProjectDraft({});
  }

  const record = value as Record<string, unknown>;

  return {
    projectName: String(record.projectName ?? "Sourcing Project"),
    objective: String(record.objective ?? "Draft sourcing project"),
    stages: Array.isArray(record.stages)
      ? (record.stages as unknown[]).map((item) => {
          const stage = isRecord(item) ? item : {};
          return {
            name: String(stage.name ?? "Stage"),
            goal: String(stage.goal ?? "Define stage goal"),
            owner: String(stage.owner ?? "Supplier"),
          };
        })
      : [],
    nextStep: String(record.nextStep ?? "Review sourcing project"),
    risks: normalizeStringArray(record.risks),
  };
}

export function extractPrdObject(value: unknown): ProductPrdSection | null {
  if (!isRecord(value)) return null;
  return {
    summary: String(value.summary ?? "PRD"),
    userProblem: String(value.userProblem ?? "Problem"),
    targetCustomer: String(value.targetCustomer ?? "Customer"),
    mustHave: normalizeStringArray(value.mustHave),
    shouldHave: normalizeStringArray(value.shouldHave),
    acceptanceCriteria: normalizeStringArray(value.acceptanceCriteria),
    launchRisks: normalizeStringArray(value.launchRisks),
  };
}
