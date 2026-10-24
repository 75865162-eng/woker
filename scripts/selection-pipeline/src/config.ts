import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { PipelineError } from "./io";
export type Config = {
  marketplace: "US"; keywords: string[]; negatives: string[]; bannedTerms: string[];
  priceMin: number; priceMax: number; minReviews: number; bsrMax: number;
  maxCompetitors: number; maxReviewsPerAsin: number; dailyRequestBudget: number;
  requestIntervalMs: number; concurrency: number; maxSuppliers: number; bestsellersUrl?: string;
};
export const pipelineRoot = path.resolve("scripts/selection-pipeline");
export async function loadConfig(file = path.join(pipelineRoot, "rulepack.example.yaml")): Promise<Config> {
  const value: unknown = parse(await readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PipelineError("INVALID_RULEPACK");
  const config = { marketplace: "US", keywords: [], negatives: [], bannedTerms: [], priceMin: 0, priceMax: 1000000, minReviews: 0, bsrMax: 10000000, maxCompetitors: 10, maxReviewsPerAsin: 20, dailyRequestBudget: 100, requestIntervalMs: 3000, concurrency: 1, maxSuppliers: 5, ...value } as Config;
  if (config.marketplace !== "US" || config.concurrency !== 1) throw new PipelineError("ONLY_US_SERIAL_COLLECTION_SUPPORTED");
  for (const key of ["keywords", "negatives", "bannedTerms"] as const) {
    if (!Array.isArray(config[key]) || config[key].some(v => typeof v !== "string")) throw new PipelineError("INVALID_RULEPACK_LIST");
  }
  for (const key of ["priceMin", "priceMax", "minReviews", "bsrMax", "maxCompetitors", "maxReviewsPerAsin", "dailyRequestBudget", "requestIntervalMs", "maxSuppliers"] as const) {
    if (typeof config[key] !== "number" || !Number.isFinite(config[key]) || config[key] < 0) throw new PipelineError("INVALID_RULEPACK_NUMBER");
  }
  for (const key of ["maxCompetitors", "maxReviewsPerAsin", "dailyRequestBudget", "maxSuppliers"] as const) {
    if (!Number.isInteger(config[key]) || config[key] > 1000) throw new PipelineError("INVALID_RULEPACK_LIMIT");
  }
  if (config.priceMax < config.priceMin || config.requestIntervalMs < 1000) throw new PipelineError("INVALID_RULEPACK_RANGE");
  if (config.bestsellersUrl) {
    const url = new URL(config.bestsellersUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.amazon.com") throw new PipelineError("INVALID_BESTSELLERS_URL");
  }
  return config;
}
export function selectionDir(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new PipelineError("INVALID_SLUG");
  return path.resolve("selections", slug);
}
