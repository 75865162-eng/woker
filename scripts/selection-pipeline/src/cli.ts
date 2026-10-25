import { parseArgs } from "node:util";
import path from "node:path";
import { mkdir, readFile, writeFile, copyFile, open } from "node:fs/promises";
import { chromium, type Page } from "@playwright/test";
import { loadConfig, pipelineRoot, selectionDir, type Config } from "./config";
import { log, PipelineError, readJson, recordError, writeJson } from "./io";
import type { Brief, Competitor, Draft, Review, Supplier } from "./types";
import { SnapshotStore } from "./snapshot/store";
import { RateLimit } from "./amazon/rateLimit";
import { search, parseSearch } from "./amazon/search";
import { pdp, parsePdp } from "./amazon/pdp";
import { reviews, parseReviews } from "./amazon/reviews";
import { bestsellers } from "./amazon/bestsellers";
import { downloadImage } from "./images/download";
import { uploadImage } from "./images/upload";
import { loadDictionary, applyDict, aggregateTags } from "./tags/applyDict";
import { cloudPatch } from "./tags/cloudPatch";
import { search1688, validateSuppliers } from "./alibaba/search1688";
import { buildDraft } from "./workbook/buildDraft";
import { rebuildWorkbook } from "./local-workbook";
import { assertWriteQuality, inspectQuality, loadReviews, validateReviews } from "./quality";

