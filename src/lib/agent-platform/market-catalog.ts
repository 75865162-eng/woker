import type { AgentDefinition, AgentToolDefinition } from "./types";
import { selectionTool } from "./selection";
import { marketAgentId } from "./market-constants";

export const sellerSpriteToolAdapterId = "sellersprite-mcp-adapter";

export const marketAgentDefinition: AgentDefinition = {
  id: marketAgentId,
  name: "Market Intelligence Agent",
  description: "Discover Amazon market gaps and turn them into evidence-backed product opportunities.",
  version: "v1.0.0",
  systemInstructions:
    "You are the Market Intelligence Agent for an Amazon commerce OS. You only do read-oriented market research. Never invent evidence. Every important judgment must be backed by tool output, source, metric, and timestamp. Produce concise but traceable opportunities, then recommend human review before any downstream action.",
  goals: [
    "Find high-value Amazon market opportunities",
    "Quantify blue ocean attractiveness",
    "Expose evidence for every major judgment",
    "Produce product opportunities and research reports",
    "Hand off to humans before project creation",
  ],
  skills: [
    "market research",
    "keyword analysis",
    "competitor analysis",
    "review analysis",
    "opportunity scoring",
    "evidence synthesis",
  ],
  tools: [
    "market.selection.run",
    "sellersprite.market.search",
    "sellersprite.keyword.search",
    "sellersprite.category.analyze",
    "sellersprite.competitor.analyze",
    "sellersprite.review.analyze",
    "sellersprite.trend.analyze",
    "sellersprite.price.analyze",
    "sellersprite.sales.analyze",
    "sellersprite.competition.analyze",
  ],
  permissions: [
    "market.read.market",
    "market.read.keyword",
    "market.read.category",
    "market.read.competitor",
    "market.read.review",
    "market.read.trend",
    "market.read.price",
    "market.read.sales",
    "market.read.competition",
    "market.write.opportunity",
    "market.write.report",
  ],
  inputSchema: {
    type: "object",
    properties: {
      naturalLanguageGoal: { type: "string" },
      selectionRun: { type: "boolean" },
      selectionFileId: { type: "string" },
      marketplace: { type: "string" },
      keyword: { type: "string" },
      category: { type: "string" },
      asin: { type: "string" },
      priceRange: { type: "object" },
      salesRange: { type: "object" },
      reviewRange: { type: "object" },
      competition: { type: "string" },
      targetMargin: { type: "number" },
      productConstraints: { type: "array" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      report: { type: "object" },
      blueOceanRadar: { type: "object" },
      productOpportunities: { type: "array" },
    },
  },
  approvalPolicy: {
    requiredForRiskLevels: ["HIGH", "CRITICAL"],
    timeoutMinutes: 120,
    approverRoles: ["owner", "database_admin", "operations_manager", "operations_supervisor"],
    notes: "Market research is read-only. Approval is only required for later high-risk downstream actions.",
  },
  enabled: true,
};

export const marketToolDefinitions: AgentToolDefinition[] = [
  selectionTool,
  {
    toolId: "sellersprite.market.search",
    name: "SellerSprite Market Search",
    description: "Search market demand, crowding, price bands, and candidate ASINs for a given objective.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
        priceRange: { type: "object" },
        salesRange: { type: "object" },
        reviewRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        demandStrength: { type: "number" },
        competitionStrength: { type: "number" },
        entryBarrier: { type: "number" },
        candidateAsins: { type: "array" },
      },
    },
    permission: ["market.read.market"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.keyword.search",
    name: "SellerSprite Keyword Search",
    description: "Collect keyword volume, competition, and CPC signals.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        keywords: { type: "array" },
        keywordOpportunity: { type: "number" },
      },
    },
    permission: ["market.read.keyword"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.category.analyze",
    name: "SellerSprite Category Analyze",
    description: "Analyze category growth, concentration, and practical entry barriers.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        categoryGrowth: { type: "number" },
        concentration: { type: "number" },
        entryBarrier: { type: "number" },
      },
    },
    permission: ["market.read.category"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.competitor.analyze",
    name: "SellerSprite Competitor Analyze",
    description: "Summarize competitor pricing, review density, and differentiation gaps.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        competitors: { type: "array" },
        competitionStrength: { type: "number" },
        differentiationGaps: { type: "array" },
      },
    },
    permission: ["market.read.competitor"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.review.analyze",
    name: "SellerSprite Review Analyze",
    description: "Analyze review themes, pain points, and review barriers.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        asin: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        averageReviewCount: { type: "number" },
        reviewBarrier: { type: "number" },
        painPoints: { type: "array" },
      },
    },
    permission: ["market.read.review"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.trend.analyze",
    name: "SellerSprite Trend Analyze",
    description: "Analyze trend momentum, seasonality, and growth rate.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        trendScore: { type: "number" },
        momentum: { type: "number" },
        seasonality: { type: "string" },
      },
    },
    permission: ["market.read.trend"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.price.analyze",
    name: "SellerSprite Price Analyze",
    description: "Analyze price distribution, target band, and margin room.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        priceRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        priceBand: { type: "object" },
        marginPotential: { type: "number" },
        entryPrice: { type: "number" },
      },
    },
    permission: ["market.read.price"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.sales.analyze",
    name: "SellerSprite Sales Analyze",
    description: "Estimate sales velocity and demand strength.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
        salesRange: { type: "object" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        estimatedSales: { type: "number" },
        salesVelocity: { type: "number" },
        demandStrength: { type: "number" },
      },
    },
    permission: ["market.read.sales"],
    riskLevel: "LOW",
    timeout: 8000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 250,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
  {
    toolId: "sellersprite.competition.analyze",
    name: "SellerSprite Competition Analyze",
    description: "Analyze seller density, competition strength, and entry barrier.",
    inputSchema: {
      type: "object",
      properties: {
        marketplace: { type: "string" },
        keyword: { type: "string" },
        category: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        competitionStrength: { type: "number" },
        sellerDensity: { type: "number" },
        entryBarrier: { type: "number" },
      },
    },
    permission: ["market.read.competition"],
    riskLevel: "MEDIUM",
    timeout: 9000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 300,
      retryableErrors: ["TIMEOUT", "TEMPORARY_UNAVAILABLE"],
    },
    adapterId: sellerSpriteToolAdapterId,
    enabled: true,
  },
];
