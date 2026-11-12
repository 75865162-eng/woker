import test from "node:test";
import assert from "node:assert/strict";
import { financeReplicaCursorBinding, sealFinanceReplicaCursor, openFinanceReplicaCursor } from "@/lib/amazon-sync/finance-replica-cursor";
const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
test("finance page cursors bind actor, tenant, source, revision, generation and expiry", () => {
  const oldUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, oldSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET;
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-page-cursor-secret-with-32-bytes";
  try {
    const binding = financeReplicaCursorBinding(scope, "reader", "source", 1), now = Date.now();
    const value = { version: 1 as const, binding, generation: "generation", after: "transaction", expiresAt: now + 60000 };
    const token = sealFinanceReplicaCursor(value);
    assert.deepEqual(openFinanceReplicaCursor(token, binding, "generation", now), value);
    for (const other of [financeReplicaCursorBinding(scope, "admin", "source", 1), financeReplicaCursorBinding({ ...scope, workspaceId: "other" }, "reader", "source", 1), financeReplicaCursorBinding(scope, "reader", "other-source", 1), financeReplicaCursorBinding(scope, "reader", "source", 2)]) {
      assert.throws(() => openFinanceReplicaCursor(token, other, "generation", now));
    }
    assert.throws(() => openFinanceReplicaCursor(token, binding, "new-generation", now));
    assert.throws(() => openFinanceReplicaCursor(token, binding, "generation", now + 60000));
    assert.throws(() => openFinanceReplicaCursor(token + "x", binding, "generation", now));
    const [body, mac] = token.split(".");
    assert.throws(() => openFinanceReplicaCursor(`${Buffer.from(JSON.stringify({ ...value, after: "skip-ahead" })).toString("base64url")}.${mac}`, binding, "generation", now));
    assert.throws(() => openFinanceReplicaCursor(`${body}.${mac}.extra`, binding, "generation", now));
  } finally {
    if (oldUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = oldSecret;
  }
});

test("order page cursors share the signer while rejecting finance cursors and cross-domain replay", async () => {
  const { replicaPageCursorBinding, sealReplicaPageCursor, openReplicaPageCursor } = await import("@/lib/amazon-sync/replica-page-cursor");
  const oldUrl = process.env.AMAZON_CLOUD_EXECUTOR_URL, oldSecret = process.env.AMAZON_CLOUD_BRIDGE_SECRET;
  process.env.AMAZON_CLOUD_EXECUTOR_URL = "https://cloud.fixture.invalid";
  process.env.AMAZON_CLOUD_BRIDGE_SECRET = "offline-fixture-page-cursor-secret-with-32-bytes";
  try {
    const binding = replicaPageCursorBinding(scope, "reader", "source", 1, "orders"), now = Date.now();
    const value = { version: 1 as const, binding, generation: "generation", after: "order", expiresAt: now + 60000 };
    const token = sealReplicaPageCursor(value, "orders");
    assert.deepEqual(openReplicaPageCursor(token, binding, "generation", now, "orders"), value);
    assert.throws(() => openFinanceReplicaCursor(token, binding, "generation", now));
    assert.throws(() => openReplicaPageCursor(sealFinanceReplicaCursor(value), binding, "generation", now, "orders"));
    assert.throws(() => openReplicaPageCursor(token, replicaPageCursorBinding(scope, "admin", "source", 1, "orders"), "generation", now, "orders"));
    assert.throws(() => openReplicaPageCursor(token, binding, "changed", now, "orders"));
  } finally {
    if (oldUrl === undefined) delete process.env.AMAZON_CLOUD_EXECUTOR_URL; else process.env.AMAZON_CLOUD_EXECUTOR_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.AMAZON_CLOUD_BRIDGE_SECRET; else process.env.AMAZON_CLOUD_BRIDGE_SECRET = oldSecret;
  }
});
