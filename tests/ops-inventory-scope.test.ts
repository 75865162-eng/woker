import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const syncCenter = readFileSync(new URL("../src/components/operations/sync-center-workbench.tsx", import.meta.url), "utf8");
const operationsHub = readFileSync(new URL("../src/components/operations/operations-hub-workbench.tsx", import.meta.url), "utf8");

test("embedded inventory passes the selected seller and marketplace without defaulting", () => {
  assert.match(syncCenter, /<OperationsHubWorkbench[^>]*sellerAccountId=\{store \|\| undefined\}[^>]*marketplaceId=\{site \|\| undefined\}/);
  assert.match(operationsHub, /if \(sellerAccountId\) params\.set\("sellerAccountId", sellerAccountId\);/);
  assert.match(operationsHub, /if \(marketplaceId\) params\.set\("marketplaceId", marketplaceId\);/);
  assert.match(operationsHub, /\}, \[inventoryPage, inventorySku, marketplaceId, sellerAccountId\]\);/);
});

test("freshness uses the selected seller and marketplace independently of inventory pagination", () => {
  const readinessLoader = operationsHub.match(/const loadReadiness = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[marketplaceId, sellerAccountId\]\);/)?.[1];
  assert.ok(readinessLoader, "账号或站点变更必须重新请求 freshness");
  assert.match(readinessLoader, /const params = new URLSearchParams\(\);/);
  assert.match(readinessLoader, /if \(sellerAccountId\) params\.set\("sellerAccountId", sellerAccountId\);/);
  assert.match(readinessLoader, /if \(marketplaceId\) params\.set\("marketplaceId", marketplaceId\);/);
  assert.match(readinessLoader, /fetch\(`\/api\/operations\/freshness\?\$\{params\}`/);
  assert.match(readinessLoader, /setReadiness\(null\);/);
  assert.match(readinessLoader, /sequence !== requests\.current\.readiness \|\| scopeKey !== workspaceHeaders\(\)\.get\("x-workspace-id"\)/);
  assert.doesNotMatch(readinessLoader, /params\.set\("(?:sellerAccountId|marketplaceId)",\s*[^)]+\?\?/);
});

test("freshness backend consumes the same account and marketplace query contract", () => {
  const route = readFileSync(new URL("../src/app/api/operations/freshness/route.ts", import.meta.url), "utf8");
  const readiness = readFileSync(new URL("../src/lib/operations/readiness.ts", import.meta.url), "utf8");
  const compatibility = readFileSync(new URL("../src/lib/amazon-sync/compatibility.ts", import.meta.url), "utf8");
  assert.match(route, /params: new URL\(request\.url\)\.searchParams/);
  assert.match(readiness, /centerCompatibilityReadiness\([^\n]*input\.params\)/);
  assert.match(compatibility, /amazonAccountReadAccess\(scope, actor, params\)/);
  assert.match(compatibility, /sellerAccountId: access\.sellerIds\[0\]/);
  assert.match(compatibility, /marketplaceId: params\.get\("marketplaceId"\)!/);
});

test("changing between accounts reloads inventory with the chosen scope", () => {
  assert.match(syncCenter, /sellerAccountId=\{store \|\| undefined\}/);
  assert.match(operationsHub, /\}, \[inventoryPage, inventorySku, marketplaceId, sellerAccountId\]\);/);
  assert.doesNotMatch(syncCenter, /setStore\(stores\[0\]/);
  assert.doesNotMatch(operationsHub, /sellerAccountId \?\? [^,;]+/);
});

test("no account selection stays absent so the API can reject or resolve its own authorized scope", () => {
  assert.match(syncCenter, /sellerAccountId=\{store \|\| undefined\}/);
  assert.match(operationsHub, /if \(sellerAccountId\) params\.set\("sellerAccountId", sellerAccountId\);/);
  assert.doesNotMatch(operationsHub, /params\.set\("sellerAccountId",\s*[^)]+\?\?/);
});
