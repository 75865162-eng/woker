import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { parseWebReviews, parseWebSuppliers } from "../scripts/selection-pipeline/src/local-evidence";
import { readJson, writeJson } from "../scripts/selection-pipeline/src/io";
import { readLocalSelection, safeSelectionDirectory, saveLocalEvidence, withSelectionLock } from "@/lib/agent-platform/selection-local";

const asin = "B012345678";
const review = { asin, star: 2, date: "", text: "The material is too thin and leaks water." };
const suppliers = [781234567891, 781234567892, 781234567893].map(id => ({ title: "Test only supplier", price: "", moq: "", shopName: "", url: `https://detail.1688.com/offer/${id}.html` }));
test("web reviews share CLI validation: competitor scope, stars, length, date, deduplication", () => {
  assert.equal(parseWebReviews([review, review], [asin]).length, 1);
  for (const rows of [[], [{ ...review, asin: "B999999999" }], [{ ...review, star: 4 }], [{ ...review, star: 1.5 }], [{ ...review, text: "x".repeat(241) }], [{ ...review, date: undefined }], [{ ...review, text: " " }]]) assert.throws(() => parseWebReviews(rows, [asin]));
});
test("web suppliers canonicalize links and reject duplicates, credentials, foreign URLs and fixtures", () => {
  assert.deepEqual(parseWebSuppliers(suppliers.map(r => ({ ...r, url: r.url + "?tracking=1" }))), suppliers);
  for (const rows of [suppliers.slice(0,2), [suppliers[0], { ...suppliers[0], url: suppliers[0].url + "?x=1" }, suppliers[1]], suppliers.map(r => ({ ...r, url: r.url.replace("https:", "http:") })), suppliers.map(r => ({ ...r, url: r.url.replace("detail.1688.com", "detail.1688.com.evil.test") })), suppliers.map(r => ({ ...r, url: r.url.replace("https://", "https://user:pass@") })), suppliers.map(r => ({ ...r, shopName: "fixture-only" })), suppliers.map((r,i) => ({ ...r, url: `https://detail.1688.com/offer/10000000000${i+1}.html` }))]) assert.throws(() => parseWebSuppliers(rows));
});
test("local form writes reviews/tags/suppliers/workbook, retains draft identity and blocks fixtures; locks and symlinks fail closed", async () => {
  const slug = `web-form-test-${randomUUID()}`; const dir = path.resolve("selections", slug);
  await mkdir(path.join(dir,"raw"), { recursive: true });
  try {
    await writeJson(path.join(dir,"brief.json"), { keyword: "test cover" });
    await writeJson(path.join(dir,"raw/competitors.json"), [{ asin, title: "test", url: `https://www.amazon.com/dp/${asin}`, price: null, rating: null, reviewsCount: null }]);
    await writeJson(path.join(dir,"raw/collection-info.json"), { fixture: true });
    const first = await withSelectionLock(slug, root => saveLocalEvidence(root, slug, "default", "reviews", [review]));
    assert.equal(first.quality.validReviews, 1); assert.ok(first.quality.taggedQuotes > 0); assert.equal(first.quality.blockWrite, true);
    assert.equal(JSON.parse((await readFile(path.join(dir,`raw/reviews/${asin}.jsonl`),"utf8")).trim()).text, review.text);
    const prior = await readJson<{ product: { id: string } }>(path.join(dir,"derived/draft.json"));
    const next = await withSelectionLock(slug, root => saveLocalEvidence(root, slug, "default", "suppliers", suppliers));
    assert.equal(next.quality.suppliers, 3); assert.equal(next.quality.fixture, true);
    assert.ok(next.quality.reasons.some(r => r.code === "FIXTURE_WRITE_FORBIDDEN"));
    assert.equal((await readJson<{ product: { id: string } }>(path.join(dir,"derived/draft.json"))).product.id, prior.product.id);
    assert.ok((await readFile(path.join(dir,"derived/workbook.xlsx"))).length > 1000);
    await withSelectionLock(slug, async () => { await assert.rejects(withSelectionLock(slug, async () => true), /流水线占用中/); });
    await assert.rejects(safeSelectionDirectory("../escape"));
    await assert.rejects(safeSelectionDirectory("/tmp"));
    await symlink(path.resolve("package.json"), path.join(dir,"raw/outside.json"));
    await assert.rejects(safeSelectionDirectory(slug), /符号链接/);
    await rm(path.join(dir,"raw/outside.json"));
    await assert.rejects(withSelectionLock(slug, root => saveLocalEvidence(root, slug, "default", "reviews", [{ ...review, star: 5 }])));
    assert.equal((await withSelectionLock(slug, root => readLocalSelection(root, slug, "default"))).reviews[0].star, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
