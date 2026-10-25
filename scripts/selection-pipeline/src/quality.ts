import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Draft, Review } from "./types";
import { PipelineError, readJson } from "./io";
import { validateSuppliers } from "./alibaba/search1688";

export function validateReviews(value: unknown, asins: Set<string>): Review[] {
  if (!Array.isArray(value) || value.length > 50_000) throw new PipelineError("INVALID_REVIEWS_FILE");
  const rows = value.map((row): Review => {
    if (!row || !asins.has(row.asin) || !/^[A-Z0-9]{10}$/.test(row.asin) || !Number.isInteger(row.star) || row.star < 1 || row.star > 3 ||
        typeof row.text !== "string" || !row.text.trim() || row.text.length > 240 || typeof row.date !== "string" || row.date.length > 100) {
      throw new PipelineError("INVALID_REVIEW_EXPECT_ASIN_STAR_1_TO_3_DATE_TEXT_MAX_240");
    }
    return { asin: row.asin, star: row.star, date: row.date, text: row.text.replace(/\s+/g, " ").trim() };
  });
  return [...new Map(rows.map(row => [JSON.stringify([row.asin, row.text]), row])).values()];
}

export async function loadReviews(dir: string, asins: string[]): Promise<Review[]> {
  const rows: Review[] = [];
  for (const asin of asins) {
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new PipelineError("INVALID_REVIEW_ASIN");
    const text = await readFile(path.join(dir, `raw/reviews/${asin}.jsonl`), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    rows.push(...validateReviews(text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line)), new Set([asin])));
  }
  return rows;
}

export function assessQuality(draft: Draft, input: {
  reviews: Review[]; localImageAsins: string[]; uploadedImageAsins: string[];
  requireUploadedImages: boolean; sourceFixture: boolean | undefined; errorCodes?: string[]; uploadWorkspaceId?: string;
}) {
  const reasons: Array<{ code: string; fallback: string }> = [];
  const asins = new Set(draft.competitors.map(c => c.asin));
  const validReviews = validateReviews(input.reviews, asins);
  const reviewKeys = new Set(validReviews.map(row => JSON.stringify([row.asin, row.text])));
  const validTags = new Set(draft.tags.matches.filter(tag => asins.has(tag.asin) && typeof tag.tag === "string" && tag.tag.trim() &&
    ["dictionary", "cloud"].includes(tag.source) && reviewKeys.has(JSON.stringify([tag.asin, tag.quote]))).map(tag => JSON.stringify([tag.asin, tag.tag, tag.quote])));
  const suppliers = validateSuppliers(draft.suppliers, 20);
  const fixtureSuppliers = suppliers.some(s => /\/offer\/10000000000[123]\.html$/.test(s.url) || s.shopName === "fixture-only");
  const local = new Set(input.localImageAsins.filter(asin => asins.has(asin)));
  const uploaded = new Set(input.uploadedImageAsins.filter(asin => local.has(asin)));
  if (draft.fixture || input.sourceFixture === true || fixtureSuppliers) reasons.push({ code: "FIXTURE_WRITE_FORBIDDEN", fallback: "使用全新非 fixture slug 和真实采集/人工证据；离线供应商不得用于采购或正式写库" });
  if (typeof input.sourceFixture !== "boolean") reasons.push({ code: "COLLECTION_SOURCE_UNKNOWN", fallback: "raw/collection-info.json（需真实采集来源记录）" });
  if (!draft.competitors.length) reasons.push({ code: "COMPETITORS_NEEDS_DATA", fallback: "raw/competitors.json" });
  if (!validReviews.length) reasons.push({ code: "REVIEWS_NEEDS_DATA", fallback: "raw/reviews/<ASIN>.jsonl；tag --reviews-file /absolute/path/reviews.jsonl" });
  if (!validTags.size) reasons.push({ code: "TAGS_NEEDS_DATA", fallback: "derived/tags.json；导入有效低星评论后重新 tag，必要时补充 --dictionary" });
  if (suppliers.length < 3) reasons.push({ code: "SUPPLIERS_NEEDS_DATA", fallback: "derived/suppliers.json；suppliers --suppliers-file /absolute/path/suppliers.json（至少 3 个不同真实商品链接）" });
  if (!local.size) reasons.push({ code: "IMAGES_NEEDS_DATA", fallback: "raw/images/（当前竞品清单内的实际本地图片）" });
  if (input.requireUploadedImages && (!uploaded.size || uploaded.size < local.size)) reasons.push({ code: "UPLOADED_IMAGES_NEEDS_DATA", fallback: "workbook --upload-images；检查 SELECTION_ERP_URL / SELECTION_ERP_COOKIE 与 products:edit 权限" });
  const missingMetrics = draft.competitors.filter(c => c.price == null || c.bsr == null || c.rating == null || c.reviewsCount == null).map(c => c.asin);
  const blockWrite = reasons.length > 0;
  return { schemaVersion: 1, status: blockWrite ? "NEEDS_DATA" : "READY_FOR_REVIEW", fixture: Boolean(draft.fixture || input.sourceFixture || fixtureSuppliers),
    competitors: asins.size, validReviews: validReviews.length, taggedQuotes: validTags.size, suppliers: suppliers.length, minimumSuppliers: 3,
    images: local.size, uploadedImages: uploaded.size, requireUploadedImages: input.requireUploadedImages,
    uploadWorkspaceId: input.uploadWorkspaceId, blockWrite, needsReview: blockWrite || missingMetrics.length > 0, missingMetrics, reasons,
    collectionReasonCodes: [...new Set(input.errorCodes ?? [])], salesEstimates: { heuristic: true, method: "uncalibrated_bsr_power_law", usableAsRealDemand: false } };
}
export type SelectionQuality = ReturnType<typeof assessQuality>;

