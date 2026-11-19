import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertView, type CachedView } from "../src/components/app-shell/persistent-app-shell";

/**
 * 保活视图状态机测试。
 *
 * 复现目标（文档第三阶段 A/G）：连续打开/切换多个页面后，视图注册表必须满足：
 * 1. 同一 href 永远只有一个视图（无重复）；
 * 2. 激活页永远在注册表里；
 * 3. 视图数不超过 MAX_VIEWS=6，按 LRU 淘汰最久未用；
 * 4. seq 单调递增且唯一（LRU 排序正确）。
 *
 * 这里直接调用生产代码 upsertView，不 mock、不臆造——测试失败即真实缺陷。
 */
const NOOP_CONTEXT = Symbol("layout-context") as never;
const MAX_VIEWS = 6;

test("upsertView keeps a single entry per href across repeated navigation", () => {
  let views: CachedView[] = [];
  const sequence = ["/dashboard", "/sellfox/profit", "/operations", "/dashboard", "/operations", "/dashboard"];
  for (let i = 0; i < sequence.length; i++) {
    views = upsertView(views, sequence[i], sequence[i], NOOP_CONTEXT);
    const hits = views.filter((v) => v.href === sequence[i]);
    assert.equal(hits.length, 1, `href ${sequence[i]} must appear exactly once after step ${i}`);
  }
});

test("upsertView is idempotent in membership but monotonic in seq", () => {
  // 记录当前行为：即使 href 内容不变，重复 upsert 也会刷新 seq 并产生新数组。
  // 这正是 effect(:194-200) 每次 children/context 引用变化都会触发的动作。
  const first = upsertView([], "/dashboard", "/dashboard", NOOP_CONTEXT);
  const seqBefore = first[0].seq;
  const second = upsertView(first, "/dashboard", "/dashboard", NOOP_CONTEXT);
  assert.notEqual(second, first, "upsertView always returns a new array");
  assert.ok(second[0].seq > seqBefore, "seq increases on every upsert");
  assert.equal(second.length, 1, "membership stays a single view");
});

test("upsertView enforces MAX_VIEWS LRU and always keeps the just-activated href", () => {
  let views: CachedView[] = [];
  const opened = ["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"];
  for (const href of opened) {
    views = upsertView(views, href, href, NOOP_CONTEXT);
    assert.ok(views.length <= MAX_VIEWS, `views must stay <= ${MAX_VIEWS}`);
    assert.ok(views.some((v) => v.href === href), `just-activated ${href} must be retained`);
  }
  // 打开 8 个页面后只有最近 6 个视图；最早两个被淘汰。
  const keptHrefs = new Set(views.map((v) => v.href));
  assert.equal(keptHrefs.has("/a"), false, "/a should be LRU-evicted");
  assert.equal(keptHrefs.has("/b"), false, "/b should be LRU-evicted");
  assert.equal(keptHrefs.has("/h"), true);

  // 关键点：MAX_TABS=8 > MAX_VIEWS=6，被淘汰的 /a 仍可能是有效 tab。
  // 点回 /a 必须重新注册且不重复。
  views = upsertView(views, "/a", "/a", NOOP_CONTEXT);
  assert.equal(views.filter((v) => v.href === "/a").length, 1);
  assert.ok(views.length <= MAX_VIEWS);
  assert.ok(views.some((v) => v.href === "/a"), "re-opened tab must be re-registered");
});

test("upsertView keeps seq unique and ordered by recency", () => {
  let views: CachedView[] = [];
  for (const href of ["/x", "/y", "/z"]) views = upsertView(views, href, href, NOOP_CONTEXT);
  views = upsertView(views, "/x", "/x", NOOP_CONTEXT); // 再把 /x 提到最近
  const seqs = views.map((v) => v.seq);
  assert.equal(new Set(seqs).size, seqs.length, "seq must be unique across views");
  const x = views.find((v) => v.href === "/x")!;
  assert.equal(x.seq, Math.max(...seqs), "reactivated view must have the largest seq");
});

test("rapid toggling never grows views unbounded (A/B 50 switches)", () => {
  let views: CachedView[] = [];
  for (let i = 0; i < 50; i++) {
    views = upsertView(views, i % 2 ? "/a" : "/b", i % 2 ? "/a" : "/b", NOOP_CONTEXT);
  }
  assert.ok(views.length <= 2, "toggling two cached pages must not grow views");
  assert.equal(new Set(views.map((v) => v.href)).size, views.length);
});
