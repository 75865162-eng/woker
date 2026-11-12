import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { authenticateAmazonMcp, invokeAmazonMcp as invokeUnscopedAmazonMcp, manageMcpCredential } from "@/lib/amazon-sync/mcp";
import { POST } from "@/app/api/mcp/amazon/route";

if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== "1") throw new Error("Disposable runner required");
const scope = { organizationId: randomUUID(), workspaceId: "ads-mcp" };
const actor = randomUUID(), seller = randomUUID(), otherSeller = randomUUID(), adsAuth = randomUUID();
const site = "ATVPDKIKX0DER", ca = "A2EUQ1WTGCTBG2", tool = "amazon.ads.entities.list";
const types = ["SP:campaign", "SP:ad-group", "SP:keyword", "SP:target", "SP:negative-keyword", "SP:negative-target", "SP:campaign-negative-keyword", "SP:campaign-negative-target"];
let profile = "", caProfile = "", grant = "", token = "", oldToken = "", aliasToken = "", statusToken = "", credentialId = "";
const originalFetch = globalThis.fetch;
const selectedPair = { sellerAccountId: seller, marketplaceId: site };
const invokeAmazonMcp: typeof invokeUnscopedAmazonMcp = (identity, tool, args, ...rest) =>
  invokeUnscopedAmazonMcp(identity, tool, { ...selectedPair, ...(args as Record<string, unknown>) }, ...rest);
