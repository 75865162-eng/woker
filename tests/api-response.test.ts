import test from "node:test";
import assert from "node:assert/strict";
import { parsePagination } from "@/lib/server/api-response";

test("parsePagination: 默认值 + 上下界钳制", () => {
  const empty = new URLSearchParams();
  assert.deepEqual(parsePagination(empty), { page: 1, pageSize: 20 });

  const p = new URLSearchParams("page=3&pageSize=50");
  assert.deepEqual(parsePagination(p), { page: 3, pageSize: 50 });

  // 非法/负数/0 → 回退默认
  const bad = new URLSearchParams("page=abc&pageSize=-5");
  assert.deepEqual(parsePagination(bad), { page: 1, pageSize: 20 });

  // 超上限 → 钳制
  const big = new URLSearchParams("pageSize=9999");
  assert.deepEqual(parsePagination(big, { maxPageSize: 100 }), { page: 1, pageSize: 100 });

  // 自定义默认
  assert.deepEqual(parsePagination(empty, { pageSize: 10 }), { page: 1, pageSize: 10 });
});
