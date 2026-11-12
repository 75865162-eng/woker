import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { productAccessEvidence, assertProductAccessEvidence } from "../src/lib/amazon-sync/product-access-evidence";
import { parseObservationPolicy, assertObservationRoles } from "../src/lib/amazon-sync/observation-policy";
import { validateProductManifest, resolvedProductPolicy } from "../src/lib/amazon-sync/product-discovery";
import { safeState } from "../src/lib/amazon-sync/approval-policy";
const fields = { resource: "listing_details", sellerSkus: [], applicationId: "app", maxRequests: 500, maxRows: 1000, requestsPerSecond: .2, discovery: { mode: "catalog_snapshot", sourceId: "catalog", maxObjects: 1000, batchSize: 100 } };
test("discovery allows bounded manifests beyond static 100, rejects drift, invalid IDs and exhausted budget", () => {
  const p = parseObservationPolicy(fields); if (p.resource !== "listing_details") throw Error();
  for (const n of [0, 1, 100, 101, 224]) {
    const ids = Array.from({ length: n }, (_, i) => `sku-${String(i).padStart(4, "0")}`);
    const m = { sourceId: "catalog", sourceRevision: 1, authorizationRevision: 3, runId: "published", total: n, batchSize: 100, ids, digest: createHash("sha256").update(JSON.stringify(ids)).digest("hex") };
    assert.equal(validateProductManifest(m, p).total, n);
    assert.equal((resolvedProductPolicy(p, m) as typeof p).sellerSkus.length, n);
    for (const bad of [{ ...m, total: n + 1 }, { ...m, digest: "wrong" }, { ...m, sourceId: "foreign" }]) assert.throws(() => validateProductManifest(bad, p));
    if (n > 1) assert.throws(() => validateProductManifest(m, { ...p, maxRequests: 1 }));
  }
  assert.throws(() => parseObservationPolicy({ ...fields, sellerSkus: ["static"] }));
  assert.throws(() => parseObservationPolicy({ ...fields, requestsPerSecond: .3 }));
  assert.throws(() => parseObservationPolicy({ ...fields, discovery: undefined, sellerSkus: Array.from({ length: 101 }, (_, i) => `s${i}`) }));
});
test("HTTP evidence is revision, tenant, site and operation bound; never grants roles or survives expiry", () => {
  const prior = process.env.AMAZON_SP_API_ENCRYPTION_KEY; process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 46).toString("base64");
  try {
    const c = { organizationId: "fixture", workspaceId: "test", authorizationId: "auth", authorizationRevision: 3, marketplaceId: "site", resource: "listing_details" as const };
    const at = new Date(), token = productAccessEvidence(c, { status: 200, parsed: true, requestId: "request" }, at);
    assert.doesNotThrow(() => assertProductAccessEvidence(token, c, at));
    for (const change of [{ organizationId: "foreign" }, { workspaceId: "foreign" }, { authorizationRevision: 4 }, { marketplaceId: "foreign" }, { resource: "catalog_items" as const }]) assert.throws(() => assertProductAccessEvidence(token, { ...c, ...change }, at));
    assert.throws(() => assertProductAccessEvidence(token, c, new Date(at.getTime() + 86400000)));
    assert.throws(() => productAccessEvidence(c, { status: 403, parsed: false, requestId: "rejected" }));
    const p = parseObservationPolicy({ ...fields, accessEvidence: token });
    assert.doesNotThrow(() => assertObservationRoles(p, { approvedRoles: [], rolesAttestedAt: null }, c));
    assert.doesNotThrow(() => assertObservationRoles(p, { approvedRoles: [], rolesAttestedAt: null }));
    assert.ok(!JSON.stringify(safeState(p)).includes(token));
  } finally { if (prior === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY; else process.env.AMAZON_SP_API_ENCRYPTION_KEY = prior; }
});
