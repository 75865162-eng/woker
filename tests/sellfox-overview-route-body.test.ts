import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 回归防护：/api/sellfox/overview 的 load() 必须返回普通数据对象，
 * 不能返回 NextResponse.json(...)。
 *
 * 根因回顾：readThroughSellfox 把 load 的返回值当作 body 缓存，
 * 外层再 `NextResponse.json({ ...result.body, cache })` 展开。
 * Response 对象的业务字段（stores/configured/counts...）不在自有可枚举属性上，
 * 展开后 body 只剩 cache → 前端 `body.stores ?? []` 恒为空 → 站点/店铺/业务员下拉全空。
 */

const ROUTE_PATH = join(process.cwd(), "src/app/api/sellfox/overview/route.ts");

test("overview load returns a plain object, never a NextResponse (spread would drop stores)", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");

  // 定位 load 函数体：从 `const load = async () => {` 到其后匹配的 `};`（到 readThroughSellfox 之前）。
  const loadStart = src.indexOf("const load = async () => {");
  const readThrough = src.indexOf("const result = await readThroughSellfox", loadStart);
  assert.ok(loadStart >= 0 && readThrough > loadStart, "load function and readThroughSellfox must exist");
  const loadBody = src.slice(loadStart, readThrough);

  // 剥离行注释与块注释，避免注释里提到的 NextResponse.json 造成误判。
  const codeOnly = loadBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // 核心断言：load 内部不能出现 NextResponse.json（它是 Response，不是可展开的普通对象）。
  assert.ok(
    !codeOnly.includes("NextResponse.json"),
    "overview load() must return a plain object; returning NextResponse.json loses all business fields when spread into the cached body",
  );

  // 正向断言：load 内确实返回了带 stores 的普通对象字面量。
  assert.ok(/return\s*\{[\s\S]*stores,/.test(loadBody), "load() must return a plain object containing stores");

  // 外层仍然只包裹一次 NextResponse.json，并展开 result.body。
  const tail = src.slice(readThrough);
  assert.ok(
    tail.includes("NextResponse.json({ ...result.body, cache"),
    "the single outer NextResponse.json must spread result.body",
  );
});

test("spreading a Response drops payload fields while spreading a plain object keeps them (root-cause demonstration)", async () => {
  const payload = { stores: [{ externalId: "1", name: "shop" }], configured: true, counts: { stores: 1 } };
  const response = Response.json({ ...payload, cache: { status: "miss" } });

  // 模拟外层 `{ ...result.body, cache }` 的错误情形：body 是 Response。
  const wrong = { ...(response as unknown as Record<string, unknown>), cache: { status: "miss" } };
  assert.equal((wrong as { stores?: unknown }).stores, undefined, "Response spread must lose stores (reproduces the bug)");

  // 正确情形：body 是普通对象。
  const right = { ...payload, cache: { status: "miss" } };
  assert.equal(right.stores.length, 1, "plain-object spread must keep stores");
  assert.equal(right.configured, true);
});
