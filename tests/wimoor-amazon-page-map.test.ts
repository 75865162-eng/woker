import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AMAZON_PAGE_MAP, amazonMapForPage, ALREADY_REAL_PAGES } from "../src/lib/wimoor-migration/page-dataset-map";
import { mcpDatasets, datasetForTable, normalizeDatasetQuery } from "../src/lib/amazon-sync/mcp-datasets";

const datasetNames = new Set(mcpDatasets.map(d => d.name));

test("映射表中每个 amazon 页的 dataset 都是已登记的数据集", () => {
  for (const [href, m] of Object.entries(AMAZON_PAGE_MAP)) {
    assert.equal(m.status, "amazon", `${href} 状态应为 amazon`);
    assert.ok(href.startsWith("/wimoor/"), `${href} 应为 wimoor 路由`);
    assert.ok(datasetNames.has(m.dataset), `${href} 的 dataset=${m.dataset} 未登记`);
    assert.ok(m.columns.length > 0, `${href} 缺少展示列`);
    assert.ok(m.basis.length > 10, `${href} 缺少口径说明`);
  }
});

test("映射表列 key 非空且点路径合法，pin 能被 normalizeDatasetQuery 接受", () => {
  for (const [href, m] of Object.entries(AMAZON_PAGE_MAP)) {
    for (const c of m.columns) {
      assert.ok(c.key && c.label, `${href} 存在空列定义`);
      assert.ok(!c.key.startsWith(".") && !c.key.endsWith("."), `${href} 点路径非法: ${c.key}`);
    }
    const ds = datasetForTable(m.dataset);
    const pin = Object.fromEntries(Object.entries(m.pin ?? {}).filter(([k]) => k !== "fromOffsetDays"));
    const normalized = normalizeDatasetQuery(ds, { ...pin, page: 1, pageSize: 10 });
    assert.equal(normalized.dataset.name, m.dataset, `${href} pin 改变了 dataset`);
  }
});

test("未登记页 fail-safe 返回 null，已接真实数据的页面不在 amazon 映射中", () => {
  assert.equal(amazonMapForPage("/wimoor/product/master"), null);
  assert.equal(amazonMapForPage("/wimoor/purchase/orders"), null);
  assert.equal(amazonMapForPage("/wimoor/system/menus"), null);
  for (const href of ALREADY_REAL_PAGES) {
    assert.equal(amazonMapForPage(href), null, `${href} 已走其它真实 API，不应重复映射`);
  }
});

test("映射页 dataset 均为已验证可读的业务域", () => {
  // 全部经生产真实 scope readDataset 验证：可读（有数据或语义明确的空报告）。
  // 有数据：orders136 finance137 returns9 settlements87 inventory201 listings165 sales5 fba_shipments3507 reserved31；
  // 语义明确但当前站点空：order_items/reimbursements/storage_fees/fee_preview/recommended_removals/
  //   removal_order_report/customer_feedback/promotions（空不代表业务不存在，页面已标注口径）。
  const allowed = new Set([
    "orders", "order_items", "returns", "sales_traffic_daily", "listings", "settlements_v2",
    "finance_transactions", "reimbursements", "storage_fees", "inventory", "fba_shipments",
    "fee_preview", "recommended_removals", "removal_order_report", "customer_feedback", "promotions",
  ]);
  for (const [href, m] of Object.entries(AMAZON_PAGE_MAP)) {
    assert.ok(allowed.has(m.dataset), `${href} 使用了未验证数据集 ${m.dataset}`);
  }
});

test("只读数据工作台不向数据集协议发送未知 query 参数（防 r= 导致全页读不到数据）", () => {
  // 回归：曾把 reloadKey 作为 r= 放进 sync-center?section=data 的 query，
  // 触发 normalizeDatasetQuery 的 FIELD_NOT_MAPPED，所有 Amazon 只读页都显示错误而非真实数据。
  const src = readFileSync(new URL("../src/components/wimoor-migration/amazon-dataset-workbench.tsx", import.meta.url), "utf8");
  const paramsBlock = src.slice(src.indexOf("new URLSearchParams({"), src.indexOf("new URLSearchParams({") + 400);
  assert.doesNotMatch(paramsBlock, /\br\s*:/, "工作台不得把 r= 作为 query 参数发给数据集协议");
  // reloadKey 仍保留为依赖（用于刷新），但通过 no-store 而非 query 参数
  assert.match(src, /cache:\s*'no-store'/, "应使用 no-store 保证刷新拿到最新数据");
});
