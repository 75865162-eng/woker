import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { navigationGroups } from "@/components/app-shell/business-navigation";

const profitPage = readFileSync(
  path.join(process.cwd(), "src/app/(erp)/sellfox/profit/page.tsx"),
  "utf8",
);

test("/sellfox/profit 默认承接销量统计工作台，?view=report 保留利润报表", () => {
  // 默认渲染销量工作台（与 /sellfox/sales 同一实例，不维护第二套算法）。
  assert.match(profitPage, /SalesStatsWorkbench/, "默认视图应复用销量统计工作台组件");
  assert.match(profitPage, /searchParams/, "应通过 searchParams 选择视图");
  // view=report 时渲染原利润报表 HostWorkbench。
  assert.match(profitPage, /view === "report"/, "应识别 view=report");
  assert.match(profitPage, /<HostWorkbench/, "report 视图应渲染利润报表");
  // 两个 URL 使用同一 sales 配置源，不出现独立的销量聚合算法。
  const salesPage = readFileSync(
    path.join(process.cwd(), "src/app/(erp)/sellfox/sales/page.tsx"),
    "utf8",
  );
  assert.match(salesPage, /SalesStatsWorkbench/, "/sellfox/sales 仍复用同一销量工作台");
});

test("导航保留 /sellfox/profit 直达与利润报表独立入口", () => {
  const sellfox = navigationGroups.find((group) => group.id === "sellfox")!;
  assert.equal(sellfox.href, "/sellfox/profit", "赛狐一级落地仍为 /sellfox/profit");
  assert.ok(sellfox.items.some((item) => item.href === "/sellfox/profit" && item.label === "销量统计"));
  assert.ok(
    sellfox.items.some((item) => item.href === "/sellfox/profit?view=report" && item.label === "利润报表"),
    "应保留可点击的利润报表入口，不能静默删除原入口",
  );
});
