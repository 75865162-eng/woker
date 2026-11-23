import assert from "node:assert/strict";
import test from "node:test";
import { extractIdentityFromAttributes } from "../src/lib/amazon-sync/product-master-resolver";

test("主档身份：完整 listingAttributes 提取标题/父ASIN/品牌/子变体角色", () => {
  const out = extractIdentityFromAttributes({
    itemName: "  Sample Product Title  ",
    parentAsin: "B0PARENT01",
    brand: "  Acme  ",
  });
  assert.equal(out.title, "Sample Product Title");
  assert.equal(out.parentAsin, "B0PARENT01");
  assert.equal(out.brand, "Acme");
  assert.equal(out.variantRole, "CHILD");
});

test("主档身份：variationParentAsin 作为父 ASIN 备选，非法 ASIN 被忽略", () => {
  const out = extractIdentityFromAttributes({
    itemName: "Parent Item", variationParentAsin: "NOT-AN-ASIN", relationshipType: "parent", childAsins: ["B0CHILD001"],
  });
  assert.equal(out.parentAsin, null);
  assert.equal(out.variantRole, "PARENT");
});

test("主档身份：标题截断到 300 字符", () => {
  const out = extractIdentityFromAttributes({ itemName: "x".repeat(500) });
  assert.equal(out.title?.length, 300);
});

test("主档身份：空/非对象属性返回 UNKNOWN，不造数", () => {
  assert.deepEqual(extractIdentityFromAttributes(null), { title: null, parentAsin: null, brand: null, variantRole: "UNKNOWN" });
  assert.deepEqual(extractIdentityFromAttributes("bad"), { title: null, parentAsin: null, brand: null, variantRole: "UNKNOWN" });
  assert.deepEqual(extractIdentityFromAttributes([]), { title: null, parentAsin: null, brand: null, variantRole: "UNKNOWN" });
});

test("主档身份：单一商品无父子关系标记 SINGLE", () => {
  const out = extractIdentityFromAttributes({ itemName: "Standalone", brand: "Solo" });
  assert.equal(out.variantRole, "SINGLE");
  assert.equal(out.parentAsin, null);
});
