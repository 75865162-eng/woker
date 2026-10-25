import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer, type Server } from "node:http";
import { uploadImage } from "./src/images/upload";
import { chromium, type Browser } from "@playwright/test";
import ExcelJS from "exceljs";
import { parseSearch } from "./src/amazon/search";
import { parsePdp } from "./src/amazon/pdp";
import { parseReviews } from "./src/amazon/reviews";
import { applyDict, loadDictionary, aggregateTags } from "./src/tags/applyDict";
import { cloudPatch, validatePatch } from "./src/tags/cloudPatch";
import { parse1688, validateSuppliers } from "./src/alibaba/search1688";
import { SnapshotStore } from "./src/snapshot/store";
import { RateLimit } from "./src/amazon/rateLimit";
import { selectionDir, loadConfig } from "./src/config";
import { buildDraft } from "./src/workbook/buildDraft";
import { buildXlsx } from "./src/workbook/buildXlsx";
import { productsCreate } from "./src/create/productsCreate";
const base = path.resolve("scripts/selection-pipeline");
let browser: Browser;
let temporary: string;
before(async () => { browser = await chromium.launch(); temporary = await mkdtemp(path.join(os.tmpdir(),"selection-tests-")); });
after(async () => { await browser?.close(); if (temporary) await rm(temporary,{ recursive: true, force: true }); });
async function fixture(name: string) {
  const page = await browser.newPage();
  await page.route("**/*",route => route.abort());
  await page.setContent(await readFile(path.join(base,`fixtures/${name}.html`),"utf8"));
  return page;
}
test("Amazon search: parses USD/counts, ignores empty sponsored cards",async () => {
  const page = await fixture("search");
  try { const rows = await parseSearch(page); assert.equal(rows.length,1); assert.equal(rows[0].asin,"B012345678"); assert.equal(rows[0].price,29.99); assert.equal(rows[0].reviewsCount,1234); }
  finally { await page.close(); }
});
test("Amazon PDP: first category rank, bullets, variations and image",async () => {
  const page = await fixture("pdp");
  try { const row = await parsePdp(page); assert.equal(row.bsr,12345); assert.equal(row.rating,4.3); assert.deepEqual(row.bullets,["Adjustable cover"]); assert.deepEqual(row.variations,["Large"]); assert.match(row.mainImageUrl!,/^https:\/\/m.media-amazon.com/); }
  finally { await page.close(); }
});
test("reviews: 1–3 stars only, dictionary aggregation, cloud cannot invent quotes",async () => {
  const page = await fixture("reviews");
  try {
    const rows = await parseReviews(page,"B012345678"); assert.equal(rows.length,2); assert.ok(rows.every(row => row.text.length <= 240));
    const dictionary = await loadDictionary(path.join(base,"src/tags/dictionary.yaml"));
    const tagged = applyDict(rows,dictionary);
    assert.equal(tagged.unmatched.length,1);
    const totals = aggregateTags([...tagged.matches,...tagged.matches]);
    assert.equal(totals.countByTag.thin_material,1); assert.equal(totals.countByTag.leak_water,1); assert.equal(totals.countByTag.size,1);
    assert.throws(() => validatePatch([{ asin: rows[1].asin,tag: "new_tag",quote: "invented" }],tagged.unmatched));
    assert.throws(() => validatePatch([{ asin: rows[1].asin,tag: "__proto__",quote: rows[1].text }],tagged.unmatched));
    assert.equal(validatePatch([{ asin: rows[1].asin,tag: "buckle",quote: rows[1].text }],tagged.unmatched).length,1);
  } finally { await page.close(); }
});
test("SQLite daily quota is atomic across instances and persists snapshots",async () => {
  const a = new SnapshotStore(path.join(temporary,"test.sqlite"));
  const b = new SnapshotStore(a.file); await a.init();
  const reservations = await Promise.all([a.reserve(2),b.reserve(2),a.reserve(2)]);
  assert.equal(reservations.filter(Boolean).length,2);
  await a.capture({ asin: "B012345678",title: "test",url: "",price: null,rating: 4,reviewsCount: 100,bsr: 123 });
  assert.equal(JSON.parse(await a.sql("SELECT * FROM asin_snapshots"))[0].bsr,123);
});
test("configuration and manual suppliers reject unsupported scope and unsafe URLs",async () => {
  assert.throws(() => selectionDir("../escape"));
  assert.equal((await loadConfig()).marketplace,"US");
  assert.throws(() => validateSuppliers([{ title: "bad",url: "https://evil.test/offer/1.html" }],5));
  const suppliers = validateSuppliers(JSON.parse(await readFile(path.join(base,"fixtures/suppliers.json"),"utf8")),5); assert.equal(suppliers.length,3);
});
test("workbook uses ERP sections, records image provenance, file IDs and tag counts",async () => {
  const imageAsset = { id: "file-main",name: "cover.jpg",mimeType: "image/jpeg",size: 5,storageType: "local" as const,uploadedAt: new Date().toISOString(),thumbUrl: "/thumb",originalUrl: "/original" };
  const draft = buildDraft("test",{ keyword: "kayak cover" },[{ asin: "B012345678",title: "Cover",url: "https://www.amazon.com/dp/B012345678",price: 29,rating: 4,reviewsCount: 10,imagePath: "raw/images/B012345678.jpg",imageFileId: imageAsset.id,imageAsset }],[],aggregateTags([{ asin: "B012345678",tag: "fit",quote: "poor fit",source: "dictionary" }]));
  const competitors = draft.product.workbookDetail.competitors as { hotVariantImageAsset?: { id: string } }[];
  assert.equal(competitors[0].hotVariantImageAsset?.id,imageAsset.id);
  const file = path.join(temporary,"workbook.xlsx"); await buildXlsx(draft,file);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("A1").text,"品名"); assert.equal(sheet.getCell("B11").text,"ASIN");
  assert.equal(sheet.getCell("L12").text,"fit: 1");
  assert.equal(workbook.getWorksheet("采集来源与标签")!.getCell("F2").text,"raw/images/B012345678.jpg");
  assert.equal(workbook.getWorksheet("基础信息")!.getCell("E2").text,"kayak cover");
});
test("create fails closed without explicit database/actor and cannot write fixture drafts",async () => {
  const draft = buildDraft("test",{ keyword: "test" },[],[],aggregateTags([]));
  await assert.rejects(productsCreate({ ...draft,fixture: true },"default"),/FIXTURE_WRITE_FORBIDDEN/);
  const saved = process.env.SELECTION_ACTOR_USER_ID;
  delete process.env.SELECTION_ACTOR_USER_ID;
  try { await assert.rejects(productsCreate(draft,"default"),/WRITE_REQUIRES_DATABASE_AND_EXPLICIT_ACTOR/); }
  finally { if (saved !== undefined) process.env.SELECTION_ACTOR_USER_ID = saved; }
});