export function assertWriteQuality(quality: SelectionQuality) {
  if (quality.blockWrite) throw new PipelineError(`QUALITY_BLOCK_WRITE: ${quality.reasons.map(reason => `${reason.code} -> ${reason.fallback}`).join("; ")}`);
}

/** Do not trust a previously generated quality.json. Recheck current files before any database import. */
export async function inspectQuality(dir: string, draft: Draft, requireUploadedImages = false, workspaceId?: string): Promise<SelectionQuality> {
  const root = await realpath(dir);
  const uploadWorkspaceId = workspaceId ?? draft.quality?.uploadWorkspaceId;
  const localImageAsins: string[] = [], uploadedImageAsins: string[] = [];
  const imageFiles = new Set<string>(), uploadIds = new Set<string>();
  for (const c of draft.competitors) {
    if (!c.imagePath || !/^raw\/images\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp)$/.test(c.imagePath)) continue;
    try {
      const file = await realpath(path.join(root, c.imagePath));
      const info = await stat(file);
      if (imageFiles.has(file) || !file.startsWith(root + path.sep) || !info.isFile() || !info.size || info.size > 10 * 1024 * 1024) continue;
      const metadata = await sharp(file, { limitInputPixels: 25_000_000 }).metadata().catch(() => null);
      if (!metadata || !["jpeg", "png", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height) continue;
      imageFiles.add(file);
      localImageAsins.push(c.asin);
      if (c.imageFileId && c.imageAsset?.id === c.imageFileId && c.imageAsset.originalUrl && (!uploadWorkspaceId || c.imageUploadWorkspaceId === uploadWorkspaceId) && !uploadIds.has(c.imageFileId)) { uploadedImageAsins.push(c.asin); uploadIds.add(c.imageFileId); }
    } catch (error) { if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  const provenance = await readJson<{ fixture?: boolean; uploadImages?: boolean }>(path.join(root, "raw/collection-info.json")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return { fixture: undefined, uploadImages: undefined }; });
  const errors = await readFile(path.join(root, "raw/errors.log"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; return ""; });
  const errorCodes = errors.split("\n").filter(Boolean).flatMap(line => { try { const row = JSON.parse(line); return typeof row.code === "string" ? [row.code] : []; } catch { return []; } });
  return assessQuality(draft, { reviews: await loadReviews(root, draft.competitors.map(c => c.asin)), localImageAsins, uploadedImageAsins,
    requireUploadedImages: requireUploadedImages || provenance.uploadImages === true || draft.quality?.requireUploadedImages === true, sourceFixture: provenance.fixture, errorCodes, uploadWorkspaceId });
}
