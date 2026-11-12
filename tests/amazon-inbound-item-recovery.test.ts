import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { digest, seal, normalizeCommand } from "../src/lib/amazon-sync/approval-policy";
import { previewInboundItemRecovery } from "../src/lib/amazon-sync/inbound-item-recovery";
import { advanceObservation, initialObservationState } from "../src/lib/amazon-sync/observation-machine";
import { parseObservationPolicy } from "../src/lib/amazon-sync/observation-policy";
test("staged inbound recovery preserves old facts and restores every original occurrence", async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64");
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
  const policy = parseObservationPolicy({ resource: "fulfillment", applicationId: "fixture", maxRequests: 100, maxRows: 100, requestsPerSecond: .1, planIds: ["00000000-0000-0000-0000-00000000000000"] }, "fulfillment");
  const source = { id: "source", revision: 1, resource: "fulfillment", domainPolicy: policy, sellerAccountId: "seller", marketplaceId: "site", authorizationId: "auth", activeRunId: null, authorization: { revision: 2, amazonSellerId: "amazon-seller" } };
  const frozen = { sourceRevision: 1, domainPolicy: policy, sellerAccountId: "seller", marketplaceId: "site", authorizationId: "auth", authorizationRevision: 2, amazonSellerId: "amazon-seller" };
  const plan = { inboundPlanId: "00000000-0000-0000-0000-00000000000000", status: "ACTIVE", createdAt: "2026-10-01T00:00:00Z", lastUpdatedAt: "2026-10-02T00:00:00Z", marketplaceIds: ["site"], shipments: [] };
  const body = { items: [{ msku: "SKU", quantity: 60 }, { msku: "SKU", quantity: 30 }] };
  let state = initialObservationState(policy);
  const archives: Array<{ page: number; bodySha256: string; requestMetadata: { operation: string }; rawCiphertext: string }> = [], facts = [];
  for (const [index, response] of [plan, body, plan].entries()) {
    const page = index + 1, rawBody = JSON.stringify(response);
    const operation = page === 2 ? "listInboundPlanItems" : "getInboundPlan";
    archives.push({ page, bodySha256: digest(rawBody), requestMetadata: { operation }, rawCiphertext: seal({ rawBody }, scope, `task:${page}`, "amazon-observation-raw.v1") });
    state.requests = page;
    const next = advanceObservation(policy, state, response, { rawBody, marketplaceId: "site", sellerId: "amazon-seller" });
    facts.push(...next.rows); state = next.state;
  }
  const old = structuredClone(facts[1]);
  const oldFields = old.facts as Record<string, unknown>;
  delete oldFields.sourceRawPage; delete oldFields.sourceRowNumber;
  old.businessKey = "legacy-item-key";
  const stored = [{ id: "plan-row", ...facts[0] }, { id: "old-row", ...old }];
  const run = { id: "task", status: "PAUSED", leaseOwner: null, leaseExpiresAt: null, pagesCompleted: 3, frozenScope: frozen, checkpointCiphertext: "retained", processedCount: 2, insertedCount: 2, skippedCount: 0 };
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => source }, amazonSyncRun: { findFirstOrThrow: async () => run }, amazonSyncRawPage: { findMany: async () => archives }, amazonDomainObservation: { findMany: async () => stored } } as unknown as Prisma.TransactionClient;
  const preview = await previewInboundItemRecovery(tx, scope, "source", "task");
  assert.equal(preview.manifest.rowsAddingProvenance, 1);
  assert.equal(preview.manifest.rowsToInsert, 1);
  assert.equal(preview.manifest.received, 3);
  assert.equal(preview.updates[0].id, "old-row");
  assert.equal((preview.updates[0].fact.facts as Record<string, unknown>).declaredQuantity, 60);
  assert.equal((preview.additions[0].facts as Record<string, unknown>).declaredQuantity, 30);
  (stored[1].facts as Record<string, unknown>).declaredQuantity = 59;
  await assert.rejects(() => previewInboundItemRecovery(tx, scope, "source", "task"), /完全相符/);
  run.status = "RUNNING";
  await assert.rejects(() => previewInboundItemRecovery(tx, scope, "source", "task"), /暂停/);
});
test("inbound recovery remains a separate approved mode", () => {
  assert.equal(normalizeCommand({ action: "recover-report", inboundItemsOnly: true }).inboundItemsOnly, true);
  for (const patch of [{ inboundItemsOnly: "true" }, { currencyOnly: true }, { attributionOnly: true }, { reportWindow: {} }]) assert.throws(() => normalizeCommand({ action: "recover-report", inboundItemsOnly: true, ...patch }));
});