test("1688 DOM parser preserves price ranges and missing MOQ without inventing values",async () => {
  const page = await fixture("suppliers");
  try {
    const rows = validateSuppliers(await parse1688(page),5);
    assert.equal(rows.length,1); assert.equal(rows[0].price,"¥10–15"); assert.equal(rows[0].moq,""); assert.equal(rows[0].shopName,"Fixture shop");
  } finally { await page.close(); }
});

test("rate limit circuit breaker stops retrying after a site block",async () => {
  const store = new SnapshotStore(path.join(temporary,"blocked.sqlite")); await store.init();
  const rate = new RateLimit(store,1000,10); const page = await browser.newPage();
  await page.route("https://www.amazon.com/**",route => route.fulfill({ status: 429,contentType: "text/html",body: "Request blocked" }));
  try {
    await assert.rejects(rate.navigate(page,"https://www.amazon.com/s?k=fixture"),/SITE_BLOCKED_OR_LOGIN_REQUIRED/);
    await assert.rejects(rate.navigate(page,"https://www.amazon.com/dp/B012345678"),/SITE_CIRCUIT_OPEN/);
    assert.equal(JSON.parse(await store.sql("SELECT used FROM request_budget"))[0].used,1);
  } finally { rate.close(); await page.close(); }
});

test("image upload uses the scoped multipart contract and rejects insecure remote origins",async () => {
  const imagePath = path.join(temporary,"upload.jpg");
  const imageBytes = Buffer.from([0xff,0xd8,0xff,0xd9]);
  await writeFile(imagePath,imageBytes);
  let received: { path?: string; cookie?: string; body?: Buffer } = {};
  let responseMode: "success" | "forbidden" | "missing-asset" | "invalid-asset" = "success";
  const server: Server = createServer((request,response) => {
    const chunks: Buffer[] = [];
    request.on("data",chunk => chunks.push(Buffer.from(chunk)));
    request.on("end",() => {
      received = { path: request.url, cookie: request.headers.cookie, body: Buffer.concat(chunks) };
      if (responseMode === "forbidden") { response.writeHead(403); response.end("private response must not enter errors"); return; }
      if (responseMode === "missing-asset") { response.writeHead(200,{ "content-type": "application/json" }); response.end("{}"); return; }
      if (responseMode === "invalid-asset") { response.writeHead(200,{ "content-type": "application/json" }); response.end(JSON.stringify({ asset: { id: "unusable" } })); return; }
      response.writeHead(200,{ "content-type": "application/json" });
      response.end(JSON.stringify({ asset: { id: "file-uploaded",name: "B012345678.jpg",mimeType: "image/jpeg",size: 4,storageType: "local",uploadedAt: "2026-10-25T00:00:00.000Z",thumbUrl: "/thumb",originalUrl: "/original",thumbFileId: "file-thumb" } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const oldUrl = process.env.SELECTION_ERP_URL; const oldCookie = process.env.SELECTION_ERP_COOKIE;
  process.env.SELECTION_ERP_URL = `http://127.0.0.1:${address.port}`; process.env.SELECTION_ERP_COOKIE = "session=unit-test-only";
  try {
    const asset = await uploadImage(imagePath,"selection-test");
    assert.equal(asset?.id,"file-uploaded"); assert.equal(received.path,"/api/products/file-assets/upload");
    assert.equal(received.cookie,"session=unit-test-only");
    const body = received.body?.toString() ?? "";
    assert.match(body,/name="workspaceId"[\s\S]*selection-test/); assert.match(body,/name="marketplace"[\s\S]*US/);
    assert.ok(received.body?.includes(imageBytes));
    responseMode = "forbidden";
    await assert.rejects(uploadImage(imagePath,"selection-test"),{ message: "ERP_IMAGE_UPLOAD_FAILED" });
    responseMode = "missing-asset";
    await assert.rejects(uploadImage(imagePath,"selection-test"),{ message: "INVALID_UPLOAD_RESPONSE" });
    responseMode = "invalid-asset";
    await assert.rejects(uploadImage(imagePath,"selection-test"),{ message: "INVALID_UPLOAD_RESPONSE" });
    delete process.env.SELECTION_ERP_COOKIE;
    assert.equal(await uploadImage(imagePath,"selection-test"),undefined);
    process.env.SELECTION_ERP_COOKIE = "session=unit-test-only";
    process.env.SELECTION_ERP_URL = "http://example.invalid";
    await assert.rejects(uploadImage(imagePath,"selection-test"),/INSECURE_ERP_ORIGIN/);
  } finally {
    if (oldUrl === undefined) delete process.env.SELECTION_ERP_URL; else process.env.SELECTION_ERP_URL = oldUrl;
    if (oldCookie === undefined) delete process.env.SELECTION_ERP_COOKIE; else process.env.SELECTION_ERP_COOKIE = oldCookie;
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("cloud patch command batches original quotes, defaults off and rejects failed or invented results",async () => {
  const saved = process.env.SELECTION_CLOUD_PATCH_CMD;
  const rows = Array.from({ length: 51 },(_,index) => ({ asin: "B012345678",star: 2,date: "",text: `Unmatched quote ${index}` }));
  try {
    delete process.env.SELECTION_CLOUD_PATCH_CMD;
    assert.deepEqual(await cloudPatch(rows),[]);
    const transform = 'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>{const rows=JSON.parse(input);if(rows.length>50)process.exit(3);process.stdout.write(JSON.stringify(rows.map(row=>({...row,tag:"buckle"}))));});';
    process.env.SELECTION_CLOUD_PATCH_CMD = JSON.stringify([process.execPath,"-e",transform]);
    const result = await cloudPatch(rows);
    assert.equal(result.length,51);
    assert.deepEqual(result.map(row => row.quote),rows.map(row => row.text));
    assert.ok(result.every(row => row.source === "cloud" && row.tag === "buckle"));
    process.env.SELECTION_CLOUD_PATCH_CMD = JSON.stringify([process.execPath,"-e","process.exit(2)"]);
    await assert.rejects(cloudPatch(rows),{ message: "CLOUD_COMMAND_FAILED" });
    process.env.SELECTION_CLOUD_PATCH_CMD = JSON.stringify([process.execPath,"-e",'process.stdout.write(JSON.stringify([{asin:"B012345678",tag:"buckle",quote:"invented"}]))']);
    await assert.rejects(cloudPatch(rows),{ message: "UNSUPPORTED_CLOUD_QUOTE" });
  } finally {
    if (saved === undefined) delete process.env.SELECTION_CLOUD_PATCH_CMD; else process.env.SELECTION_CLOUD_PATCH_CMD = saved;
  }
});

test("Round D quality requires real review-backed tags, 3 unique suppliers, local images and requested uploads", async () => {
  const { assessQuality, assertWriteQuality, validateReviews } = await import("./src/quality");
  const asin = "B012345678";
  const suppliers = Array.from({ length: 3 }, (_, index) => ({ title: "Isolated test lead", shopName: "", price: "", moq: "", url: `https://detail.1688.com/offer/23456789000${index}.html` }));
  const review = { asin, star: 2, date: "2026-10-25", text: "poor fit" };
  const draft = buildDraft("quality-unit", { keyword: "test" }, [{ asin, title: "Test", url: `https://www.amazon.com/dp/${asin}`, price: 1, rating: 4, reviewsCount: 1, bsr: 100 }], suppliers, aggregateTags([{ asin, tag: "size", quote: review.text, source: "dictionary" }]));
  const input = { reviews: [review], localImageAsins: [asin], uploadedImageAsins: [], requireUploadedImages: false, sourceFixture: false };
  const good = assessQuality(draft, input);
  assert.equal(good.blockWrite, false); assert.equal(good.needsReview, false);
  assert.doesNotThrow(() => assertWriteQuality(good));
  const invalidCases: Array<[typeof draft, string]> = [
    [{ ...draft, tags: aggregateTags([]) }, "TAGS_NEEDS_DATA"],
    [{ ...draft, suppliers: suppliers.slice(0, 2) }, "SUPPLIERS_NEEDS_DATA"],
    [{ ...draft, suppliers: [suppliers[0], suppliers[0], suppliers[1]] }, "SUPPLIERS_NEEDS_DATA"],
    [{ ...draft, tags: aggregateTags([{ asin, tag: "size", quote: "invented", source: "dictionary" }]) }, "TAGS_NEEDS_DATA"],
  ];
  for (const [changed, expected] of invalidCases) {
    const quality = assessQuality(changed, input);
    assert.equal(quality.blockWrite, true);
    assert.throws(() => assertWriteQuality(quality), new RegExp(expected));
  }
  const noReviews = assessQuality(draft, { ...input, reviews: [], errorCodes: ["SITE_BLOCKED_OR_LOGIN_REQUIRED"] });
  assert.equal(noReviews.status, "NEEDS_DATA"); assert.equal(noReviews.validReviews, 0);
  assert.deepEqual(noReviews.collectionReasonCodes, ["SITE_BLOCKED_OR_LOGIN_REQUIRED"]);
  assert.throws(() => assertWriteQuality(noReviews), /raw\/reviews/);
  assert.equal(assessQuality(draft, { ...input, localImageAsins: [] }).blockWrite, true);
  assert.equal(assessQuality(draft, { ...input, requireUploadedImages: true }).blockWrite, true);
  assert.equal(assessQuality(draft, { ...input, requireUploadedImages: true, uploadedImageAsins: [asin] }).blockWrite, false);
  assert.equal(assessQuality({ ...draft, fixture: true }, input).blockWrite, true);
  assert.equal(assessQuality(draft, { ...input, sourceFixture: undefined }).blockWrite, true);
  assert.equal(assessQuality({ ...draft, suppliers: JSON.parse(await readFile(path.join(base, "fixtures/suppliers.json"), "utf8")) }, input).blockWrite, true);
  assert.throws(() => validateReviews([{ ...review, star: 5 }], new Set([asin])), /INVALID_REVIEW/);
  assert.throws(() => validateReviews([{ ...review, asin: "B099999999" }], new Set([asin])), /INVALID_REVIEW/);
  assert.equal(validateReviews([review, review], new Set([asin])).length, 1);
  assert.equal(draft.competitors[0].sales30Days?.heuristic, true);
});

test("Round D CLI refuses empty live --write, accepts manual review/supplier fallback and persists failed upload gate", async () => {
  const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util");
  const { mkdir, copyFile, unlink, symlink } = await import("node:fs/promises"); const { randomUUID } = await import("node:crypto");
  const { writeJson, readJson } = await import("./src/io");
  const slug = `round-d-isolated-${randomUUID()}`; const dir = selectionDir(slug);
  const asin = "B012345678";
  const competitors = [{ asin, title: "Synthetic CLI test only", url: `https://www.amazon.com/dp/${asin}`, capturedAt: new Date().toISOString(), price: 1, rating: 4, reviewsCount: 1, bsr: 100, imagePath: `raw/images/${asin}.jpg` }];
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/selection-pipeline/src/cli.ts", ...args, "--slug", slug], { timeout: 15000, env: { ...process.env, DATABASE_URL: "", SELECTION_ORGANIZATION_ID: "", SELECTION_ACTOR_USER_ID: "", SELECTION_ERP_URL: "", SELECTION_ERP_COOKIE: "" } });
  try {
    await mkdir(path.join(dir, "raw/images"), { recursive: true });
    await copyFile(path.join(base, "fixtures/product.jpg"), path.join(dir, `raw/images/${asin}.jpg`));
    await writeJson(path.join(dir, "brief.json"), { keyword: "isolated CLI test" });
    await writeJson(path.join(dir, "raw/collection-info.json"), { fixture: false });
    await writeJson(path.join(dir, "raw/competitors.json"), competitors);
    await writeJson(path.join(dir, "derived/tags.json"), aggregateTags([]));
    await writeJson(path.join(dir, "derived/suppliers.json"), []);
    await cli(["workbook"]);
    // Never attempts a successful --write with synthetic test evidence against an existing DB.
    await assert.rejects(cli(["create", "--write"]), error => {
      const output = String((error as { stdout?: string }).stdout);
      return /QUALITY_BLOCK_WRITE/.test(output) && /REVIEWS_NEEDS_DATA/.test(output) && /SUPPLIERS_NEEDS_DATA/.test(output) && /reviews-file/.test(output) && /suppliers-file/.test(output);
    });
    assert.equal((await readJson<{ blockWrite: boolean }>(path.join(dir, "derived/quality.json"))).blockWrite, true);
    const manualReviews = path.join(dir, "manual-reviews.jsonl");
    await writeFile(manualReviews, JSON.stringify({ asin, star: 2, date: "2026-10-25", text: "too small and thin material" }) + "\n");
    const manualSuppliers = path.join(dir, "manual-suppliers.json");
    await writeJson(manualSuppliers, Array.from({ length: 3 }, (_, i) => ({ title: "Isolated test only", price: "", moq: "", shopName: "", url: `https://detail.1688.com/offer/23456789000${i}.html` })));
    await cli(["tag", "--reviews-file", manualReviews]);
    await cli(["suppliers", "--suppliers-file", manualSuppliers]);
    await cli(["workbook"]);
    const ready = await readJson<{ blockWrite: boolean; validReviews: number; suppliers: number }>(path.join(dir, "derived/quality.json"));
    assert.equal(ready.blockWrite, false); assert.equal(ready.validReviews, 1); assert.equal(ready.suppliers, 3);
    const localImage = path.join(dir, `raw/images/${asin}.jpg`);
    await writeFile(localImage, "not an image");
    await cli(["workbook"]);
    assert.equal((await readJson<{ images: number }>(path.join(dir, "derived/quality.json"))).images, 0);
    await unlink(localImage);
    await symlink(path.join(base, "fixtures/product.jpg"), localImage);
    await cli(["workbook"]);
    assert.equal((await readJson<{ images: number }>(path.join(dir, "derived/quality.json"))).images, 0);
    await unlink(localImage);
    await copyFile(path.join(base, "fixtures/product.jpg"), localImage);
    await writeJson(path.join(dir, "raw/collection-info.json"), { fixture: false, uploadImages: true });
    await cli(["workbook"]);
    const requested = await readJson<{ requireUploadedImages: boolean; blockWrite: boolean }>(path.join(dir, "derived/quality.json"));
    assert.equal(requested.requireUploadedImages, true); assert.equal(requested.blockWrite, true);
    await assert.rejects(cli(["workbook", "--upload-images"]), error => /ERP_UPLOAD_REQUIRES/.test(String((error as { stdout?: string }).stdout)));
    await cli(["workbook"]);
    const blocked = await readJson<{ blockWrite: boolean; requireUploadedImages: boolean }>(path.join(dir, "derived/quality.json"));
    assert.equal(blocked.requireUploadedImages, true); assert.equal(blocked.blockWrite, true);
    await assert.rejects(readFile(path.join(dir, "derived/created.json")), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
