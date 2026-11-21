import assert from "node:assert/strict";
import test from "node:test";
import { productionRecoveryUnlocked } from "@/lib/amazon-sync/approval-policy";

const scope = { organizationId: "cmvmlgplb0000yfvbf9f8ls9g", workspaceId: "default" };
const keys = ["AMAZON_DATA_CENTER_RECOVERY_UNLOCK", "AMAZON_DATA_CENTER_RECOVERY_SCOPES"] as const;

test("production recovery unlock is off by default and requires explicit flag plus exact scope allowlist", () => {
  const prior = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(productionRecoveryUnlocked(scope), false);

    process.env.AMAZON_DATA_CENTER_RECOVERY_UNLOCK = "1";
    assert.equal(productionRecoveryUnlocked(scope), false, "flag alone must not unlock");

    process.env.AMAZON_DATA_CENTER_RECOVERY_SCOPES = "not-json";
    assert.equal(productionRecoveryUnlocked(scope), false, "malformed allowlist must not unlock");

    process.env.AMAZON_DATA_CENTER_RECOVERY_SCOPES = JSON.stringify([["other-org", "default"]]);
    assert.equal(productionRecoveryUnlocked(scope), false, "non-matching scope must not unlock");

    process.env.AMAZON_DATA_CENTER_RECOVERY_SCOPES = JSON.stringify([["other-org", "default"], [scope.organizationId, scope.workspaceId]]);
    assert.equal(productionRecoveryUnlocked(scope), true, "exact allowlisted scope with flag must unlock");

    assert.equal(productionRecoveryUnlocked({ organizationId: scope.organizationId, workspaceId: "other" }), false, "workspace must match exactly");

    process.env.AMAZON_DATA_CENTER_RECOVERY_UNLOCK = "0";
    assert.equal(productionRecoveryUnlocked(scope), false, "flag must be exactly 1");
  } finally {
    for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
  }
});
