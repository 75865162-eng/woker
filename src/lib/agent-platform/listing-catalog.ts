import type { AgentDefinition, AgentToolDefinition } from "./types";
import { listingAgentId } from "./listing-constants";

export const listingToolAdapterId = "listing-mcp-adapter";

export const listingAgentDefinition: AgentDefinition = {
  id: listingAgentId,
  name: "Listing Agent",
  description: "Turn product plans and keyword evidence into keyword maps, title, bullets, description, and A+ brief drafts.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Listing Agent for an Amazon commerce OS. Turn a validated product plan, keyword signals, and competitor evidence into a keyword map, title, bullet points, description, A+ brief, and listing draft. Use the Tool Gateway only. Never claim keyword certainty without evidence.",
  goals: [
    "Build keyword maps from product and market evidence",
    "Draft SEO-aware listing copy",
    "Compose title, bullet points, and description",
    "Prepare A+ brief and listing draft",
    "Hand off for human approval before publication",
  ],
  skills: [
    "keyword mapping",
    "Amazon SEO copy",
    "competitive positioning",
    "listing drafting",
    "A+ planning",
  ],
  tools: [
    "listing.product.load",
    "listing.keyword.map",
    "listing.title.draft",
    "listing.bullet.draft",
    "listing.description.draft",
    "listing.aplus.brief",
    "listing.listing.draft",
  ],
  permissions: [
    "listing.read.product",
    "listing.read.keywords",
    "listing.read.competitors",
    "listing.write.keywordMap",
    "listing.write.title",
    "listing.write.bullets",
    "listing.write.description",
    "listing.write.aplus",
    "listing.write.listingDraft",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      marketplace: { type: "string" },
      category: { type: "string" },
      productOpportunity: { type: "object" },
      marketReport: { type: "object" },
      productReport: { type: "object" },
      productHandoff: { type: "object" },
      sellerSpriteKeywords: { type: "object" },
      competitors: { type: "object" },
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
    notes: "Listing drafts are approval-gated before publication.",
  },
  enabled: true,
};

export const listingToolDefinitions: AgentToolDefinition[] = [
  {
    toolId: "listing.product.load",
    name: "Load Product Listing Context",
    description: "Normalize product, market, keyword, and competitor context for listing drafting.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
        productReport: { type: "object" },
        marketReport: { type: "object" },
        productOpportunity: { type: "object" },
        sellerSpriteKeywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        keywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    permission: ["listing.read.product"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.keyword.map",
    name: "Keyword Map Builder",
    description: "Build a keyword map with title, bullets, description, backend, and A+ placements.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        sellerSpriteKeywords: { type: "object" },
        competitors: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        keywordMap: { type: "object" },
      },
    },
    permission: ["listing.read.keywords", "listing.read.competitors", "listing.write.keywordMap"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.title.draft",
    name: "Title Draft",
    description: "Draft an Amazon listing title using primary and secondary keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        titleDraft: { type: "object" },
      },
    },
    permission: ["listing.write.title"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.bullet.draft",
    name: "Bullet Draft",
    description: "Draft benefit-led bullets with evidence-aware keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
        titleDraft: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        bulletDrafts: { type: "array" },
      },
    },
    permission: ["listing.write.bullets"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.description.draft",
    name: "Description Draft",
    description: "Draft the product description and compliance-safe keyword coverage.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        bulletDrafts: { type: "array" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        descriptionDraft: { type: "object" },
      },
    },
    permission: ["listing.write.description"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.aplus.brief",
    name: "A+ Brief Draft",
    description: "Draft the A+ content brief and visual storyline.",
    inputSchema: {
      type: "object",
      properties: {
        productSummary: { type: "string" },
        keywordMap: { type: "object" },
        bulletDrafts: { type: "array" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        aplusBrief: { type: "object" },
      },
    },
    permission: ["listing.write.aplus"],
    riskLevel: "LOW",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
  {
    toolId: "listing.listing.draft",
    name: "Listing Draft",
    description: "Assemble title, bullets, description, backend terms, and A+ brief into a listing draft.",
    inputSchema: {
      type: "object",
      properties: {
        titleDraft: { type: "object" },
        bulletDrafts: { type: "array" },
        descriptionDraft: { type: "object" },
        aplusBrief: { type: "object" },
        keywordMap: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        listingDraft: { type: "object" },
      },
    },
    permission: ["listing.write.listingDraft"],
    riskLevel: "MEDIUM",
    timeout: 5000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 200,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: listingToolAdapterId,
    enabled: true,
  },
];
