import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const APP = new URL("../src/app/(erp)/", import.meta.url);
const ROUTES = ["sellfox/sales", "sellfox/performance", "sellfox/listings", "sellfox/restock", "amazon/catalog", "amazon/inventory", "product"];

test("7个高频数据页都有路由级loading.tsx骨架屏", () => {
  for (const route of ROUTES) {
    const file = new URL(`${route}/loading.tsx`, APP);
    assert.ok(existsSync(file), `${route} 缺少 loading.tsx`);
    const src = readFileSync(file, "utf8");
    assert.match(src, /DataPageSkeleton/, `${route} 未使用共享骨架组件`);
  }
});

test("共享骨架组件用令牌色且提供结构占位,不引入回退范式", () => {
  const src = readFileSync(new URL("../src/components/templates/data-page-skeleton.tsx", import.meta.url), "utf8");
  assert.match(src, /role="status"/);
  assert.match(src, /animate-pulse rounded bg-surface-muted/);
  assert.match(src, /aria-label/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}/, "不得硬编码十六进制色");
});

test("resource-table 加载态为骨架行而非纯文字,汇总区也有占位", () => {
  const src = readFileSync(new URL("../src/components/sellfox/resource-table.tsx", import.meta.url), "utf8");
  assert.match(src, /表格数据加载中/);
  assert.match(src, /汇总加载中/);
  assert.doesNotMatch(src, /loading \? "正在读取…" : emptyMessage/);
});
