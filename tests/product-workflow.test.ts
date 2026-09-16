import assert from "node:assert/strict";
import test from "node:test";

import type { Product } from "@/lib/products/types";
import { stampNewWorkflowEventActors } from "@/lib/products/workflow";

function createProduct(workflowHistory: NonNullable<Product["workflowHistory"]>): Product {
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
    workflowHistory,
  };
}

test("stamps the current session user onto new workflow events only", () => {
  const existingEvent = {
    id: "event-existing",
    stage: "selection_pending" as const,
    stageLabel: "选品待提交",
    actorName: "历史操作人",
    createdAt: "2026-09-15T00:00:00.000Z",
  };
  const newEvent = {
    id: "event-new",
    stage: "design_in_progress" as const,
    stageLabel: "美工处理中",
    actorName: "Super Admin",
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = stampNewWorkflowEventActors(
    createProduct([newEvent, existingEvent]),
    { workflowHistory: [existingEvent] },
    "美工账号",
  );

  assert.equal(result.workflowHistory?.[0]?.actorName, "美工账号");
  assert.equal(result.workflowHistory?.[1]?.actorName, "历史操作人");
});
