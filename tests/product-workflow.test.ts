import assert from "node:assert/strict";
import test from "node:test";

import type { Product } from "@/lib/products/types";
import { stampProductAuditIdentity } from "@/lib/products/audit-identity";

function createProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    sku: "SKU-1",
    chineseName: "测试商品",
    englishName: "Test product",
    asin: "ASIN-1",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "2026-09-16T00:00:00.000Z",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: [],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: { length: 0, width: 0, height: 0 },
    packageSizeCm: { length: 0, width: 0, height: 0 },
    workflowHistory: [],
    ...overrides,
  };
}

test("server stamps the current session user onto new workflow events and preserves stored history", () => {
  const existingEvent = {
    id: "event-existing",
    stage: "selection_pending" as const,
    stageLabel: "选品待提交",
    actorName: "历史操作人",
    createdAt: "2026-09-15T00:00:00.000Z",
  };
  const tamperedExistingEvent = {
    ...existingEvent,
    actorName: "伪造操作人",
  };
  const newEvent = {
    id: "event-new",
    stage: "design_in_progress" as const,
    stageLabel: "美工处理中",
    actorName: "Super Admin",
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = stampProductAuditIdentity({
    product: createProduct({
      status: "design_in_progress",
      workflowStage: "design_in_progress",
      workflowHistory: [newEvent, tamperedExistingEvent],
    }),
    existingProduct: { workflowHistory: [existingEvent] },
    user: { id: "user-designer", name: "美工账号" },
    createdAt: new Date("2026-09-16T08:00:00.000Z"),
  });

  assert.equal(result.workflowHistory?.[0]?.actorUserId, "user-designer");
  assert.equal(result.workflowHistory?.[0]?.actorName, "美工账号");
  assert.equal(result.workflowHistory?.[1]?.actorName, "历史操作人");
});

test("server controls operations progress audit fields from the current session", () => {
  const existingProgress = {
    orderQuantity: 1,
    shipDate: "",
    forecastMonthlySales: 10,
    forecastPrice: 8,
    stages: [],
    updatedAt: "2026-09-15T00:00:00.000Z",
    updatedBy: "历史操作人",
    history: [
      {
        id: "ops-existing",
        changedAt: "2026-09-15T00:00:00.000Z",
        changedBy: "历史操作人",
        summary: "历史更新",
      },
    ],
  };

  const result = stampProductAuditIdentity({
    product: createProduct({
      operationsProgress: {
        ...existingProgress,
        orderQuantity: 2,
        updatedBy: "伪造操作人",
        history: [
          {
            id: "ops-forged",
            changedAt: "2026-09-16T00:00:00.000Z",
            changedBy: "伪造操作人",
            summary: "伪造更新",
          },
        ],
      },
    }),
    existingProduct: { operationsProgress: existingProgress },
    user: { id: "user-ops", name: "运营账号" },
    createdAt: new Date("2026-09-16T08:00:00.000Z"),
  });

  assert.equal(result.operationsProgress?.updatedByUserId, "user-ops");
  assert.equal(result.operationsProgress?.updatedBy, "运营账号");
  assert.equal(result.operationsProgress?.history[0]?.changedByUserId, "user-ops");
  assert.equal(result.operationsProgress?.history[0]?.changedBy, "运营账号");
  assert.equal(result.operationsProgress?.history[1]?.changedBy, "历史操作人");
});

test("server rejects workflow history tampering when the workflow stage is unchanged", () => {
  const existingEvent = {
    id: "event-existing",
    stage: "ops_confirming" as const,
    stageLabel: "运营确认中",
    actorName: "历史操作人",
    createdAt: "2026-09-15T00:00:00.000Z",
  };

  const result = stampProductAuditIdentity({
    product: createProduct({
      status: "ops_review",
      workflowStage: "ops_confirming",
      workflowHistory: [{ ...existingEvent, actorName: "伪造操作人" }],
    }),
    existingProduct: {
      status: "ops_review",
      workflowStage: "ops_confirming",
      workflowHistory: [existingEvent],
    },
    user: { id: "user-ops", name: "运营账号" },
    createdAt: new Date("2026-09-16T08:00:00.000Z"),
  });

  assert.equal(result.workflowHistory?.length, 1);
  assert.equal(result.workflowHistory?.[0]?.actorName, "历史操作人");
});

test("product restore keeps stored workflow history and appends a restore event", () => {
  const existingEvent = {
    id: "event-existing",
    stage: "ops_confirming" as const,
    stageLabel: "运营确认中",
    actorName: "历史操作人",
    createdAt: "2026-09-15T00:00:00.000Z",
  };
  const restoredPayloadEvent = {
    id: "event-from-old-version",
    stage: "selection_pending" as const,
    stageLabel: "选品待提交",
    actorName: "旧版本操作人",
    createdAt: "2026-09-10T00:00:00.000Z",
  };

  const result = stampProductAuditIdentity({
    product: createProduct({ workflowHistory: [restoredPayloadEvent] }),
    existingProduct: { workflowHistory: [existingEvent] },
    user: { id: "user-admin", name: "管理员" },
    eventType: "product_restored",
    createdAt: new Date("2026-09-16T08:00:00.000Z"),
  });

  assert.equal(result.workflowHistory?.[0]?.actorUserId, "user-admin");
  assert.equal(result.workflowHistory?.[0]?.actorName, "管理员");
  assert.equal(result.workflowHistory?.[0]?.note, "恢复商品历史版本。");
  assert.equal(result.workflowHistory?.[1]?.id, "event-existing");
  assert.equal(result.workflowHistory?.some((event) => event.id === "event-from-old-version"), false);
});
