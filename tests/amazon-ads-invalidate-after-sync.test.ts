import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { invalidateAmazonAdsAfterSync } from "../src/lib/amazon-ads/invalidate-after-sync";

test("invalidateAmazonAdsAfterSync calls injected invalidator with org+ws", async () => {
  const calls: Array<[string, string]> = [];
  const ok = await invalidateAmazonAdsAfterSync(
    { organizationId: "org-1", workspaceId: "ws-1" },
    "test",
    async (org, ws) => { calls.push([org, ws]); },
  );
  assert.equal(ok, true);
  assert.deepEqual(calls, [["org-1", "ws-1"]]);
});

test("invalidateAmazonAdsAfterSync is fail-open: thrown invalidator does not propagate", async () => {
  const ok = await invalidateAmazonAdsAfterSync(
    { organizationId: "org-1", workspaceId: "ws-1" },
    "test",
    async () => { throw new Error("redis down"); },
  );
  assert.equal(ok, false);
});

const ROOT = new URL("../", import.meta.url);
function src(rel: string) { return readFileSync(new URL(rel, ROOT), "utf8"); }

test("source guard: ads sync success points invalidate the cache after publish", () => {
  const processor = src("src/lib/amazon-ads/sync-processor.ts");
  assert.match(
    processor,
    /if \(stageFinished\) await invalidateAmazonAdsAfterSync\(scope,\s*["']ads-structure-published["']\)/,
    "structure 同步成功后必须失效缓存",
  );

  const publication = src("src/lib/amazon-ads/report-publication.ts");
  const afterPublish = publication.indexOf("await invalidateAmazonAdsAfterSync(scope, \"ads-report-published\")");
  const afterVisibility = publication.indexOf("await invalidateAmazonAdsAfterSync(scope, \"ads-report-visibility\")");
  assert.ok(afterPublish > 0, "报表发布后必须失效缓存");
  assert.ok(afterVisibility > 0, "报表可见性切换后必须失效缓存");
  // 失效必须在事务提交之后（出现在 $transaction 调用的收尾 `}, { timeout` 之后）
  const publishTxEnd = publication.indexOf("}, { timeout: 20000 });", publication.indexOf("export async function publishAdsReportVersion"));
  assert.ok(afterPublish > publishTxEnd, "发布失效必须发生在事务提交之后");
});

test("source guard: default invalidator delegates to tenant-wide invalidation", () => {
  const helper = src("src/lib/amazon-ads/invalidate-after-sync.ts");
  assert.match(helper, /import\s*\{[^}]*invalidateAmazonTenant[^}]*\}/, "默认失效器必须走租户级失效");
  assert.match(helper, /invalidateAmazonTenant\(organizationId,\s*workspaceId\)/);
  const cache = src("src/lib/amazon-ads/result-cache.ts");
  assert.match(cache, /invalidateAmazonTenant[\s\S]*?\.scan\(/, "租户失效用 SCAN 而非 KEYS");
});