async function invoke(args = {}, bearer = token) { return invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${bearer}`), tool, args); }
async function protocol(method: string, bearer = token, params: Record<string, unknown> = {}) {
  if (method === "tools/call") params = { ...params, arguments: { ...selectedPair, ...(params.arguments as Record<string, unknown> | undefined) } };
  return POST(new Request("http://localhost/api/mcp/amazon", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
}
before(async () => {
  globalThis.fetch = async () => { throw new Error("No external HTTP permitted"); };
  await prisma.organization.create({ data: { id: scope.organizationId, name: "fixture", slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: "fixture" } });
  await prisma.user.create({ data: { id: actor, email: `${actor}@fixture.invalid`, name: "fixture", passwordHash: "unused", memberships: { create: { organizationId: scope.organizationId, role: "owner" } } } });
  for (const id of [seller, otherSeller]) await prisma.sellerAccount.create({ data: { ...scope, id, accountKey: id, displayName: "fixture", marketplaceCode: "US" } });
  // Existing verified SP source remains an additional narrowing precondition, not Ads authorization.
  const spAuth = randomUUID();
  await prisma.amazonSpApiAuthorization.create({ data: { ...scope, id: spAuth, name: "fixture", amazonSellerId: "FIXTURESELLER", awsRegion: "us-east-1", endpoint: "https://fixture.invalid", credentialsCiphertext: "SECRET_SP", status: "CONFIGURED", identityVerifiedAt: new Date(), updatedByUserId: actor } });
  await prisma.amazonSellerIdentity.create({ data: { ...scope, id: randomUUID(), sellerAccountId: seller, marketplaceId: site, authorizationId: spAuth, amazonSellerId: "FIXTURESELLER", region: "us-east-1", verifiedAt: new Date() } });
  await prisma.amazonSyncDataSource.create({ data: { ...scope, id: randomUUID(), sellerAccountId: seller, marketplaceId: site, authorizationId: spAuth, resource: "catalog", freshnessMinutes: 360 } });
  grant = (await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId: seller, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } })).id;
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: adsAuth, name: "fixture", consentRegion: "NA", status: "CONNECTED", credentialsCiphertext: "SECRET_ADS", authorizedByUserId: actor } });
  for (const [external, sellerId, marketplaceId] of [["123", seller, site], ["456", seller, ca], ["789", otherSeller, site]]) {
    const p = await prisma.amazonAdsProfile.create({ data: { ...scope, id: randomUUID(), authorizationId: adsAuth, region: "NA", profileId: external, countryCode: "US", marketplaceId, sellerAccountId: sellerId, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: { private: "SECRET_ACCOUNT" } } });
    if (external === "123") profile = p.id;
    if (external === "456") caProfile = p.id;
    const plan = await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: randomUUID(), profileId: p.id, sellerAccountId: sellerId, actorUserId: actor, authorizationRevision: 1 } });
    const task = await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: randomUUID(), planId: plan.id, profileId: p.id, requestedByUserId: actor, planRevision: 1, idempotencyKey: randomUUID(), status: "SUCCEEDED", stage: "COMPLETED_SP_STRUCTURE", checkpointCiphertext: "SECRET_CHECKPOINT" } });
    for (const [index, entityType] of types.entries()) await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: randomUUID(), profileId: p.id, sourceTaskId: task.id, externalId: String(index + 100), entityType, parentExternalId: entityType.includes("campaign-negative") ? "100" : "101", state: "ENABLED", payload: { name: "fixture entity", campaignId: "100", ...(entityType.includes("campaign-negative") ? {} : { adGroupId: "101" }), keywordText: "fixture", access_token: "SECRET_RAW", budget: { budget: 10, budgetType: "DAILY", private: "SECRET_BUDGET" }, expression: [{ type: "ASIN_SAME_AS", value: "B000FIXTURE", private: "SECRET_EXPRESSION" }] } } });
  }
  const command = { action: "create", name: "fixture", scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 86400000).toISOString() };
  oldToken = (await manageMcpCredential(scope, actor, { ...command, tools: ["amazon.stores.list"] })).token!;
  const created = await manageMcpCredential(scope, actor, { ...command, tools: [tool] });
  token = created.token!; credentialId = created.credential.id;
  aliasToken = (await manageMcpCredential(scope, actor, { ...command, name: "entity alias", tools: ["ads_list_entities"] })).token!;
  statusToken = (await manageMcpCredential(scope, actor, { ...command, name: "health alias", tools: ["ads_get_data_health"] })).token!;
});
after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

test("Ads MCP requires an explicit tool grant and advertises a bounded read-only schema", async () => {
  await assert.rejects(() => invoke({}, oldToken), /工具不可访问/);
  const old = await (await protocol("tools/list", oldToken)).json();
  assert.ok(!old.result.tools.some((entry: { name: string }) => entry.name === tool));
  const current = await (await protocol("tools/list")).json();
  const entry = current.result.tools.find((entry: { name: string }) => entry.name === tool);
  assert.equal(entry.annotations.readOnlyHint, true); assert.equal(entry.inputSchema.properties.pageSize.maximum, 100);
  assert.equal(entry.inputSchema.properties.from, undefined); assert.equal(entry.inputSchema.properties.entityType.enum.length, 9);
});
test("Ads settings stay within the personal credential even when ERP grants include another seller", async () => {
  const extra = await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId: actor, sellerAccountId: otherSeller, marketplaceIds: [site], actions: ["view"], mcpEnabled: true } });
  try {
    const created = await manageMcpCredential(scope, actor, { action: "create", name: "settings scope", scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], tools: ["ads_get_settings"], expiresAt: new Date(Date.now() + 60000).toISOString() });
    await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.mcp.tool.succeeded", entityType: "AmazonMcpCredential", metadata: { workspaceId: scope.workspaceId, tool: "amazon.inventory.list", scopes: [{ sellerAccountId: otherSeller, marketplaceIds: [site] }] } } });
    const result = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${created.token}`), "ads_get_settings", {}) as { data: { ads: { profileCount: number }; callLogs: unknown[] } };
    assert.equal(result.data.ads.profileCount, 1);
    assert.deepEqual(result.data.callLogs, []);
    assert.ok(!JSON.stringify(result).includes(otherSeller));
    assert.ok(!JSON.stringify(result).includes(caProfile));
  } finally { await prisma.amazonDataAccessGrant.delete({ where: { id: extra.id } }); }
});
test("Ads MCP uses true totals, paging, entity filters and safe fields from stored rows", async () => {
  const response = await protocol("tools/call", token, { name: tool, arguments: { pageSize: 3, page: 2, sort: "externalId", direction: "asc" } });
  assert.equal(response.status, 200);
  const body = await response.json(), data = JSON.parse(body.result.content[0].text);
  assert.equal(data.data.total, 8); assert.equal(data.data.items.length, 3); assert.equal(data.data.items[0].externalId, "103"); assert.equal(data.meta.page.hasNext, true);
  assert.equal(data.meta.source, "AmazonAdsEntityRecord"); assert.equal(data.meta.isDemo, false); assert.ok(data.meta.fieldDefinitions.internalProfileId);
  assert.ok(data.data.items.every((row: { internalProfileId: string; amazonProfileId: string }) => row.internalProfileId === profile && row.amazonProfileId === "123"));
  assert.ok(!JSON.stringify(data).includes("SECRET_")); assert.ok(!JSON.stringify(data).includes("access_token"));
  for (const entityType of types) {
    const data = await invoke({ entityType }) as { data: { total: number; items: Array<{ entityType: string }> } };
    assert.equal(data.data.total, 1); assert.equal(data.data.items[0].entityType, entityType);
  }
  const filtered = await invoke({ internalProfileId: profile, campaignId: "100", state: "ENABLED", search: "fixture" }) as { data: { total: number } };
  assert.equal(filtered.data.total, 8);
  for (const args of [{ pageSize: 101 }, { sort: "payload" }, { from: "2026-01-01" }, { entityType: "unknown" }, { page: 0 }]) await assert.rejects(() => invoke(args));
});
test("generic structure datasets require their own explicit canonical grant and share the dedicated presenter", async () => {
  const command = { action: "create", name: "dataset fixture", scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() };
  const denied = await manageMcpCredential(scope, actor, { ...command, tools: ["data_query", "ads_list_entities"] });
  const deniedIdentity = await authenticateAmazonMcp(`Bearer ${denied.token}`);
  await assert.rejects(() => invokeAmazonMcp(deniedIdentity, "data_query", { module: "amazon_ads", dataType: "entities" }), /结构工具未授权/);
  const created = await manageMcpCredential(scope, actor, { ...command, tools: ["data_query", "data_describe_table", "data_list_tables", tool] });
  const identity = await authenticateAmazonMcp(`Bearer ${created.token}`);
  const generic = await invokeAmazonMcp(identity, "data_query", { module: "amazon_ads", dataType: "entities", pageSize: 2, filters: { sortBy: "externalId", sortDirection: "desc", state: "ENABLED" } }) as { data: unknown; meta: { scope: { pairs: unknown[] }; dataset: { id: string } } };
  const dedicated = await invokeAmazonMcp(identity, tool, { pageSize: 2, sort: "externalId", direction: "desc", state: "ENABLED" }) as typeof generic;
  assert.deepEqual(generic.data, dedicated.data);
  assert.equal(generic.meta.dataset.id, "ads_entities");
  assert.deepEqual(generic.meta.scope.pairs, [{ sellerAccountId: seller, marketplaceId: site }]);
  assert.ok(!JSON.stringify(generic).includes("SECRET_"));
  const described = await invokeAmazonMcp(identity, "data_describe_table", { module: "amazon_ads", dataType: "entities" }) as { data: { table: { maxPageSize: number; dateSemantics: string } } };
  assert.equal(described.data.table.maxPageSize, 100); assert.equal(described.data.table.dateSemantics, "not_applicable");
  await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { module: "amazon_ads", dataType: "entities", filters: { from: "2026-11-01" } }), /FIELD_NOT_MAPPED/);
  await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { module: "amazon_ads", dataType: "entities", keyword: "fixture" }), /FIELD_NOT_MAPPED/);
  await prisma.amazonMcpCredential.update({ where: { id: created.credential.id }, data: { tools: ["data_query"] } });
  await assert.rejects(() => invokeAmazonMcp(identity, "data_query", { module: "amazon_ads", dataType: "entities" }), /结构工具未授权/);
});
test("revoking the additional structure grant during generic SQL withholds the result", async () => {
  const made = await manageMcpCredential(scope, actor, { action: "create", name: "dataset revoke", scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], tools: ["data_query", tool], expiresAt: new Date(Date.now() + 60000).toISOString() });
  const identity = await authenticateAmazonMcp(`Bearer ${made.token}`);
  let release = () => {}, acquired = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const lock = prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "AmazonAdsEntityRecord" IN ACCESS EXCLUSIVE MODE');
    acquired(); await gate;
  }, { timeout: 10000 });
  await ready;
  const pending = invokeAmazonMcp(identity, "data_query", { module: "amazon_ads", dataType: "entities" }).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonAdsEntityRecord%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "the generic dataset must reach the held SQL lock");
    await prisma.amazonMcpCredential.update({ where: { id: made.credential.id }, data: { tools: ["data_query"] } });
  } finally { release(); await lock; }
  const result = await pending;
  assert.equal(result.value, null); assert.ok(result.error);
});
test("Skill compatibility aliases use the same scoped ERP read boundary", async () => {
  const entity = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${aliasToken}`), "ads_list_entities", { pageSize: 1 }) as { data: { total: number; items: Array<{ fields: { name?: string } }> }; meta: { source: string } };
  assert.equal(entity.data.total, 8); assert.equal(entity.data.items[0].fields.name, "fixture entity"); assert.equal(entity.meta.source, "AmazonAdsEntityRecord");
  const health = await invokeAmazonMcp(await authenticateAmazonMcp(`Bearer ${statusToken}`), "ads_get_data_health", {}) as { data: { health: { schemaStatus: string; dataIntegrity: string } } };
  assert.equal(health.data.health.schemaStatus, "application_schema_confirmed_source_sample_pending"); assert.equal(health.data.health.dataIntegrity, "NO_PUBLISHED_VERSION");
});
test("Ads MCP intersects seller, site, internal Profile and credential scopes", async () => {
  const forbidden = await invoke({ internalProfileId: caProfile }) as { data: { total: number }; meta: { profiles: unknown[] } };
  assert.equal(forbidden.data.total, 0); assert.equal(forbidden.meta.profiles.length, 0);
  assert.equal((await invoke({ internalProfileId: "123" }) as { data: { total: number } }).data.total, 0);
  await assert.rejects(() => invoke({ sellerAccountId: otherSeller }), /数据范围不可访问/);
  await assert.rejects(() => invoke({ marketplaceId: ca }), /数据范围不可访问/);
  assert.ok(!JSON.stringify(await invoke()).includes(caProfile));
});
test("Ads MCP blocks disconnected authorization and unbound Profiles", async () => {
  await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "DISCONNECTED" } });
  assert.equal((await invoke() as { data: { total: number } }).data.total, 0);
  await prisma.amazonAdsAuthorization.update({ where: { id: adsAuth }, data: { status: "CONNECTED" } });
  await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: null } });
  assert.equal((await invoke() as { data: { total: number } }).data.total, 0);
  await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: seller } });
});
test("Ads MCP withholds results if an Ads binding changes during the real SQL read", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  let release = () => {}, ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { ready = resolve; });
  const lock = prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "AmazonAdsEntityRecord" IN ACCESS EXCLUSIVE MODE');
    ready(); await gate;
  }, { timeout: 10000 });
  await acquired;
  const pending = invokeAmazonMcp(identity, tool, {}).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonAdsEntityRecord%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, "the Ads entity read must reach the disposable table lock");
    await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: null } });
  } finally { release(); await lock; }
  const result = await pending;
  assert.ok(result.error); assert.equal(result.value, null);
  await prisma.amazonAdsProfile.update({ where: { id: profile }, data: { sellerAccountId: seller } });
});
test("Ads MCP reads normalized fields, filters hierarchy consistently and redacts nested expressions", async () => {
  const row = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile, entityType: "SP:keyword" } });
  try {
    await prisma.amazonAdsEntityRecord.update({ where: { id: row.id }, data: {
      name: "Normalized keyword", keywordText: "Canonical search", campaignId: "normalized-campaign", adGroupId: "normalized-group", bid: "0", matchType: "EXACT", budgetAmount: "24.5", budgetType: "DAILY",
      targetingExpression: [{ type: "ASIN_SAME_AS", value: "B0NORMALIZED", private: "SECRET_NORMALIZED" }],
    } });
    const result = await invoke({ entityType: "SP:keyword", campaignId: "normalized-campaign", adGroupId: "normalized-group", search: "canonical" }) as { data: { total: number; items: Array<{ fields: Record<string, unknown> }> } };
    assert.equal(result.data.total, 1);
    const fields = result.data.items[0].fields;
    assert.equal(fields.name, "Normalized keyword"); assert.equal(fields.keywordText, "Canonical search"); assert.equal(fields.bid, "0");
    assert.equal(fields.campaignId, "normalized-campaign"); assert.equal(fields.adGroupId, "normalized-group");
    assert.deepEqual(fields.budget, { budget: "24.5", budgetType: "DAILY" });
    assert.deepEqual(fields.expression, [{ type: "ASIN_SAME_AS", value: "B0NORMALIZED" }]);
    assert.ok(!JSON.stringify(result).includes("SECRET_"));
    for (const filter of [{ campaignId: "100" }, { adGroupId: "101" }, { search: "fixture" }]) {
      assert.equal((await invoke({ entityType: "SP:keyword", ...filter }) as { data: { total: number } }).data.total, 0, "stale payload must not override normalized fields");
    }
    await prisma.amazonAdsEntityRecord.update({ where: { id: row.id }, data: { payload: {} } });
    assert.equal((await invoke({ campaignId: "normalized-campaign", adGroupId: "normalized-group" }) as { data: { total: number } }).data.total, 1);
  } finally {
    await prisma.amazonAdsEntityRecord.update({ where: { id: row.id }, data: { name: row.name, keywordText: row.keywordText, campaignId: row.campaignId, adGroupId: row.adGroupId, bid: row.bid, matchType: row.matchType, budgetAmount: row.budgetAmount, budgetType: row.budgetType, targetingExpression: row.targetingExpression ?? Prisma.DbNull, payload: row.payload ?? Prisma.JsonNull } });
  }
});

test("Ads MCP uses structure domain state instead of plan success to describe freshness", async () => {
  const key = { ...scope, profileId: profile, dataDomain: "entities", reportType: "" };
  const id = randomUUID();
  await prisma.amazonAdsSyncDomainState.create({ data: { ...key, id, status: "SYNCING" } });
  try {
    for (const status of ["SYNCING", "FAILED", "UNKNOWN"]) {
      await prisma.amazonAdsSyncDomainState.update({ where: { id }, data: { status } });
      const result = await invoke() as { meta: { coverage: string; profiles: Array<{ freshness: string }> } };
      assert.equal(result.meta.coverage, status); assert.equal(result.meta.profiles[0].freshness, status);
    }
  } finally { await prisma.amazonAdsSyncDomainState.delete({ where: { id } }); }
});

test("Ads MCP refuses incomplete Profile metadata above the cap and supports narrowing", async () => {
  const profiles = Array.from({ length: 500 }, (_, index) => ({ ...scope, id: randomUUID(), authorizationId: adsAuth, region: "NA", profileId: `fixture-cap-${index}`, countryCode: "US", sellerAccountId: seller, marketplaceId: site, currencyCode: "USD", timezone: "America/Los_Angeles", accountInfo: {} }));
  try {
    await prisma.amazonAdsProfile.createMany({ data: profiles });
    await assert.rejects(() => invoke(), /500/);
    const narrowed = await invoke({ internalProfileId: profile }) as { data: { total: number }; meta: { profilesTruncated: boolean; profiles: unknown[] } };
    assert.equal(narrowed.data.total, 8); assert.equal(narrowed.meta.profilesTruncated, false); assert.equal(narrowed.meta.profiles.length, 1);
  } finally { await prisma.amazonAdsProfile.deleteMany({ where: { ...scope, id: { in: profiles.map(p => p.id) } } }); }
});

test("Ads MCP rechecks grant and credential revocation even for an authenticated identity", async () => {
  const identity = await authenticateAmazonMcp(`Bearer ${token}`);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: false } });
  await assert.rejects(() => invokeAmazonMcp(identity, tool, {}), /授权|不可访问/);
  await prisma.amazonDataAccessGrant.update({ where: { id: grant }, data: { enabled: true } });
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { tools: [] } });
  await assert.rejects(() => invokeAmazonMcp(identity, tool, {}), /不可访问/);
  await prisma.amazonMcpCredential.update({ where: { id: credentialId }, data: { tools: [tool], status: "REVOKED" } });
  await assert.rejects(() => invokeAmazonMcp(identity, tool, {}), /不可访问/);
  const logs = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId } });
  assert.ok(logs.some(log => log.action === "amazon.mcp.tool.succeeded"));
  assert.ok(logs.some(log => log.action === "amazon.mcp.tool.denied"));
  assert.ok(!JSON.stringify(logs).includes("SECRET_")); assert.ok(!JSON.stringify(logs).includes(token));
});

test("Product Ad MCP query exposes only stored advertising identifiers and keeps account isolation", async () => {
  const productToken = (await manageMcpCredential(scope, actor, { action: "create", name: "product ad fixture", tools: [tool], scopes: [{ sellerAccountId: seller, marketplaceIds: [site] }], expiresAt: new Date(Date.now() + 60000).toISOString() })).token!;
  const source = await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile } });
  const id = randomUUID();
  try {
    await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id, profileId: profile, sourceTaskId: source.sourceTaskId,
      entityType: "SP:product-ad", externalId: "777", campaignId: "100", adGroupId: "101", parentExternalId: "101", state: "PAUSED",
      payload: { adId: "777", sku: "fixture-sku", asin: "B000FIXTURE", globalAdId: "global-fixture", access_token: "SECRET_PRODUCT_AD" } } });
    const result = await invoke({ entityType: "SP:product-ad", internalProfileId: profile, campaignId: "100", adGroupId: "101" }, productToken) as { data: { total: number; items: Array<{ fields: Record<string, unknown> }> } };
    assert.equal(result.data.total, 1);
    assert.equal(result.data.items[0].fields.sku, "fixture-sku");
    assert.equal(result.data.items[0].fields.asin, "B000FIXTURE");
    assert.equal(result.data.items[0].fields.adId, "777");
    assert.doesNotMatch(JSON.stringify(result), /SECRET_|access_token/);
    const denied = await invoke({ entityType: "SP:product-ad", internalProfileId: caProfile }, productToken) as { data: { total: number } };
    assert.equal(denied.data.total, 0);
  } finally { await prisma.amazonAdsEntityRecord.deleteMany({ where: { ...scope, id } }); }
});
