import test from "node:test";
import assert from "node:assert/strict";
import { parseSellerArchivePolicy, sellerArchivePolicy, assertSellerArchiveTarget } from "@/lib/amazon-sync/seller-archive-policy";
import { normalizeCommand, summary } from "@/lib/amazon-sync/approval-policy";
import { assertSkillSyncSourcePublishable } from "@/lib/amazon-sync/skill-sync-retry";
const policy = { mode: "seller-archive-only", version: 1, publication: "quarantined" };
test("seller archive policy cannot enable publication or accept unknown nested fields", () => {
  assert.deepEqual(parseSellerArchivePolicy(policy), policy);
  for (const invalid of [null, [], {}, { ...policy, publication: "published" }, { ...policy, bypass: true }, { ...policy, version: 2 }]) assert.throws(() => parseSellerArchivePolicy(invalid));
  assert.equal(sellerArchivePolicy("finance", policy), undefined);
  assert.equal(sellerArchivePolicy("inventory_events", null), undefined);
});
test("Skill collection requests cannot repeat seller-only quarantined reports", () => {
  assert.throws(() => assertSkillSyncSourcePublishable("inventory_events", policy), /不会发布站点级 Skill 数据/);
  assert.throws(() => assertSkillSyncSourcePublishable("reimbursements", policy), /避免重复采集/);
  assert.doesNotThrow(() => assertSkillSyncSourcePublishable("inventory_events", null));
  assert.doesNotThrow(() => assertSkillSyncSourcePublishable("finance", policy));
});
test("approval command and safe review preserve exact seller archive semantics", () => {
  const command = normalizeCommand({ action: "save-source", resource: "inventory_events", domainPolicy: policy });
  assert.deepEqual(command.domainPolicy, policy);
  assert.deepEqual(summary(command).domainPolicy, policy);
  assert.throws(() => normalizeCommand({ action: "save-source", resource: "settlements", domainPolicy: policy }));
});
test("archive execution rejects every foreign organization, workspace and marketplace", () => {
  assert.throws(() => assertSellerArchiveTarget({ organizationId: "fixture", workspaceId: "default" }, "ATVPDKIKX0DER"));
  assert.throws(() => assertSellerArchiveTarget({ organizationId: "amazon-live-local", workspaceId: "other" }, "ATVPDKIKX0DER"));
  assert.throws(() => assertSellerArchiveTarget({ organizationId: "amazon-live-local", workspaceId: "default" }, "A2EUQ1WTGCTBG2"));
});
