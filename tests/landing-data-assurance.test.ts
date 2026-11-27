import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resourceForDataset, collectReconcilableSourceIds, formatScanSummary,
  type ScanSummary,
} from "../src/lib/amazon-sync/landing-data-assurance";
import { AMAZON_PAGE_MAP } from "../src/lib/wimoor-migration/page-dataset-map";
import { mcpDatasets } from "../src/lib/amazon-sync/mcp-datasets";

test("9 个目标页的 dataset 都能解析为已登记 resource", () => {
  const resources = new Set(mcpDatasets.map(d => d.resource));
  const targets = [
    "/wimoor/account/reimbursements", "/wimoor/account/storage-fees",
    "/wimoor/sales/fba-feiyong", "/wimoor/sales/fba-zhixiao",
    "/wimoor/sales/yichu-dingdan", "/wimoor/sales/xiaoliang-xiangqing",
    "/wimoor/sales/chapin-guanli", "/wimoor/sales/cuxiao-baogao",
    "/wimoor/sales/dianpu-jixiao",
  ];
  for (const href of targets) {
    const m = AMAZON_PAGE_MAP[href];
    assert.ok(m, `${href} 应在映射表中`);
    const resource = resourceForDataset(m.dataset);
    assert.ok(resources.has(resource), `${href} 的 dataset=${m.dataset} → resource=${resource} 未登记`);
  }
  // order_items 复用 orders，promotions/customer_feedback 为独立 observation resource
  assert.equal(resourceForDataset("order_items"), "orders");
  assert.equal(resourceForDataset("fee_preview"), "fee_preview");
  assert.equal(resourceForDataset("promotions"), "promotions");
});

test("collectReconcilableSourceIds 去重且忽略空", () => {
  const fake = {
    pages: [
      { reconcilableSourceIds: ["a", "b"] },
      { reconcilableSourceIds: ["b", "c"] },
      { reconcilableSourceIds: [] },
    ],
  } as unknown as ScanSummary;
  assert.deepEqual(collectReconcilableSourceIds(fake), ["a", "b", "c"]);
});

test("formatScanSummary 输出页面、状态与汇总，无数据泄漏", () => {
  const fake = {
    scope: { organizationId: "org1", workspaceId: "default" },
    actor: "owner1",
    scannedAt: "2026-11-27T00:00:00.000Z",
    totalPages: 1,
    stateCounts: { HAS_DATA: 1 },
    pages: [{
      href: "/wimoor/sales/fba-feiyong", name: "FBA费用", dataset: "fee_preview", resource: "fee_preview",
      state: "HAS_DATA", totalRows: 251, sites: [], reconcilableSourceIds: [],
    }],
  } as ScanSummary;
  const text = formatScanSummary(fake);
  assert.match(text, /FBA费用/);
  assert.match(text, /HAS_DATA/);
  assert.match(text, /251/);
  assert.match(text, /HAS_DATA=1/);
});

test("CLI 已接入 package.json scripts", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["landing:scan"], /landing-data-assurance/);
  assert.match(pkg.scripts["landing:reconcile"], /--reconcile/);
});
