import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const stripComments = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("hub route derives per-dataset stats from SellfoxCoverage, not full-table count(distinct)", () => {
  const source = stripComments(readFileSync(path.join(root, "src/app/api/sellfox/hub/route.ts"), "utf8"));
  // Must no longer scan the 1,000,000+ row inventory table with count(distinct storeId)+max per dataset.
  assert.ok(!/count\(distinct\s+"?storeId"?\)/i.test(source), "hub 不得再对事实表做 count(distinct storeId) 全表扫描");
  assert.ok(!/\$queryRawUnsafe/.test(source), "hub 不得再用 $queryRawUnsafe 动态拼表统计");
  // Must build stats from the coverage rollup that is already queried in the same request.
  assert.ok(/coverageByResource/.test(source), "hub 应基于已查询的 SellfoxCoverage 结果构建统计");
  assert.ok(/_sum\.rowCount/.test(source) && /_count\._all/.test(source) && /_max\.lastDate/.test(source),
    "hub 统计应取 coverage 的 rowCount/store/lastDate 汇总");
  assert.ok(/getHubDatasetStats\(hubOverviewCacheKey/.test(source), "保留短 TTL 缓存以防快速重复打开");
});
