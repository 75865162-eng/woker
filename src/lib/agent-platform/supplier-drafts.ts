import type { JsonObject } from "./types";
import type { SupplierRfQSection } from "./supplier-contracts";
import { isRecord } from "./supplier-values";

export function buildRfQDraft(snapshot: JsonObject, seed: number): SupplierRfQSection {
  const productName = String(
    snapshot.prd && isRecord(snapshot.prd) && typeof snapshot.prd.summary === "string"
      ? snapshot.prd.summary
      : "product concept",
  );
  const priceBandShift = seed % 2 === 0 ? "stable" : "tight";

  return {
    subject: `RFQ for ${productName}`,
    objective: "Request quotation, sample, lead time, and production capability details.",
    productSummary: `Validated product concept with differentiated requirements and ${priceBandShift} pricing guardrails.`,
    requiredCapabilities: [
      "Amazon-ready packaging",
      "Stable quality inspection",
      "Sample iteration support",
    ],
    targetPrice: "$5.00 - $5.50",
    targetLeadTime: "18-24 days",
    questions: [
      "What is the MOQ per SKU?",
      "What is the unit price at 500 / 1000 / 3000 pcs?",
      "What is the sample fee and lead time?",
      "Do you support custom packaging and insert cards?",
    ],
  };
}

export function buildProjectDraft(snapshot: JsonObject): {
  projectName: string;
  objective: string;
  stages: Array<{ name: string; goal: string; owner: string }>;
  nextStep: string;
  risks: string[];
} {
  const productName = String(
    snapshot.prd && isRecord(snapshot.prd) && typeof snapshot.prd.summary === "string"
      ? snapshot.prd.summary
      : "sourcing project",
  );

  return {
    projectName: `${productName} Sourcing Project`,
    objective: "Turn supplier recommendations into a sourcing-ready project for human review.",
    stages: [
      { name: "Supplier Shortlist", goal: "Select best-fit suppliers", owner: "Supplier" },
      { name: "RFQ Draft", goal: "Send structured RFQ to shortlisted suppliers", owner: "Supplier" },
      { name: "Quotation Review", goal: "Compare landed cost and lead time", owner: "Operations" },
      { name: "Approval Handoff", goal: "Move into human review and sourcing approval", owner: "Operations" },
    ],
    nextStep: "Review supplier shortlist and RFQ draft before approval.",
    risks: [
      "Quotation data is synthetic until validated",
      "MOQ may conflict with launch plan",
      "Lead time may vary after real supplier contact",
    ],
  };
}
