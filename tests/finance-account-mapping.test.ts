import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAccount, resolveAccounts, assertNoMappingConflicts, createMapping, AccountMappingError,
  type AccountMapping,
} from "../src/lib/finance/account-mapping";

const scope = { organizationId: "o1", workspaceId: "w1", bookId: "b1" };
const m = (feeType: string, subjectId: string, priority = 0, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): AccountMapping =>
  ({ ...scope, feeType, subjectId, priority, status, version: 1 });

test("resolveAccount: 取启用项，按优先级高者", () => {
  const mappings = [
    m("freight", "sub-low", 0),
    m("freight", "sub-high", 10),
    m("amazon_fee", "sub-amz", 0),
  ];
  assert.equal(resolveAccount(mappings, scope, "freight")?.subjectId, "sub-high");
  assert.equal(resolveAccount(mappings, scope, "amazon_fee")?.subjectId, "sub-amz");
});

test("停用项不参与解析；无匹配返回 null（不臆造默认科目）", () => {
  const mappings = [m("freight", "sub", 0, "INACTIVE")];
  assert.equal(resolveAccount(mappings, scope, "freight"), null);
  assert.equal(resolveAccount(mappings, scope, "unknown"), null);
});

test("租户/账套隔离：跨 scope 的映射不可见", () => {
  const mappings = [m("freight", "sub", 0)];
  assert.equal(resolveAccount(mappings, { ...scope, bookId: "b2" }, "freight"), null);
  assert.equal(resolveAccount(mappings, { ...scope, workspaceId: "w2" }, "freight"), null);
  assert.equal(resolveAccount(mappings, { ...scope, organizationId: "o2" }, "freight"), null);
});

test("同 feeType 同优先级多启用项 → 冲突报错，不静默任选", () => {
  const mappings = [m("freight", "sub-a", 5), m("freight", "sub-b", 5)];
  assert.throws(() => resolveAccount(mappings, scope, "freight"), AccountMappingError);
  assert.throws(() => assertNoMappingConflicts(mappings), AccountMappingError);
});

test("assertNoMappingConflicts: 停用项不冲突；指向相同科目不算冲突", () => {
  assert.doesNotThrow(() => assertNoMappingConflicts([m("freight", "a", 0, "INACTIVE"), m("freight", "b", 0)]));
  assert.doesNotThrow(() => assertNoMappingConflicts([m("freight", "a", 0), m("freight", "a", 0)]));
});

test("resolveAccounts 批量：unresolved 明确列出缺映射项", () => {
  const mappings = [m("freight", "sub-f", 0), m("commission", "sub-c", 0)];
  const out = resolveAccounts(mappings, scope, ["freight", "commission", "tax", "vat"]);
  assert.deepEqual(out.resolved, { freight: "sub-f", commission: "sub-c", tax: null, vat: null });
  assert.deepEqual(out.unresolved, ["tax", "vat"]);
});

test("createMapping: 字段校验（空值/非法 priority/版本）", () => {
  assert.doesNotThrow(() => createMapping(m("ok", "sub")));
  assert.throws(() => createMapping({ ...m("x", "sub"), feeType: "  " }), AccountMappingError);
  assert.throws(() => createMapping({ ...m("x", "sub"), priority: 1.5 }), AccountMappingError);
  assert.throws(() => createMapping({ ...m("x", "sub"), version: 0 }), AccountMappingError);
});
