import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function load(relativePath, modules) {
  const source = readFileSync(path.join(root, relativePath), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: name => {
      assert.ok(modules[name], `unexpected dependency ${name}`);
      return modules[name];
    },
    performance,
    console: { info() {}, warn() {} },
    Promise,
    Date,
  });
  return exports;
}

function makeListService({ allow = true, cacheHit = true, organizationId = "org-1", workspaceId = "ws-1" } = {}) {
  const calls = { access: [], accounts: [], snapshots: [], cached: [], writes: [], queries: [] };
  const listPayload = { products: [{ sku: "sku-1", name: "test" }], pagination: { page: 1, pageSize: 20, total: 1, pageCount: 1 } };
  const cachedPayload = cacheHit ? listPayload : null;
  class SyncInputError extends Error { constructor(message) { super(message); this.status = 403; } }
  class AmazonReadError extends Error { constructor(code, message, status) { super(message); this.businessCode = code; this.status = status; } }
  const service = load("src/app/api/products/product-list-service.ts", {
    "@/lib/amazon-sync/data-access": { amazonDataAccess: async (scope, userId) => { calls.access.push({ scope, userId }); if (!allow) throw new SyncInputError("denied"); return { sellerIds: ["seller-1"] }; } },
    "@/lib/amazon-sync/read-account": { AmazonReadError },
    "@/lib/amazon-sync/policy": { SyncInputError },
    "@/lib/products/amazon-field-policy": { stripAmazonProductObservations: product => Object.fromEntries(Object.entries(product).filter(([key]) => key !== "amazonSnapshots" && key !== "amazonSnapshotError" && key !== "amazonSnapshotErrorCode")) },
    "@/lib/operations/amazon-products": { readAmazonProductsForSkus: async (...args) => { calls.snapshots.push(args); return [{ sellerSku: "sku-1", asin: "asin-1" }]; } },
    "next/server": { NextResponse: { json: (value, init = {}) => ({ value, status: init.status ?? 200, headers: new Headers() }) } },
    "@/lib/db/prisma": { prisma: { sellerAccount: { findMany: async args => { calls.accounts.push(args); return [{ id: "seller-1", displayName: "Seller" }]; } } } },
    "@/lib/db/is-database-unavailable-error": { isDatabaseUnavailableError: () => false },
    "@/lib/products/list-query": { splitMultiValue: value => value ? value.split(",") : [] },
    "./product-list-query-builders": { buildProductListWhereSql: args => args, createServerTimingHeader: () => "", roundDuration: value => value },
    "./product-list-repository": { queryProductListPage: async args => { calls.queries.push(args); return { products: listPayload.products, total: 1 }; } },
    "@/lib/products/product-list-cache": {
      createProductListResponseCacheKey: input => JSON.stringify(input),
      createProductListScopeKey: input => `${input.organizationId}:${input.workspaceId}:${input.source}`,
      getCachedProductListResponse: async key => { calls.cached.push(key); return cachedPayload; },
      getCachedProductListSummary: () => null,
      setCachedProductListResponse: async (...args) => { calls.writes.push(args); },
      setCachedProductListSummary() {},
    },
    "@/lib/products/product-list-summary": { refreshProductListSummaryBundle: async () => ({ all: {}, dashboard: {} }) },
  });
  const request = user => service.getProductListService({
    user: { id: user, organizationId }, workspaceId, url: new URL("http://fixture.invalid/api?source=all&sellerAccountId=seller-1"),
    source: "all", page: 1, pageSize: 20, sort: { field: "sku", direction: "asc" }, status: null,
    createdByMe: false, includeSummary: false, summaryOnly: false, debugTiming: false,
  });
  return { calls, request };
}

test("缓存命中仍按当前用户校验Amazon授权，拒绝时不读快照", async () => {
  const { calls, request } = makeListService({ allow: false });
  const response = await request("user-denied");
  assert.equal(response.value.products[0].amazonSnapshotErrorCode, "ACCOUNT_ACCESS_DENIED");
  assert.equal(calls.cached.length, 1);
  assert.equal(JSON.stringify(calls.access), JSON.stringify([{ scope: { organizationId: "org-1", workspaceId: "ws-1" }, userId: "user-denied" }]));
  assert.equal(calls.snapshots.length, 0);
  assert.equal(calls.queries.length, 0);
});

test("缓存保存主资料且两个用户分别授权后才装饰观察快照", async () => {
  const fixture = makeListService({ cacheHit: false });
  const first = await fixture.request("user-a");
  const second = await fixture.request("user-b");
  assert.deepEqual(fixture.calls.access.map(call => call.userId), ["user-a", "user-b"]);
  assert.equal(fixture.calls.snapshots.length, 2);
  assert.deepEqual(first.value.products[0].amazonSnapshots, [{ sellerSku: "sku-1", asin: "asin-1" }]);
  assert.deepEqual(second.value.products[0].amazonSnapshots, [{ sellerSku: "sku-1", asin: "asin-1" }]);
  assert.equal(Object.hasOwn(fixture.calls.writes[0][2].products[0], "amazonSnapshots"), false);
  assert.equal(Object.hasOwn(fixture.calls.writes[0][2].products[0], "amazonSnapshotError"), false);
});

