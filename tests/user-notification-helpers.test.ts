import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentPopupNotificationId,
  getProductWorkflowNotificationLink,
  mergeWorkspaceScope,
} from "@/lib/notifications/user-notification-helpers";

test("workflow notification deep links preserve SKU and workspace query", () => {
  assert.deepEqual(getProductWorkflowNotificationLink({
    type: "product_workflow_overdue",
    metadata: { sku: "SKU 1", workspaceId: "workspace/a" },
  }), {
    sku: "SKU 1",
    workspaceId: "workspace/a",
    href: "/dashboard?sku=SKU%201&workspaceId=workspace%2Fa",
  });
  assert.equal(getProductWorkflowNotificationLink({ type: "other", metadata: { sku: "x", workspaceId: "w" } }), null);
});

test("popup close action reads the currently displayed notification", () => {
  const displayed = { id: "notification-2" };
  assert.equal(getCurrentPopupNotificationId(displayed), "notification-2");
  assert.equal(getCurrentPopupNotificationId(null), null);
});

test("workspace deep link scope preserves selector account fields and targets cookie-compatible shape", () => {
  assert.deepEqual(mergeWorkspaceScope(JSON.stringify({ workspaceId: "old", accountId: "account", marketplace: "US" }), "new"), {
    workspaceId: "new",
    accountId: "account",
    marketplace: "US",
  });
});
