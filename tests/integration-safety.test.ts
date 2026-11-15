import test from "node:test";
import assert from "node:assert/strict";
import { assertSellfoxReadonlyEndpoint } from "../src/lib/sellfox/endpoint-safety";
import { sellfoxKnownEndpoints } from "../src/lib/sellfox/known-endpoints";
import { sellfoxNextUncoveredDate, sellfoxWindowsCover, validateSellfoxEndpointInput } from "../src/lib/sellfox/sync-orchestrator";
import { redactAmazonLocalValue } from "../src/lib/amazon-sync/local-raw-catalog";
import { fetchExtQuery } from "../src/lib/workspace/ext-query";
import { setWorkspaceApiCacheScope, readWorkspaceApiQuery } from "../src/lib/workspace/workspace-api-cache";

test("原始行嵌套凭据与个人信息脱敏且保留业务金额", () => {
  assert.deepEqual(redactAmazonLocalValue({ amount: "1.000000", payload: [{ access_token: "fixture", buyerName: "fixture", nested: { password: "fixture", sku: "SKU-A" } }] }),
    { amount: "1.000000", payload: [{ access_token: "[REDACTED]", buyerName: "[REDACTED]", nested: { password: "[REDACTED]", sku: "SKU-A" } }] });
});

test("通用端点默认关闭，未知路径和篡改参数即便显式启用也拒绝", () => {
  const seed = sellfoxKnownEndpoints()[0];
  assert.equal(validateSellfoxEndpointInput(seed).enabled, false);
  assert.doesNotThrow(() => assertSellfoxReadonlyEndpoint(seed));
  for (const path of ["/api/order/delete.json", "/api/../delete.json", "//evil.invalid/api/read", seed.path + "/.."]) {
    assert.throws(() => assertSellfoxReadonlyEndpoint({ ...seed, path }));
  }
  assert.throws(() => assertSellfoxReadonlyEndpoint({ ...seed, params: '{"action":"delete"}' }));
  assert.throws(() => validateSellfoxEndpointInput({ ...seed, enabled: true, scopeMode: "global" }));
});

test("窗口连续前缀不会跨越失败洞，覆盖超200窗口并允许乱序", () => {
  assert.equal(sellfoxNextUncoveredDate("2026-01-01", [
    { startDate: "2026-01-06", endDate: "2026-01-10" },
    { startDate: "2026-01-01", endDate: "2026-01-03" },
  ]), "2026-01-04");
  assert.equal(sellfoxWindowsCover("2026-01-01", "2026-01-01", []), false);
  const windows = Array.from({ length: 400 }, (_, i) => {
    const date = new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10);
    return { startDate: date, endDate: date };
  }).reverse();
  assert.equal(sellfoxNextUncoveredDate("2025-01-01", windows), "2026-02-05");
});

test("跨身份在途响应被丢弃且不得写入新身份缓存", async t => {
  setWorkspaceApiCacheScope("org-a:user-a");
  let complete!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { complete = resolve; }));
  const pending = fetchExtQuery("kind=fixture&workspaceId=default");
  setWorkspaceApiCacheScope("org-b:user-b");
  complete(Response.json({ secret: "fixture-a" }));
  await assert.rejects(pending, /身份已变化/);
  assert.equal(readWorkspaceApiQuery("kind=fixture&workspaceId=default"), null);
});
