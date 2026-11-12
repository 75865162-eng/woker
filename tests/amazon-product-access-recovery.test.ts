import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { digest, normalizeCommand } from "../src/lib/amazon-sync/approval-policy";
import { previewProductAccessRecovery } from "../src/lib/amazon-sync/product-access-recovery";

test("catalog capability renewal binds the existing task and an already observed ASIN", async () => {
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
  const policy = { resource: "catalog_items", applicationId: "fixture", asins: ["B000000001"], maxRequests: 100, maxRows: 100, requestsPerSecond: .2 };
  const source = { id: "source", revision: 2, authorizationId: "auth", sellerAccountId: "seller", marketplaceId: "site", domainPolicy: policy, authorization: { revision: 3, status: "CONFIGURED", amazonSellerId: "amazon", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com" } };
  const frozen = { sourceRevision: 2, authorizationId: "auth", authorizationRevision: 3, sellerAccountId: "seller", marketplaceId: "site", amazonSellerId: "amazon", region: "us-east-1", endpoint: source.authorization.endpoint, domainPolicy: policy };
  const run = { id: "task", status: "BLOCKED", leaseOwner: null, leaseExpiresAt: null, frozenScope: frozen, frozenScopeDigest: digest(frozen), checkpointCiphertext: "retained", pagesCompleted: 47, insertedCount: 47 };
  const row = { id: "existing", asin: "B000000001" };
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => source }, amazonSyncRun: { findFirstOrThrow: async () => run, count: async () => 0 }, amazonDomainObservation: { findFirstOrThrow: async () => row } } as unknown as Prisma.TransactionClient;
  const p = await previewProductAccessRecovery(tx, scope, "source", "task");
  assert.equal(p.manifest.probeAsin, row.asin);
  assert.equal(p.manifest.pages, 47);
  assert.equal(p.manifest.businessScopeChanged, false);
  row.asin = "B000000002";
  await assert.rejects(() => previewProductAccessRecovery(tx, scope, "source", "task"), /清单/);
  row.asin = "B000000001"; run.status = "RUNNING";
  await assert.rejects(() => previewProductAccessRecovery(tx, scope, "source", "task"), /停止原任务/);
});

test("catalog capability renewal cannot combine with other recovery modes", () => {
  assert.equal(normalizeCommand({ action: "recover-report", productAccessOnly: true, taskId: "task" }).productAccessOnly, true);
  for (const patch of [{ productAccessOnly: "true" }, { archiveOnly: true }, { inboundItemsOnly: true }, { reportWindow: {} }]) assert.throws(() => normalizeCommand({ action: "recover-report", productAccessOnly: true, ...patch }));
});