function makeWriteService({ transactionFails = false } = {}) {
  const calls = { tx: [], aggregate: [], enqueue: [], invalidate: [], summaryInvalidate: [] };
  class ProductRecordRevisionConflictError extends Error {}
  class InvalidProductStatusError extends Error {}
  class ProductManagementError extends Error {}
  const priceModule = load("src/lib/products/product-record-index.ts", {
    "@/lib/products/types": {},
    "@/lib/products/operations-progress": { hasIncompleteOperationsProgress: () => false },
    "@/lib/products/workflow": { getProductWorkflowStage: () => "", normalizeAssigneeList: () => [] },
  });
  const modules = {
    "@/lib/db/prisma": { prisma: { $transaction: async callback => { calls.tx.push("begin"); const value = await callback({ productRecord: { findUnique: async args => { calls.tx.push(args); return null; } } }); calls.tx.push("commit"); if (transactionFails) throw new Error("rollback"); return value; } } },
    "@/lib/queue": { enqueueProductOutboxEvent: async id => { calls.enqueue.push({ id, committed: calls.tx.includes("commit") }); } },
    "@/lib/products/product-aggregate-service": { saveProductAggregate: async (_tx, input) => { calls.aggregate.push(input); return { product: input.product, outboxEventId: "event-main", projectionEventId: "event-projection" }; } },
    "@/lib/products/product-list-cache": { invalidateProductListResponseCaches: async prefix => { calls.invalidate.push(prefix); }, invalidateProductListSummaryCaches: prefix => { calls.summaryInvalidate.push(prefix); } },
    "@/lib/products/amazon-field-policy": { stripAmazonProductObservations: product => product },
    "@/lib/products/product-record-repository": { ProductRecordRevisionConflictError },
    "@/lib/products/status-machine": { InvalidProductStatusError },
    "@/lib/products/management-contract": { ProductManagementError },
    "@/lib/products/product-record-index": priceModule,
  };
  const service = load("src/app/api/products/product-write-service.ts", modules);
  const input = price => ({ product: { id: "p-1", sku: "sku-1", chineseName: "商品", status: "draft", purchasePrice: price }, user: { id: "user-1", organizationId: "org-1" }, scope: { workspaceId: "ws-1", accountId: "account-1", marketplace: "US" }, canEditProducts: true, canCreateProducts: true });
  return { service, calls, input, servicePriceError: priceModule.ProductPurchasePriceValidationError };
}

test("列表查询与缓存键分别携带组织和工作区scope", async () => {
  const fixture = makeListService({ cacheHit: false, organizationId: "org-2", workspaceId: "ws-9" });
  await fixture.request("user-scope");
  assert.equal(fixture.calls.queries[0].whereSql.organizationId, "org-2");
  assert.equal(fixture.calls.queries[0].whereSql.workspaceId, "ws-9");
  assert.match(fixture.calls.cached[0], /org-2:ws-9:all/);
});

test("aggregate事务失败不会enqueue或失效缓存", async () => {
  const { service, calls, input } = makeWriteService({ transactionFails: true });
  await assert.rejects(service.saveProductRequest(input(0)), /rollback/);
  assert.deepEqual(calls.enqueue, []);
  assert.deepEqual(calls.invalidate, []);
  assert.deepEqual(calls.summaryInvalidate, []);
});

test("事务成功后才enqueue两个事件并失效对应scope缓存", async () => {
  const { service, calls, input } = makeWriteService();
  await service.saveProductRequest(input(0));
  assert.deepEqual(calls.enqueue.map(call => [call.id, call.committed]), [["event-main", true], ["event-projection", true]]);
  assert.deepEqual(calls.invalidate, ["org-1:ws-1:"]);
  assert.deepEqual(calls.summaryInvalidate, ["org-1:ws-1:"]);
  assert.equal(JSON.stringify(calls.aggregate[0].scope), JSON.stringify({ workspaceId: "ws-1", accountId: "account-1", marketplace: "US", organizationId: "org-1" }));
});

test("缺失采购价映射400且事务未启动，0合法", async () => {
  const missing = makeWriteService();
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(missing.service.saveProductRequest(missing.input(value)), error => {
      assert.ok(error instanceof missing.servicePriceError);
      const mapped = missing.service.productWriteErrorStatus(error);
      assert.equal(mapped.status, 400);
      assert.equal(mapped.body.error, "采购价格缺失或无效，请填写后再保存商品。");
      return true;
    });
  }
  assert.deepEqual(missing.calls.tx, []);
  const zero = makeWriteService();
  await zero.service.saveProductRequest(zero.input(0));
  assert.equal(zero.calls.aggregate.length, 1);
});
