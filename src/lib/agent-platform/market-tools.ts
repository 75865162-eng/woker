import type { AgentToolAdapter, JsonValue, ToolExecutionResult } from "./types";
import { toPublicSellerSpriteMcpSettings, validateSellerSpriteMcpSettings, type SellerSpriteMcpSettings } from "@/lib/integrations/sellersprite";
import { sellerSpriteToolAdapterId } from "./market-catalog";
import { toJsonValue, extractJsonObject } from "./market-normalization";

export function createSellerSpriteMcpAdapter(
  options: (() => Date) | { settings?: SellerSpriteMcpSettings; clock?: () => Date } = {},
): AgentToolAdapter {
  const settings = typeof options === "function" ? undefined : options.settings;

  return {
    adapterId: sellerSpriteToolAdapterId,
    async execute(): Promise<ToolExecutionResult> {
      if (!settings?.enabled) {
        throw {
          code: "SELLERSPRITE_MCP_NOT_CONFIGURED",
          message: "SellerSprite MCP is disabled or has no saved configuration.",
          retryable: false,
        };
      }
      const validationError = validateSellerSpriteMcpSettings(settings);
      if (validationError) {
        throw {
          code: "SELLERSPRITE_MCP_NOT_CONFIGURED",
          message: validationError,
          retryable: false,
          detail: toPublicSellerSpriteMcpSettings(settings),
        };
      }
      throw {
        code: "SELLERSPRITE_MCP_TRANSPORT_UNAVAILABLE",
        message: "The configured SellerSprite MCP server is not connected to a real market-data executor. Research has been stopped; no synthetic data was generated.",
        retryable: false,
      };
    },
  };
}

export function trackToolUsage(toolId: string, result: { status: string; output?: JsonValue; error?: unknown; approval?: unknown; latencyMs?: number; toolCall?: { id?: string; riskLevel?: string } }) {
  return {
    toolId,
    status: result.status,
    output: result.output,
    error: toJsonValue(result.error),
    approval: toJsonValue(result.approval),
    latencyMs: result.latencyMs,
    toolCallId: result.toolCall?.id,
    riskLevel: result.toolCall?.riskLevel,
  };
}

export function assertMarketToolResponse(
  toolId: string,
  result: { status: string; output?: JsonValue; error?: unknown },
  request: Record<string, unknown>,
) {
  if (result.status !== "SUCCEEDED") {
    const error = result.error && typeof result.error === "object" ? result.error as { code?: string; message?: string } : undefined;
    throw {
      code: error?.code ?? "MARKET_DATA_UNAVAILABLE",
      message: error?.message ?? `Market tool ${toolId} did not return real data; research has been stopped.`,
      retryable: false,
    };
  }

  const output = extractJsonObject(result.output);
  if (!Object.keys(output).length) {
    throw { code: "MARKET_DATA_INVALID_RESPONSE", message: `Market tool ${toolId} returned an empty or non-object response.`, retryable: false };
  }
  if (containsSimulationMarker(output)) {
    throw { code: "MARKET_DATA_SIMULATED_RESPONSE", message: `Market tool ${toolId} returned a sample, fixture, or simulated response.`, retryable: false };
  }

  for (const key of ["marketplace", "keyword", "category", "asin"]) {
    const expected = typeof request[key] === "string" ? String(request[key]).trim().toLocaleLowerCase() : "";
    const actual = typeof output[key] === "string" ? output[key].trim().toLocaleLowerCase() : "";
    if (expected && actual && (key === "marketplace" ? expected !== actual : !actual.includes(expected) && !expected.includes(actual))) {
      throw { code: "MARKET_DATA_RESPONSE_MISMATCH", message: `Market tool ${toolId} returned ${key}=${String(output[key])} for requested ${String(request[key])}.`, retryable: false };
    }
  }

  const required: Record<string, Record<string, "number" | "array" | "object" | "string">> = {
    "sellersprite.market.search": { demandStrength: "number", competitionStrength: "number", entryBarrier: "number", candidateAsins: "array" },
    "sellersprite.keyword.search": { keywordOpportunity: "number", keywords: "array" },
    "sellersprite.category.analyze": { categoryGrowth: "number", concentration: "number", entryBarrier: "number" },
    "sellersprite.competitor.analyze": { competitionStrength: "number", competitors: "array", differentiationGaps: "array" },
    "sellersprite.review.analyze": { averageReviewCount: "number", reviewBarrier: "number", painPoints: "array" },
    "sellersprite.trend.analyze": { trendScore: "number", momentum: "number", seasonality: "string" },
    "sellersprite.price.analyze": { priceBand: "object", marginPotential: "number", entryPrice: "number" },
    "sellersprite.sales.analyze": { estimatedSales: "number", salesVelocity: "number", demandStrength: "number" },
    "sellersprite.competition.analyze": { competitionStrength: "number", sellerDensity: "number", entryBarrier: "number" },
  };
  for (const [field, type] of Object.entries(required[toolId] ?? {})) {
    const value = output[field];
    const valid = type === "array"
      ? Array.isArray(value) && value.length > 0
      : type === "object"
        ? Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length)
        : type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === "string" && Boolean(value.trim());
    if (!valid) {
      throw { code: "MARKET_DATA_SCHEMA_MISMATCH", message: `Market tool ${toolId} returned missing or invalid ${field}.`, retryable: false };
    }
  }
}

export function containsSimulationMarker(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSimulationMarker);
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (["sample", "sandbox", "fixture", "mock", "synthetic", "simulated"].includes(key.toLowerCase()) && item === true) return true;
    if (["dataMode", "environment", "sourceType"].includes(key) && typeof item === "string" && /sandbox|fixture|mock|synthetic|sample/i.test(item)) return true;
    if (containsSimulationMarker(item)) return true;
  }
  return false;
}
