import type { AgentToolAdapter, JsonObject, ToolExecutionInput, ToolExecutionResult } from "./types";
import { listingToolAdapterId } from "./listing-catalog";
import { toJsonValue, extractJsonObject, isRecord, normalizeStringArray, extractKeywordMap, extractTitleDraft, extractBulletDrafts, extractDescriptionDraft, extractAplusBrief, trimToLength } from "./listing-normalization";

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`NEEDS_DATA: ${field} 缺失，不能生成有依据的 Listing 草稿。`);
  return value.trim();
}

function requiredObject(value: unknown, field: string): JsonObject {
  if (!isRecord(value) || !Object.keys(value).length) throw new Error(`NEEDS_DATA: ${field} 缺失。`);
  return value as JsonObject;
}

function userProvidedDraft(toolId: string, input: JsonObject) {
  switch (toolId) {
    case "listing.product.load": {
      const product = requiredObject(input.productReport, "productReport");
      const summary = requiredText(product.summary, "productReport.summary");
      const keywords = requiredObject(input.sellerSpriteKeywords, "sellerSpriteKeywords（用户提供的关键词证据）");
      if (!normalizeStringArray(keywords.primaryKeywords).length) throw new Error("NEEDS_DATA: sellerSpriteKeywords.primaryKeywords 缺失。");
      return { summary, productReport: product, keywords, competitors: Array.isArray(input.competitors) ? input.competitors : [] };
    }
    case "listing.keyword.map": {
      requiredText(input.productSummary, "productSummary");
      const keywords = requiredObject(input.sellerSpriteKeywords, "sellerSpriteKeywords");
      const primaryKeywords = normalizeStringArray(keywords.primaryKeywords);
      if (!primaryKeywords.length) throw new Error("NEEDS_DATA: sellerSpriteKeywords.primaryKeywords 缺失。");
      const competitors = Array.isArray(input.competitors) ? input.competitors : [];
      return { keywordMap: {
        primaryKeywords, secondaryKeywords: normalizeStringArray(keywords.secondaryKeywords),
        longTailKeywords: normalizeStringArray(keywords.longTailKeywords),
        backendSearchTerms: normalizeStringArray(keywords.backendSearchTerms),
        competitorGaps: competitors.length ? normalizeStringArray(keywords.competitorGaps) : [],
        groups: [], notes: "仅整理用户提供的关键词；未进行搜索量、ASIN、竞品或转化表现核验。",
      } };
    }
    case "listing.title.draft": {
      const summary = requiredText(input.productSummary, "productSummary");
      const map = extractKeywordMap(requiredObject(input.keywordMap, "keywordMap"));
      const title = trimToLength([map.primaryKeywords[0], summary].filter(Boolean).join(" - "), 180);
      return { titleDraft: { title, characterCount: title.length, primaryKeywords: map.primaryKeywords, secondaryKeywords: map.secondaryKeywords, rationale: "用户提供内容的标题草稿，不代表市场效果。" } };
    }
    case "listing.bullet.draft": {
      const summary = requiredText(input.productSummary, "productSummary");
      const map = extractKeywordMap(requiredObject(input.keywordMap, "keywordMap"));
      return { bulletDrafts: [{ bullet: summary, keywordFocus: map.primaryKeywords, benefit: "待用户核实产品卖点", evidenceNotes: ["仅引用用户提供的产品摘要；不推断材质、功能、认证或竞品表现。"] }] };
    }
    case "listing.description.draft": {
      const summary = requiredText(input.productSummary, "productSummary");
      const map = extractKeywordMap(requiredObject(input.keywordMap, "keywordMap"));
      return { descriptionDraft: { summary, paragraphs: [summary], keywordCoverage: map.primaryKeywords, complianceNotes: ["用户提供内容，发布前核实产品事实。"] } };
    }
    case "listing.aplus.brief": {
      const summary = requiredText(input.productSummary, "productSummary");
      return { aplusBrief: { objective: `围绕用户提供的产品摘要组织待审阅内容：${summary}`, modules: [], imageStoryline: [], recommendations: ["补充经核实的产品图片、功能和对比证据后再制作 A+；不自动生成竞品优势事实。"] } };
    }
    case "listing.listing.draft": {
      const title = extractTitleDraft(requiredObject(input.titleDraft, "titleDraft"));
      requiredText(title.title, "titleDraft.title");
      if (!Array.isArray(input.bulletDrafts) || !input.bulletDrafts.length) throw new Error("NEEDS_DATA: bulletDrafts 缺失。");
      const bullets = extractBulletDrafts(input.bulletDrafts);
      const description = extractDescriptionDraft(requiredObject(input.descriptionDraft, "descriptionDraft"));
      const map = extractKeywordMap(requiredObject(input.keywordMap, "keywordMap"));
      return { listingDraft: { title: title.title, bullets: bullets.map((item) => item.bullet), description: description.paragraphs.join("\n\n"), backendSearchTerms: map.backendSearchTerms.join(", "), aplusBrief: extractAplusBrief(requiredObject(input.aplusBrief, "aplusBrief")), keywordMap: map, complianceNotes: ["USER_PROVIDED_DRAFT：仅使用用户提供内容，产品事实和关键词效果尚未独立核实。"], recommendation: "补充与核实产品证据后人工审阅；此结果不是发布或市场观测。", confidence: 0 } };
    }
    default:
      throw new Error(`不可用的 Listing 工具：${toolId}`);
  }
}

export function createListingMcpAdapter(clock: () => Date = () => new Date()): AgentToolAdapter {
  return {
    adapterId: listingToolAdapterId,
    async execute(input: ToolExecutionInput): Promise<ToolExecutionResult> {
      const startedAt = clock().getTime();
      return {
        output: toJsonValue({ ...userProvidedDraft(input.toolId, extractJsonObject(input.input)), source: "user-provided", dataStatus: "USER_PROVIDED_DRAFT", toolId: input.toolId, generatedAt: clock().toISOString() }),
        latencyMs: Math.max(clock().getTime() - startedAt, 1),
      };
    },
  };
}
