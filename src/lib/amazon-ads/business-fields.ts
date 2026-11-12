import type { AmazonAdsEntityRecord } from "@prisma/client";
import { amazonBusinessData } from "@/lib/amazon-sync/business-data";

/** Preserve all collected business fields; exact normalized decimals take priority. */
export function adsEntityBusinessFields(entity: AmazonAdsEntityRecord) {
  const payload = amazonBusinessData(entity.payload);
  const fields: Record<string, unknown> = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  for (const key of ["name", "campaignId", "adGroupId", "keywordText", "matchType", "targetingType", "expressionType"] as const) {
    if (entity[key] != null) fields[key] = entity[key];
  }
  if (entity.bid != null) {
    fields.bid = entity.bid.toFixed();
    if (entity.entityType === "SP:ad-group") fields.defaultBid = entity.bid.toFixed();
  }
  for (const key of ["startDate", "endDate"] as const) if (entity[key]) fields[key] = entity[key].toISOString().slice(0, 10);
  if (entity.budgetAmount != null || entity.budgetType != null) {
    const original = fields.budget && typeof fields.budget === "object" && !Array.isArray(fields.budget) ? fields.budget : {};
    fields.budget = { ...original, ...(entity.budgetAmount != null ? { budget: entity.budgetAmount.toFixed() } : {}), ...(entity.budgetType != null ? { budgetType: entity.budgetType } : {}) };
  }
  if (entity.targetingExpression != null) fields.targetingExpression = amazonBusinessData(entity.targetingExpression);
  return fields;
}
