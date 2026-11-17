import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const readSource = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

test("product GET keeps authorization at the route and delegates only after workspace access", async () => {
  const handler = await readSource("src/app/api/products/handler.ts");
  assert.match(handler, /requireApiPermission\("products", "view", request\)/);
  assert.match(handler, /assertWorkspaceAccess\(user\.organizationId, scope\.workspaceId, user\.id, undefined, request\)/);
  assert.match(handler, /getProductListService\(\{/);
  assert.doesNotMatch(handler, /\$queryRaw/);
});

test("product list service checks Amazon account access per request and decorates cache results afterward", async () => {
  const service = await readSource("src/app/api/products/product-list-service.ts");
  assert.match(service, /amazonDataAccess\(\{ organizationId: user\.organizationId, workspaceId \}, user\.id\)/);
  assert.ok(service.indexOf("if (payload && typeof payload === \"object\" && \"products\" in payload)") < service.indexOf("const amazonAccess = await amazonDataAccess"));
  assert.match(service, /getCachedProductListResponse/);
  assert.match(service, /readAmazonProductsForSkus/);
  assert.match(service, /setCachedProductListResponse\(cacheKey,[\s\S]*responsePayload/);
  assert.doesNotMatch(service, /setCachedProductListResponse\(cacheKey,[\s\S]*amazonSnapshots/);
});

test("product repository scopes SQL and keeps user-controlled values parameterized", async () => {
  const builders = await readSource("src/app/api/products/product-list-query-builders.ts");
  const repository = await readSource("src/app/api/products/product-list-repository.ts");
  assert.match(builders, /r\."organizationId" = \$\{input\.organizationId\}/);
  assert.match(builders, /r\."workspaceId" = \$\{input\.workspaceId\}/);
  assert.match(repository, /\$queryRaw/);
  assert.match(repository, /OFFSET \$\{\(page - 1\) \* pageSize\} LIMIT \$\{pageSize\}/);
  assert.match(repository, /sortExpressions\[sort\.field\]/);
});

test("product write service retains the aggregate revision transaction and outbox enqueue", async () => {
  const service = await readSource("src/app/api/products/product-write-service.ts");
  assert.match(service, /prisma\.\$transaction/);
  assert.match(service, /expectedRevision: requestedRevision/);
  assert.match(service, /saveProductAggregate/);
  assert.match(service, /enqueueProductOutboxEvent\(persisted\.outboxEventId\)/);
  assert.match(service, /enqueueProductOutboxEvent\(persisted\.projectionEventId\)/);
});
