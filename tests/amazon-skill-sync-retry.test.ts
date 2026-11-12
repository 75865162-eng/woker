import assert from "node:assert/strict";
import test from "node:test";
import { skillSyncRetryCommand } from "../src/lib/amazon-sync/skill-sync-retry";

test("reimbursement and ledger retries reuse the existing task through approval", () => {
  for (const resource of ["orders", "reimbursements", "inventory_events"]) {
    assert.deepEqual(skillSyncRetryCommand(resource, { id: "original-task", resource, status: "FAILED", stage: "REPORT_CREATE_REJECTED" }, { taskId: "original-task" }),
      { action: "control-task", id: "original-task", control: "retry" });
    assert.throws(() => skillSyncRetryCommand(resource, null, {}), /数据范围/);
    for (const status of ["SUCCEEDED", "RUNNING", "CANCELLED", "WAITING"]) assert.throws(() => skillSyncRetryCommand(resource, { id: "t", resource, status, stage: "FETCHING" }, {}), /不能申请/);
    assert.throws(() => skillSyncRetryCommand(resource, { id: "t", resource, status: "FAILED", stage: "PURGED" }, {}), /不能申请/);
    for (const field of ["dateFrom", "dateTo", "eventType"]) assert.throws(() => skillSyncRetryCommand(resource, { id: "t", resource, status: "FAILED", stage: "FETCHING" }, { [field]: "new-scope" }), /原时间窗/);
  }
});

test("retry rejects wrong resources and preserves orders partial-success boundary", () => {
  assert.throws(() => skillSyncRetryCommand("inventory", null, {}), /暂不支持/);
  assert.throws(() => skillSyncRetryCommand("reimbursements", { id: "t", resource: "inventory_events", status: "FAILED", stage: "FETCHING" }, {}), /数据范围/);
  assert.throws(() => skillSyncRetryCommand("orders", { id: "t", resource: "orders", status: "PARTIAL_SUCCESS", stage: "FETCHING" }, {}), /不能申请/);
  assert.equal(skillSyncRetryCommand("inventory_events", { id: "t", resource: "inventory_events", status: "PARTIAL_SUCCESS", stage: "FETCHING" }, {}).id, "t");
});

test("first-batch checkpoint resources use existing approval controls and keep cancellations bounded", () => {
  for (const resource of ["finance", "returns", "fulfillment", "catalog_items", "listing_details"]) {
    const task = { id: "original", resource, status: "FAILED", stage: "FETCHING" };
    assert.deepEqual(skillSyncRetryCommand(resource, task, {}), { action: "control-task", id: task.id, control: "retry" });
    assert.deepEqual(skillSyncRetryCommand(resource, { ...task, status: "PAUSED" }, {}), { action: "control-task", id: task.id, control: "resume" });
    for (const stage of ["BINDING_DISABLED", "PURGED"]) assert.throws(() => skillSyncRetryCommand(resource, { ...task, stage }, {}), /不能申请/);
    if (["catalog_items", "listing_details"].includes(resource)) assert.equal(skillSyncRetryCommand(resource, { ...task, status: "CANCELLED" }, {}).control, "retry");
    else assert.throws(() => skillSyncRetryCommand(resource, { ...task, status: "CANCELLED" }, {}), /不能申请/);
  }
});

test("paused orders resume their original checkpoint while other resources keep their retry boundary", () => {
  const task = { id: "paused-order", resource: "orders", status: "PAUSED", stage: "FETCHING_DETAILS" };
  assert.deepEqual(skillSyncRetryCommand("orders", task, { taskId: task.id }), { action: "control-task", id: task.id, control: "resume" });
  for (const field of ["dateFrom", "dateTo", "eventType"]) assert.throws(() => skillSyncRetryCommand("orders", task, { [field]: "new-scope" }), /原时间窗/);
  assert.throws(() => skillSyncRetryCommand("orders", { ...task, stage: "PURGED" }, {}), /不能申请/);
  for (const resource of ["reimbursements", "inventory_events"]) assert.equal(skillSyncRetryCommand(resource, { ...task, resource }, {}).control, "resume");
});
