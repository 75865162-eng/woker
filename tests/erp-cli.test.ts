import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDraft } from "../scripts/erp-cli/src/schema";
import { draftJsonSchema } from "../scripts/erp-cli/src/validation";
import { readFileSync } from "node:fs";

test("ERP schema accepts a thin version 1 draft and warns about local images", () => {
  const result = normalizeDraft({ version: 1, sku: "A-1", title: "商品", marketplace: "US", workspace: "default", imagePaths: ["/tmp/a.jpg"] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.draft?.product.chineseName, "商品");
  assert.deepEqual(result.draft?.warnings, ["IMAGES_NEED_UPLOAD"]);
});

test("ERP schema rejects unknown fields instead of dropping them", () => {
  const result = normalizeDraft({ version: 1, sku: "A-1", title: "商品", marketplace: "US", workspace: "default", unexpected: true });
  assert.ok(result.errors.some((error) => error.includes("unknown field: unexpected")));
});

test("ERP schema rejects missing required fields", () => {
  const result = normalizeDraft({ version: 1, sku: "A-1", title: "商品", workspace: "default" });
  assert.ok(result.errors.some((error) => error.includes("marketplace")));
});

test("ERP schema tracks explicit fields for non-destructive upsert", () => {
  const result = normalizeDraft({ version: 1, sku: "A-1", title: "新名称", marketplace: "US", workspace: "default" });
  assert.deepEqual(result.draft?.providedProductKeys.sort(), ["chineseName", "sku"]);
});

const thin = { version: 1, sku: "A-1", title: "商品", marketplace: "US", workspace: "default" };
for (const [field, value] of Object.entries({ purchasePrice: "10", note: 3, images: [1], opsAssignees: [false], productWeightG: -1, revision: 1.5, imageAssets: "bad", workflowStage: "invented", productSizeCm: { length: "12" }, videoPlan: { invented: "lost" }, source: "sellfox" })) {
  test(`ERP schema rejects invalid ${field} without coercion`, () => {
    assert.ok(normalizeDraft({ ...thin, [field]: value }).errors.length);
  });
}
test("ERP rejects fixtures, ambiguous aliases and unknown nested keys", () => {
  for (const patch of [{ fixture: true }, { meta: { fixture: true } }, { chineseName: "不同名称" }, { workspaceId: "other" }, { packageSizeCm: { length: 1, width: 2, height: 3, unit: "in" } }]) {
    assert.ok(normalizeDraft({ ...thin, ...patch }).errors.length);
  }
});

test("ERP rejects incomplete nested assets instead of accepting broken references", () => {
  assert.ok(normalizeDraft({ ...thin, imageAssets: [{}] }).errors.some(error => error.includes("imageAssets[0].id")));
});

test("published JSON schema matches the runtime field shapes", () => {
  assert.deepEqual(JSON.parse(readFileSync("scripts/erp-cli/draft.schema.json", "utf8")), draftJsonSchema);
});
