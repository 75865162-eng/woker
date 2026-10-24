import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium, type Browser } from "@playwright/test";
import ExcelJS from "exceljs";
import { parseSearch } from "./src/amazon/search";
import { parsePdp } from "./src/amazon/pdp";
import { parseReviews } from "./src/amazon/reviews";
import { applyDict, loadDictionary, aggregateTags } from "./src/tags/applyDict";
import { validatePatch } from "./src/tags/cloudPatch";
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
test("workbook uses ERP sections and records image provenance and tag counts",async () => {
  const draft = buildDraft("test",{ keyword: "kayak cover" },[{ asin: "B012345678",title: "Cover",url: "https://www.amazon.com/dp/B012345678",price: 29,rating: 4,reviewsCount: 10,imagePath: "raw/images/B012345678.jpg" }],[],aggregateTags([{ asin: "B012345678",tag: "fit",quote: "poor fit",source: "dictionary" }]));
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
