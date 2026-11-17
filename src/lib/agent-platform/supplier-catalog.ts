import type { AgentDefinition, AgentToolDefinition } from "./types";
import { supplierAgentId } from "./supplier-constants";

export const supplierToolAdapterId = "supplier-mcp-adapter";

export const supplierAgentDefinition: AgentDefinition = {
  id: supplierAgentId,
  name: "Supplier Agent",
  description: "Evaluate suppliers, draft RFQs, and turn product plans into sourcing-ready actions.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Supplier Agent for an Amazon commerce OS. Turn a validated product plan into supplier recommendations, quotation analysis, and RFQ drafts. Use the Tool Gateway only. Do not claim live supplier certainty when the evidence is synthetic or incomplete.",
  goals: [
    "Find suitable suppliers",
    "Analyze quotation history",
    "Draft RFQ requests",
    "Recommend supplier candidates",
    "Prepare sourcing project handoff",
  ],
  skills: [
    "supplier evaluation",
    "quotation analysis",
    "RFQ drafting",
    "lead time analysis",
    "sourcing project planning",
  ],
  tools: [
    "supplier.product.load",
    "supplier.database.search",
    "supplier.quotation.analyze",
    "supplier.recommendation.compose",
    "supplier.rfq.draft",
    "supplier.project.draft",
  ],
  permissions: [
    "supplier.read.product",
    "supplier.read.prd",
    "supplier.read.supplierDatabase",
    "supplier.read.quotation",
    "supplier.write.recommendation",
    "supplier.write.rfq",
    "supplier.write.projectDraft",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      prd: { type: "object" },
      productReport: { type: "object" },
      productHandoff: { type: "object" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      evidence: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "Sourcing drafts are read-oriented; project creation is approval-gated downstream.",
  },
  enabled: true,
};

export const supplierToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "supplier.product.load",
    name: "Load Product Context",
    description: "Normalize the selected PRD and product report into sourcing context.",
    inputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
        productReport: { type: "object" },
        productHandoff: { type: "object" },
        marketplace: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        prd: { type: "object" },
        productReport: { type: "object" },
        summary: { type: "string" },
      },
    },
    permission: ["supplier.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.database.search",
    name: "Supplier Database Search",
    description: "Search a synthetic supplier database for candidate factories and sourcing matches.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
      },
    },
    permission: ["supplier.read.supplierDatabase"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.quotation.analyze",
    name: "Quotation Analyze",
    description: "Analyze historical quotation patterns and landing cost implications.",
    inputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        quotations: { type: "array" },
      },
    },
    permission: ["supplier.read.quotation"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.recommendation.compose",
    name: "Supplier Recommendation",
    description: "Compose a supplier recommendation from database and quotation signals.",
    inputSchema: {
      type: "object",
      properties: {
        suppliers: { type: "array" },
        quotations: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        recommendations: { type: "array" },
      },
    },
    permission: ["supplier.write.recommendation"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.rfq.draft",
    name: "RFQ Draft",
    description: "Draft an RFQ for shortlisted suppliers.",
    inputSchema: {
      type: "object",
      properties: {
        recommendations: { type: "array" },
        prd: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        rfqDraft: { type: "object" },
      },
    },
    permission: ["supplier.write.rfq"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
  {
    toolId: "supplier.project.draft",
    name: "Supplier Project Draft",
    description: "Draft a sourcing project plan for human review.",
    inputSchema: {
      type: "object",
      properties: {
        rfqDraft: { type: "object" },
        recommendations: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        projectDraft: { type: "object" },
      },
    },
    permission: ["supplier.write.projectDraft"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: supplierToolAdapterId,
    enabled: true,
  },
];
