import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionDemo, prepareDemoOrder, prepareDemoRollback, transitionDemoOrder } from "@/lib/amazon-ads/decision-demo";

const key = (state: ReturnType<typeof createDecisionDemo>, suffix: string) => state.entities.find(row => row.id.endsWith(`/${suffix}`))!;
const action = (entityId: string, value: number, type: "update_bid" | "update_budget" = "update_bid") => ({ type, entityId, value, reason: "fixture spend, sales and clicks" });

test("decision demo limits writes by site and blocks unknown, out-of-stock, lost-buy-box, and archived contexts", () => {
  for (const suffix of ["empty", "lost", "unknown", "archived"]) {
    const state = createDecisionDemo("northstar", "US");
    assert.throws(() => prepareDemoOrder(state, { id: `blocked-${suffix}`, source: "页面", actions: [action(key(state, suffix).id, 2)] }));
  }
  const ca = createDecisionDemo("northstar", "CA");
  assert.throws(() => prepareDemoOrder(ca, { id: "blocked-market", source: "页面", actions: [action(key(ca, "healthy").id, 2)] }), /站点/);
  const noBusiness = createDecisionDemo("evergreen", "US");
  assert.throws(() => prepareDemoOrder(noBusiness, { id: "blocked-capability", source: "页面", actions: [action(key(noBusiness, "healthy").id, 2)] }), /经营/);
});

test("keyword drafts enforce unique identity and execute only after reviewed approval", () => {
  let state = createDecisionDemo("northstar", "US");
  const parent = key(state, "healthy");
  const create = { type: "create_keyword" as const, entityId: parent.id, value: 1.2, reason: "fixture search term evidence", keyword: "new storage basket", match: "EXACT" };
  state = prepareDemoOrder(state, { id: "create-first", source: "页面", actions: [create] });
  assert.throws(() => prepareDemoOrder(state, { id: "create-duplicate", source: "页面", actions: [create] }), /已存在/);
  assert.throws(() => transitionDemoOrder(state, "create-first", "submit"), /dry-run/);
  state = transitionDemoOrder(state, "create-first", "review");
  state = transitionDemoOrder(state, "create-first", "submit");
  state = transitionDemoOrder(state, "create-first", "approve");
  state = transitionDemoOrder(state, "create-first", "execute");
  state = transitionDemoOrder(state, "create-first", "finish");
  assert.equal(state.orders.find(order => order.id === "create-first")?.status, "done");
  assert.equal(state.entities.some(entity => entity.name === create.keyword && entity.status === "paused"), true);
  assert.throws(() => prepareDemoRollback(state, "create-first", "create-rollback"), /不支持自动逆向/);
});

test("AI evidence is required and rollback rejects a changed snapshot", () => {
  let state = createDecisionDemo("northstar", "US");
  const target = key(state, "healthy");
  assert.throws(() => prepareDemoOrder(state, { id: "no-evidence", source: "AI", actions: [action(target.id, 1.1)] }), /数据时间戳与有效指标/);
  state = prepareDemoOrder(state, { id: "bid-change", source: "页面", actions: [action(target.id, 1.1)] });
  state = transitionDemoOrder(state, "bid-change", "review");
  state = transitionDemoOrder(state, "bid-change", "submit");
  state = transitionDemoOrder(state, "bid-change", "approve");
  state = transitionDemoOrder(state, "bid-change", "execute");
  state = transitionDemoOrder(state, "bid-change", "finish");
  const changed = { ...state, entities: state.entities.map(entity => entity.id === target.id ? { ...entity, bid: 1.2 } : entity) };
  assert.throws(() => prepareDemoRollback(changed, "bid-change", "rollback-conflict"), /冲突/);
  const rollback = prepareDemoRollback(state, "bid-change", "rollback-ok");
  assert.equal(rollback.orders.at(-1)?.status, "draft");
  assert.equal(rollback.orders.at(-1)?.inverseOf, "bid-change");
  assert.throws(() => prepareDemoRollback(rollback, "bid-change", "rollback-duplicate"), /已生成逆向单/);
});

test("partial execution records each result and rollback includes successful items only", () => {
  let state = createDecisionDemo("northstar", "US");
  const first = key(state, "healthy"), second = key(state, "target");
  state = prepareDemoOrder(state, { id: "batch", source: "页面", actions: [action(first.id, 1.1), action(second.id, 1.15)] });
  state = transitionDemoOrder(state, "batch", "review");
  state = transitionDemoOrder(state, "batch", "submit");
  state = transitionDemoOrder(state, "batch", "approve");
  state = transitionDemoOrder(state, "batch", "execute");
  state = transitionDemoOrder(state, "batch", "finish", [second.id]);
  assert.equal(state.orders.find(order => order.id === "batch")?.status, "partial_failed");
  const rollback = prepareDemoRollback(state, "batch", "batch-rollback");
  assert.equal(rollback.orders.at(-1)?.items.length, 1);
  assert.equal(rollback.orders.at(-1)?.items[0].action.entityId, first.id);
});