const parsed = parseArgs({ args: process.argv.slice(2).filter(v => v !== "--"), allowPositionals: true, options: {
  keyword: { type: "string" }, slug: { type: "string" }, config: { type: "string" },
  write: { type: "boolean", default: false }, "cloud-patch": { type: "boolean", default: false },
  "reviews-file": { type: "string" }, "suppliers-file": { type: "string" }, "workspace-id": { type: "string", default: "default" },
  fixtures: { type: "boolean", default: false }, "upload-images": { type: "boolean", default: false },
  dictionary: { type: "string" }, help: { type: "boolean", default: false },
} });
const opts = parsed.values;
const command = parsed.positionals[0] ?? "run";
const fixture = (name: string) => path.join(pipelineRoot,"fixtures",name);
function passes(c: Competitor, config: Config) {
  const title = c.title.toLowerCase();
  return ![...config.negatives,...config.bannedTerms].some(t => title.includes(t.toLowerCase()))
    && (c.price === null || c.price >= config.priceMin && c.price <= config.priceMax)
    && (c.reviewsCount === null || c.reviewsCount >= config.minReviews)
    && (c.bsr == null || c.bsr <= config.bsrMax);
}
async function setFixture(page: Page, name: string) { await page.setContent(await readFile(fixture(name),"utf8")); }
async function collect(dir: string, brief: Brief, config: Config) {
  const store = new SnapshotStore(path.join(pipelineRoot, opts.fixtures ? "data/fixture.sqlite" : "data/selection.sqlite"));
  await store.init();
  await writeJson(path.join(dir,"raw/collection-info.json"), { fixture: opts.fixtures, uploadImages: Boolean(opts["upload-images"]) });
  const limit = new RateLimit(store,config.requestIntervalMs,config.dailyRequestBudget);
  const competitors: Competitor[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "en-US" });
    // Count only explicit data requests; block subresources rather than silently spending budget.
    await context.route("**/*", async route => {
      if (route.request().isNavigationRequest() && route.request().frame() === route.request().frame().page().mainFrame()) await route.continue();
      else await route.abort();
    });
    const page = await context.newPage();
    let found: Competitor[] = [];
    try {
      if (opts.fixtures) { await setFixture(page,"search.html"); found = await parseSearch(page); }
      else for (const keyword of [...new Set([brief.keyword,...config.keywords])]) found.push(...await search(page,keyword,limit));
    } catch (error) { await recordError(dir,"search",error); }
    if (config.bestsellersUrl && !opts.fixtures) {
      try { found.push(...await bestsellers(page,config.bestsellersUrl,limit)); }
      catch (error) { await recordError(dir,"bestsellers",error); }
    }
    if (!found.length) {
      await recordError(dir,"search",new PipelineError("EMPTY_SEARCH_OR_LAYOUT_CHANGED"));
      await writeFile(path.join(dir,"raw/search-empty.html"),(await page.content()).slice(0,2000000));
    }
    const unique = [...new Map(found.map(c => [c.asin,c])).values()].filter(c => passes(c,config));
    for (const candidate of unique.slice(0,config.maxCompetitors)) {
      let c = candidate;
      try {
        let detail: Partial<Competitor>;
        if (opts.fixtures) { await setFixture(page,"pdp.html"); detail = await parsePdp(page); }
        else detail = await pdp(page,c.asin,limit);
        if (!detail.title) throw new PipelineError("PDP_LAYOUT_UNRECOGNIZED");
        c = { ...c,...detail, price: detail.price ?? c.price, rating: detail.rating ?? c.rating, reviewsCount: detail.reviewsCount ?? c.reviewsCount, capturedAt: new Date().toISOString() };
        await store.capture(c);
        if (!passes(c,config)) { log("competitor_filtered",{ asin: c.asin }); continue; }
      } catch (error) { await recordError(dir,"pdp",error,c.asin); continue; }
      await mkdir(path.join(dir,"raw/reviews"),{ recursive: true });
      await writeFile(path.join(dir,`raw/reviews/${c.asin}.jsonl`), "");
      try {
        let rows: Review[];
        if (opts.fixtures) { await setFixture(page,"reviews.html"); rows = (await parseReviews(page,c.asin)).slice(0,config.maxReviewsPerAsin); }
        else rows = await reviews(page,c.asin,config.maxReviewsPerAsin,limit);
        await mkdir(path.join(dir,"raw/reviews"),{ recursive: true });
        await writeFile(path.join(dir,`raw/reviews/${c.asin}.jsonl`),rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
      } catch (error) { await recordError(dir,"reviews",error,c.asin); }
      try {
        if (opts.fixtures) {
          await mkdir(path.join(dir,"raw/images"),{ recursive: true });
          await copyFile(fixture("product.jpg"),path.join(dir,`raw/images/${c.asin}.jpg`));
          c.imagePath = `raw/images/${c.asin}.jpg`;
        } else if (c.mainImageUrl) c.imagePath = await downloadImage(c.mainImageUrl,c.asin,dir,limit);
        if (c.imagePath && opts["upload-images"] && command === "collect" && !opts.fixtures) {
          const asset = await uploadImage(path.join(dir,c.imagePath),opts["workspace-id"]!);
          if (asset) { c.imageAsset = asset; c.imageFileId = asset.id; c.imageUploadWorkspaceId = opts["workspace-id"]!; }
          else log("image_upload_skipped",{ reason: "ERP_URL_OR_COOKIE_NOT_CONFIGURED", asin: c.asin });
        }
      } catch (error) { await recordError(dir,"image",error,c.asin); }
      competitors.push(c);
      await writeJson(path.join(dir,"raw/competitors.json"),competitors);
      log("competitor_collected",{ asin: c.asin });
    }
  } finally { limit.close(); await browser.close(); }
  await writeJson(path.join(dir,"raw/competitors.json"),competitors);
  log("collection_complete",{ count: competitors.length, fixture: opts.fixtures });
}
async function tag(dir: string) {
  const competitors = await readJson<Competitor[]>(path.join(dir,"raw/competitors.json"));
  const asins = new Set(competitors.map(c => c.asin));
  if (opts["reviews-file"]) {
    const input = await readFile(opts["reviews-file"], "utf8");
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new PipelineError("REVIEWS_FILE_TOO_LARGE_MAX_2MB");
    const imported = validateReviews(input.split("\n").filter(line => line.trim()).map(line => JSON.parse(line)), asins);
    if (!imported.length) throw new PipelineError("REVIEWS_NEEDS_DATA");
    for (const asin of new Set(imported.map(row => row.asin))) {
      const file = path.join(dir, `raw/reviews/${asin}.jsonl`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, imported.filter(row => row.asin === asin).map(row => JSON.stringify(row)).join("\n") + "\n");
    }
  }
  const rows = await loadReviews(dir, [...asins]);
  if (!rows.length) await recordError(dir, "reviews", new PipelineError("REVIEWS_NEEDS_DATA"));
  const dictionary = await loadDictionary(opts.dictionary ?? path.join(pipelineRoot,"src/tags/dictionary.yaml"));
  const result = applyDict(rows,dictionary);
  if (opts["cloud-patch"]) {
    try { result.matches.push(...await cloudPatch(result.unmatched)); }
    catch (error) { await recordError(dir,"cloud_patch",error); }
  }
  await writeJson(path.join(dir,"derived/tags.json"),aggregateTags(result.matches));
  if (!result.matches.length) await recordError(dir, "tags", new PipelineError("TAGS_NEEDS_DATA"));
  log("tag_complete",{ reviews: rows.length, unmatched: result.unmatched.length, cloudEnabled: opts["cloud-patch"] });
}
async function suppliers(dir: string, brief: Brief, config: Config) {
  let rows: Supplier[] = [];
  if (opts["suppliers-file"]) rows = validateSuppliers(await readJson<unknown>(opts["suppliers-file"]),config.maxSuppliers);
  else if (opts.fixtures) rows = validateSuppliers(await readJson<unknown>(fixture("suppliers.json")),config.maxSuppliers);
  else {
    const store = new SnapshotStore(path.join(pipelineRoot,"data/selection.sqlite")); await store.init();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const limit = new RateLimit(store,config.requestIntervalMs,config.dailyRequestBudget);
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ locale: "zh-CN" });
      let resourceErrorRecorded = false;
      await page.route("**/*", async route => {
        const request = route.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) { await route.continue(); return; }
        const host = new URL(request.url()).hostname;
        const allowed = ["1688.com","alicdn.com","alibaba.com"].some(domain => host === domain || host.endsWith(`.${domain}`));
        if (!allowed || !["script","xhr","fetch"].includes(request.resourceType())) { await route.abort(); return; }
        try { await limit.reserve(); await route.continue(); }
        catch (error) {
          if (!resourceErrorRecorded) { resourceErrorRecorded = true; await recordError(dir,"supplier_resource",error); }
          await route.abort().catch(() => {});
        }
      });
      rows = await search1688(page,brief.solutionKeywords?.join(" ") || brief.keyword,config.maxSuppliers,limit);
    } catch (error) { await recordError(dir,"suppliers",error); }
    finally { limit.close(); await browser?.close(); }
  }
  await writeJson(path.join(dir,"derived/suppliers.json"),rows);
  log("suppliers_complete",{ count: rows.length, needsManualFallback: rows.length < 3 });
}
async function uploadExistingImages(dir: string, rows: Competitor[], checkpoint?: () => Promise<void>) {
  const provenance = await readJson<{ fixture: boolean }>(path.join(dir, "raw/collection-info.json"));
  if (opts.fixtures || provenance.fixture !== false) throw new PipelineError("FIXTURE_WRITE_FORBIDDEN");
  const { realpath } = await import("node:fs/promises");
  const root = await realpath(dir);
  for (const c of rows) {
    if (!c.imagePath || c.imageFileId && c.imageAsset?.id === c.imageFileId && c.imageAsset.originalUrl && c.imageUploadWorkspaceId === opts["workspace-id"]) continue;
    if (!/^raw\/images\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp)$/.test(c.imagePath)) throw new PipelineError("INVALID_LOCAL_IMAGE_PATH");
    const file = await realpath(path.join(root, c.imagePath));
    if (!file.startsWith(root + path.sep)) throw new PipelineError("INVALID_LOCAL_IMAGE_PATH");
    const asset = await uploadImage(file, opts["workspace-id"]!);
    if (!asset) throw new PipelineError("ERP_UPLOAD_REQUIRES_URL_COOKIE_AND_PRODUCTS_EDIT");
    c.imageAsset = asset; c.imageFileId = asset.id; c.imageUploadWorkspaceId = opts["workspace-id"]!;
    await writeJson(path.join(dir, "raw/competitors.json"), rows);
    await checkpoint?.();
  }
}
async function workbook(dir: string, slug: string, brief: Brief) {
  let failure: unknown;
  if (opts["upload-images"]) {
    try {
      const rows = await readJson<Competitor[]>(path.join(dir, "raw/competitors.json"));
      await uploadExistingImages(dir, rows);
    } catch (error) { failure = error; await recordError(dir, "image_upload", error); }
  }
  await rebuildWorkbook(dir, slug, brief, opts["workspace-id"], Boolean(opts["upload-images"]));
  if (failure) throw failure;
}

