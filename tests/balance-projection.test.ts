import test from "node:test";
import assert from "node:assert/strict";
import {
  rebuildBalanceProjection, projectionAsTrialRows, projectionUnchanged, BalanceProjectionError,
  type BalanceProjectionInput,
} from "../src/lib/finance/balance-projection";

const scope = { organizationId: "o1", workspaceId: "w1", bookId: "b1", currency: "CNY" };
const subjects = ["1001", "2001", "6001"];

function posted(id: string, sourceKey: string, lines: { accountId: string; debit: string; credit: string }[]) {
  return { id, sourceKey, status: "POSTED" as const, lines };
}

test("增量投影：期初 + POSTED 凭证 → 借正贷负 signed 余额，与 trialBalance 口径一致", () => {
  const input: BalanceProjectionInput = {
    ...scope, periodId: "p1", knownSubjectIds: subjects,
    opening: [{ accountId: "1001", amount: "100.000000", side: "DEBIT" }],
    vouchers: [posted("v1", "src-1", [
      { accountId: "1001", debit: "0.000000", credit: "30.000000" },
      { accountId: "6001", debit: "30.000000", credit: "0.000000" },
    ])],
  };
  const p = rebuildBalanceProjection(input);
  assert.equal(p.balanced, false, "期初借方 100 未配平（非凭证不平），balanced 反映整体差额");
  const bank = p.rows.find(r => r.accountId === "1001")!;
  assert.equal(bank.openingSigned, "100.000000");
  assert.equal(bank.debit, "0.000000");
  assert.equal(bank.credit, "30.000000");
  assert.equal(bank.closingSigned, "70.000000");
  const income = p.rows.find(r => r.accountId === "6001")!;
  assert.equal(income.closingSigned, "30.000000");
  assert.deepEqual(projectionAsTrialRows(p).map(r => r.accountId), ["1001", "6001"]);
});

test("balanced：期初借贷平衡 + 凭证平衡 → 整体归零", () => {
  const p = rebuildBalanceProjection({
    ...scope, periodId: "p2",
    opening: [
      { accountId: "1001", amount: "100.000000", side: "DEBIT" },
      { accountId: "2001", amount: "100.000000", side: "CREDIT" },
    ],
    vouchers: [posted("v1", "s1", [
      { accountId: "1001", debit: "0.000000", credit: "10.000000" },
      { accountId: "2001", debit: "10.000000", credit: "0.000000" },
    ])],
  });
  assert.equal(p.openingDifference, "0.000000");
  assert.equal(p.movementDifference, "0.000000");
  assert.equal(p.closingDifference, "0.000000");
  assert.equal(p.balanced, true);
});

test("sourceHash 稳定：同输入 + 同 revision 哈希一致（幂等）；revision 或凭证变化则变", () => {
  const input: BalanceProjectionInput = {
    ...scope, periodId: "p3", baseRevision: 5,
    opening: [{ accountId: "1001", amount: "1.000000", side: "DEBIT" }],
    vouchers: [posted("v1", "s1", [
      { accountId: "1001", debit: "0.000000", credit: "1.000000" },
      { accountId: "6001", debit: "1.000000", credit: "0.000000" },
    ])],
  };
  const a = rebuildBalanceProjection(input);
  const b = rebuildBalanceProjection(input);
  assert.equal(a.sourceHash, b.sourceHash);
  assert.equal(a.revision, 6);
  assert.equal(projectionUnchanged(a, b), true);
  const c = rebuildBalanceProjection({ ...input, baseRevision: 6 });
  assert.notEqual(a.sourceHash, c.sourceHash);
  const d = rebuildBalanceProjection({ ...input, vouchers: [] });
  assert.notEqual(a.sourceHash, d.sourceHash);
});

test("拒绝非 POSTED 凭证与重复来源/科目（fail-closed，绝不静默忽略）", () => {
  assert.throws(() => rebuildBalanceProjection({
    ...scope, periodId: "p4",
    opening: [], vouchers: [{ id: "d1", sourceKey: "s1", status: "DRAFT", lines: [] }],
  }), BalanceProjectionError, "DRAFT 不得进入投影");
  assert.throws(() => rebuildBalanceProjection({
    ...scope, periodId: "p5",
    opening: [{ accountId: "1001", amount: "1", side: "DEBIT" }, { accountId: "1001", amount: "2", side: "DEBIT" }],
    vouchers: [],
  }), BalanceProjectionError, "期初科目重复");
  assert.throws(() => rebuildBalanceProjection({
    ...scope, periodId: "p6", knownSubjectIds: ["1001"],
    opening: [], vouchers: [posted("v1", "s1", [{ accountId: "9999", debit: "1", credit: "0" }])],
  }), BalanceProjectionError, "科目不在已知集合");
});

test("缺值不补零：无任何科目出现时 rows 为空，不产生隐式 0 行", () => {
  const p = rebuildBalanceProjection({ ...scope, periodId: "p7", opening: [], vouchers: [] });
  assert.deepEqual(p.rows, []);
  assert.equal(p.balanced, true);
});
