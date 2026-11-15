import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const mcp = read("src/lib/sellfox/mcp.ts");
const browseRoute = read("src/app/api/sellfox/[domain]/route.ts");
const exportRoute = read("src/app/api/sellfox/[domain]/export/route.ts");
const headHelper = read("src/lib/sellfox/inventory-head.ts");
const amazonRead = read("src/lib/amazon-sync/local-raw-read.ts");
const amazonMcp = read("src/lib/amazon-sync/mcp.ts");

test("赛狐备货/广告诊断的库存只取当前态，不累加历次采集批次", () => {
  assert.ok(!mcp.includes("sum(i.quantity) OVER (PARTITION BY"), "不得再跨批次窗口累加库存");
  assert.ok(!mcp.includes('SELECT sum(i.quantity) AS on_hand FROM "SellfoxFbaInventorySnapshot"'), "不得直接累加原始快照表");
  assert.ok((mcp.match(/FROM "sellfox_inventory_current"/g) ?? []).length >= 2, "库存与在途聚合都必须改用当前态视图");
  assert.ok(mcp.includes('FROM "sellfox_inventory_current" i'), "广告诊断必须关联当前库存视图");
});

test("带日期范围/allDates 的库存浏览与导出按 Head 批次精确去重", () => {
  for (const [name, source] of [["browse", browseRoute], ["export", exportRoute]] as const) {
    assert.ok(source.includes("sellfoxInventoryHeadWhere"), `${name} 必须调用 Head 围栏`);
    assert.ok(source.includes("inventoryWhere"), `${name} 必须把 Head 条件并入 where`);
    assert.ok(!source.includes("prisma.sellfoxFbaInventorySnapshot.findMany({ where: snapshotWhere"), `${name} 不得再直接按 snapshotWhere 读原始快照`);
    assert.ok(!source.includes("prisma.sellfoxFbaInventorySnapshot.count({ where: snapshotWhere })"), `${name} 的总数也必须按 Head 口径统计`);
  }
  assert.ok(headHelper.includes('resource: "inventory"'), "Head 资源必须是 inventory");
  assert.ok(headHelper.includes("SellfoxStore: { organizationId"), "Head 必须经 SellfoxStore 做租户围栏");
  assert.ok(headHelper.includes("storeId, capturedAt"), "Head 必须精确匹配 (storeId, capturedAt) 批次");
  assert.ok(headHelper.includes("if (!heads.length) return {}"), "无 Head 记录时不得凭空隐藏数据");
});

test("Amazon 租户级表只对全店铺授权开放，单账号凭证仍拒绝", () => {
  assert.ok(amazonRead.includes('mode === "tenant_only" && fence.tenantWide'), "tenant_only 必须有全店铺授权分支");
  assert.ok(amazonRead.includes("fence.tenantWide === true"), "readable 必须受全店铺授权约束");
  assert.ok(amazonRead.includes("TENANT_WIDE_REQUIRES_ALL_SELLERS"), "拒绝原因必须可诊断");
  assert.match(amazonMcp, /tenantWide: localAccess\.allSellers/, "必须复用现有 allSellers，不新增权限体系");
  assert.ok(amazonRead.includes('throw new SyncInputError("该表没有店铺围栏列，不开放原始行读取。", 403)'),
    "未授权路径仍必须显式拒绝");
});