async function create(dir: string) {
  if (!opts.write) { log("create_skipped",{ reason: "PASS_WRITE_TO_PERSIST" }); return; }
  if (opts.fixtures) throw new PipelineError("FIXTURE_WRITE_FORBIDDEN");
  const draft = await readJson<Draft>(path.join(dir,"derived/draft.json"));
  let quality = await inspectQuality(dir, draft, opts["upload-images"], opts["workspace-id"]);
  draft.quality = quality;
  await writeJson(path.join(dir, "derived/draft.json"), draft);
  await writeJson(path.join(dir, "derived/quality.json"), quality);
  if (opts["upload-images"]) {
    // Reject missing research before uploading; an upload cannot fix reviews or suppliers.
    const reasons = quality.reasons.filter(reason => reason.code !== "UPLOADED_IMAGES_NEEDS_DATA");
    assertWriteQuality({ ...quality, reasons, blockWrite: reasons.length > 0 });
    await uploadExistingImages(dir, draft.competitors, () => writeJson(path.join(dir, "derived/draft.json"), draft));
    const rebuilt = buildDraft(draft.slug, draft.brief, draft.competitors, draft.suppliers, draft.tags);
    draft.product.workbookDetail = rebuilt.product.workbookDetail;
    quality = await inspectQuality(dir, draft, true, opts["workspace-id"]);
  }
  draft.quality = quality;
  await writeJson(path.join(dir, "derived/draft.json"), draft);
  await writeJson(path.join(dir, "derived/quality.json"), quality);
  assertWriteQuality(quality);
  const { productsCreate } = await import("./create/productsCreate");
  const result = await productsCreate(draft,opts["workspace-id"]!);
  const receipt = { ...result, slug: draft.slug, workspaceId: opts["workspace-id"], createdAt: new Date().toISOString(), uploadedImageFileIds: draft.competitors.flatMap(c => c.imageFileId ? [c.imageFileId] : []) };
  await writeJson(path.join(dir,"derived/created.json"),receipt);
  log("product_created",receipt);
}
async function main() {
  if (opts.help) { console.log("selection run|collect|tag|suppliers|workbook|create --slug <slug> [--keyword <US keyword>] [--config file] [--write] [--workspace-id default] [--cloud-patch] [--reviews-file /absolute/reviews.jsonl] [--suppliers-file /absolute/suppliers.json (>=3 unique real 1688 offers)] [--fixtures] [--upload-images]\nManual fallback: tag --reviews-file imports {asin,star:1..3,date,text<=240} JSONL into raw/reviews/<ASIN>.jsonl. Run workbook after tag/suppliers. workbook --upload-images uploads existing local files without collecting again. --write only supports run/create and hard-fails if quality.blockWrite=true."); return; }
  if (!["run","collect","tag","suppliers","workbook","create"].includes(command)) throw new PipelineError("UNKNOWN_COMMAND");
  if (opts.write && !["run", "create"].includes(command)) throw new PipelineError("WRITE_ONLY_VALID_FOR_RUN_OR_CREATE");
  if (!opts.slug) throw new PipelineError("SLUG_REQUIRED");
  if (opts.fixtures && (opts.write || opts["upload-images"])) throw new PipelineError("FIXTURE_WRITE_FORBIDDEN");
  const dir = selectionDir(opts.slug);
  await mkdir(dir,{ recursive: true });
  // Prevent races between pipeline stages, including simultaneous --write runs.
  const lock = await open(path.join(dir,".pipeline.lock"),"wx");
  try {
    const config = await loadConfig(opts.config);
    let brief: Brief;
    try { brief = await readJson<Brief>(path.join(dir,"brief.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      brief = { keyword: opts.keyword || config.keywords[0] || "", priceMin: config.priceMin, priceMax: config.priceMax };
    }
    const previous = await readJson<{ fixture: boolean }>(path.join(dir,"raw/collection-info.json")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (previous && previous.fixture !== opts.fixtures && ["run","collect"].includes(command)) throw new PipelineError("DO_NOT_MIX_FIXTURE_AND_LIVE_SLUG");
    if (opts.keyword && brief.keyword !== opts.keyword) throw new PipelineError("SLUG_KEYWORD_MISMATCH_USE_NEW_SLUG");
    if (typeof brief.keyword !== "string" || !brief.keyword.trim()) throw new PipelineError("KEYWORD_REQUIRED");
    if (!brief || typeof brief !== "object" || typeof brief.keyword !== "string" || !brief.keyword.trim() || brief.keyword.length > 300) throw new PipelineError("INVALID_BRIEF");
    for (const key of ["chineseName", "englishName"] as const) {
      if (brief[key] !== undefined && (typeof brief[key] !== "string" || brief[key].length > 300)) throw new PipelineError("INVALID_BRIEF_NAME");
    }
    for (const key of ["priceMin", "priceMax"] as const) {
      if (brief[key] !== undefined && (typeof brief[key] !== "number" || !Number.isFinite(brief[key]) || brief[key] < 0)) throw new PipelineError("INVALID_BRIEF_PRICE");
    }
    if (brief.priceMin !== undefined && brief.priceMax !== undefined && brief.priceMin > brief.priceMax) throw new PipelineError("INVALID_BRIEF_PRICE_RANGE");
    if (brief.solutionKeywords && (!Array.isArray(brief.solutionKeywords) || brief.solutionKeywords.length > 30 || brief.solutionKeywords.some(v => typeof v !== "string" || !v.trim() || v.length > 200))) throw new PipelineError("INVALID_SOLUTION_KEYWORDS");
    await writeJson(path.join(dir,"brief.json"),brief);
    await writeJson(path.join(dir,"run-info.json"),{ fixture: previous?.fixture ?? opts.fixtures, command, capturedAt: new Date().toISOString(), marketplace: "US" });
    if (command === "run" || command === "collect") await collect(dir,brief,config);
    if (command === "run" || command === "tag") await tag(dir);
    if (command === "run" || command === "suppliers") await suppliers(dir,brief,config);
    if (command === "run" || command === "workbook") await workbook(dir,opts.slug,brief);
    if (command === "create" || command === "run" && opts.write) await create(dir);
    if (["run","collect"].includes(command)) {
      const rows = await readJson<Competitor[]>(path.join(dir,"raw/competitors.json"));
      if (!rows.length) { log("collection_needs_attention",{ reason: "NO_COMPETITORS_CHECK_RAW_ERRORS" }); process.exitCode = 2; }
    }
  } finally {
    await lock.close();
    const { unlink } = await import("node:fs/promises"); await unlink(path.join(dir,".pipeline.lock"));
  }
}
main().catch(error => { log("pipeline_failed",{ code: error instanceof Error ? error.name : "UnknownError", reason: error instanceof PipelineError ? error.message : "See stage log; no secrets are printed" }); process.exitCode = 1; });
