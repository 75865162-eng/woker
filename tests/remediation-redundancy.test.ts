import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceScope, readWorkspaceScopeId, workspaceScopeStorageKey } from "@/lib/workspace/workspace-scope-store";
import { computePointsPeriodQuotaFields } from "@/lib/points/summary";
import { normalizeCampaignGroups, numberValue } from "@/lib/agent-platform/ppc-normalization";

test("冗余清理：数字转换已提供回退值，活动组无需二次空值兜底", () => {
  for (const value of [undefined, null, "", "bad", Infinity, false]) {
    assert.equal(numberValue(value, 0), 0);
    assert.equal(normalizeCampaignGroups([{ id: "group", keywordCount: value }])[0].keywordCount, 0);
  }
  assert.equal(normalizeCampaignGroups([{ keywordCount: "12" }])[0].keywordCount, 12);
  assert.equal(normalizeCampaignGroups([{ keywordCount: 0 }])[0].keywordCount, 0);
});

const legacyScopeKey = "tiaotiao.workspace.scope";

function withStorage(values: Record<string, string>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const store = new Map(Object.entries(values));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

test("冗余清理：历史 scope 键已无回退，仅有 legacy 键时落到 default", () => {
  const restore = withStorage({ [legacyScopeKey]: JSON.stringify({ workspaceId: "ws-legacy" }) });
  try {
    assert.equal(readWorkspaceScopeId(), "default");
    assert.deepEqual(readWorkspaceScope(), { workspaceId: "default", accountId: "", marketplace: "" });
  } finally {
    restore();
  }
});

test("冗余清理：唯一 scope 键正常读取，且不受 legacy 键干扰", () => {
  const restore = withStorage({
    [workspaceScopeStorageKey]: JSON.stringify({ workspaceId: " ws-main ", accountId: " account-main ", marketplace: " US " }),
    [legacyScopeKey]: JSON.stringify({ workspaceId: "ws-legacy", accountId: "account-legacy" }),
  });
  try {
    assert.deepEqual(readWorkspaceScope(), { workspaceId: "ws-main", accountId: "account-main", marketplace: "US" });
  } finally {
    restore();
  }
});

test("冗余清理：积分周期额度字段由单一函数计算，单人视图与组织总览口径一致", () => {
  const full = computePointsPeriodQuotaFields({ baseQuota: 100, carriedIn: 20, extraGranted: 5, consumed: 30 });
  assert.deepEqual(full, { baseQuota: 100, carriedIn: 20, extraGranted: 5, consumed: 30, totalQuota: 125 });

  const partial = computePointsPeriodQuotaFields({ baseQuota: 10, carriedIn: 0, extraGranted: 0, consumed: 2 });
  assert.deepEqual(partial, { baseQuota: 10, carriedIn: 0, extraGranted: 0, consumed: 2, totalQuota: 10 });

  assert.deepEqual(computePointsPeriodQuotaFields(null), { baseQuota: 0, carriedIn: 0, extraGranted: 0, consumed: 0, totalQuota: 0 });
  assert.deepEqual(computePointsPeriodQuotaFields(undefined), { baseQuota: 0, carriedIn: 0, extraGranted: 0, consumed: 0, totalQuota: 0 });
  assert.equal(full.totalQuota, full.baseQuota + full.carriedIn + full.extraGranted);
});
