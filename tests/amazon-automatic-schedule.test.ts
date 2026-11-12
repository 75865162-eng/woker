import test from "node:test";
import assert from "node:assert/strict";
import { automaticBackfillDays, automaticBackfillStart, automaticIntervalMinutes, automaticResourceIntervalMinutes, automaticMarketplaces, automaticPlanId, automaticPlanKey, isAutomaticResource, nextSalesTrafficRange, nextAutomaticReimbursementWindow, shouldRetrySyncFailure, automaticSnapshotSlot } from "@/lib/amazon-sync/automatic-schedule";
import { automaticAdapter, automaticAdapterFreshnessMinutes, automaticAdapterHasRequiredPolicy, automaticAdapterHasRequiredRoles, automaticAdapters, automaticAdapterResources, automaticSourcePolicyFields, marketplaceAutomaticAdapters, assertAutomaticAdapterPolicy } from "@/lib/amazon-sync/automatic-adapters";
import { syncDomains, isIncrementalResource } from "@/lib/amazon-sync/policy";
import { planAutomaticTask } from "@/lib/amazon-sync/automatic-planner";

const now = new Date("2026-11-05T12:00:00.000Z");

test("reimbursement history advances in 30 closed days and never overwrites a pending window", () => {
  const first = nextAutomaticReimbursementWindow(now);
  assert.equal(first.from, "2024-11-05");
  assert.equal(first.to, "2024-12-04");
  const cursor = { watermarkFrom: new Date(first.dataStartTime), watermarkTo: new Date(first.dataEndTime), status: "FAILED" };
  assert.deepEqual(nextAutomaticReimbursementWindow(now, cursor), first);
  assert.equal(nextAutomaticReimbursementWindow(now, { ...cursor, status: "SUCCEEDED" }).from, "2024-12-05");
  assert.throws(() => nextAutomaticReimbursementWindow(now, { ...cursor, watermarkTo: cursor.watermarkFrom }));
});

test("automatic plan scope includes verified reporting marketplaces and executable source policies", () => {
  for (const site of ["A1AM78C64UM0Y8", "A2EUQ1WTGCTBG2", "A2Q3Y263D00KWC", "ATVPDKIKX0DER", "A1PA6795UKMFR9", "A1VC38T7YXB528"]) assert.equal(automaticMarketplaces.has(site), true);
  assert.equal(automaticMarketplaces.has("AHRY1CZE9ZY4H"), false);
  assert.deepEqual(["catalog", "inventory", "orders", "sales_traffic", "finance", "returns", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics"].filter(isAutomaticResource), ["catalog", "inventory", "orders", "sales_traffic", "finance", "returns", "inventory_events", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics"]);
  assert.equal(automaticIntervalMinutes, 1440);
  assert.equal(automaticBackfillDays, 730);
  assert.equal(automaticBackfillStart(now), "2024-11-05T12:00:00.000Z");
  assert.equal(automaticPlanId("source-a"), automaticPlanId("source-a"));
  assert.notEqual(automaticPlanKey("source-a"), automaticPlanKey("source-b"));
});

test("one adapter registration feeds automatic discovery and scheduling consistently", () => {
  assert.deepEqual(automaticAdapterResources, automaticAdapters.map(adapter => adapter.resource));
  assert.equal(new Set(automaticAdapterResources).size, automaticAdapterResources.length);
  assert.deepEqual(marketplaceAutomaticAdapters.map(adapter => adapter.resource), automaticAdapters.filter(adapter => adapter.discoveryScope === "marketplace").map(adapter => adapter.resource));
  assert.equal(automaticAdapters.find(adapter => adapter.resource === "notifications")?.discoveryScope, "seller");
  assert.equal(automaticAdapters.find(adapter => adapter.resource === "finance")?.discoveryScope, "seller");
  assert.equal(automaticAdapters.every(adapter => ["catalog", "inventory", "orders", "finance", "returns", "domain_report", "report", "observation"].includes(adapter.executionKind)), true);
  assert.equal(automaticAdapters.every(adapter => typeof adapter.planTask === "function"), true);
  assert.deepEqual([...automaticAdapterResources].sort(), syncDomains.filter(domain => domain.implemented).map(domain => domain.id).sort());
  for (const adapter of automaticAdapters) assert.equal(adapter.scheduleMode === "incremental", isIncrementalResource(adapter.resource));
  for (const adapter of automaticAdapters) assert.equal(isAutomaticResource(adapter.resource), true);
  for (const adapter of automaticAdapters) assert.equal(automaticResourceIntervalMinutes(adapter.resource), adapter.intervalMinutes);
  for (const adapter of automaticAdapters) {
    const expectedFreshness = adapter.resource === "inventory" ? 360 : adapter.resource === "fee_preview" ? 4320 : ["fba_fulfilled_inventory", "fba_inventory_report", "fba_inventory_by_country", "reserved_inventory", "stranded_inventory"].includes(adapter.resource) ? 180 : 2880;
    assert.equal(automaticAdapterFreshnessMinutes(adapter), expectedFreshness);
  }
  assert.equal(automaticResourceIntervalMinutes("future-unregistered-resource"), automaticIntervalMinutes);
});

test("a registered planner callback can introduce window semantics without a coordinator branch", async () => {
  const base = automaticAdapter("inventory")!;
  const scope = { organizationId: "fixture-org", workspaceId: "default" };
  const source = { id: "fixture-source", resource: base.resource } as Parameters<typeof planAutomaticTask>[2];
  const plan = { id: "fixture-plan", revision: 1, intervalMinutes: 60, maxAttempts: 3, priority: 1 };
  const expected = { keyFrom: "adapter-owned-window", payload: {}, backfill: true };
  let calls = 0;
  const adapter: typeof base = { ...base, plannerKind: "fixture-new-planning-semantics", planTask: (registered, receivedScope, receivedSource, receivedPlan, receivedNow) => {
    calls++;
    assert.equal(registered, adapter);
    assert.equal(receivedScope, scope);
    assert.equal(receivedSource, source);
    assert.equal(receivedPlan, plan);
    assert.equal(receivedNow, now);
    return expected;
  } };
  assert.equal(await planAutomaticTask(adapter, scope, source, plan, now), expected);
  assert.equal(calls, 1);
  assert.equal(await planAutomaticTask({ ...adapter, planTask: () => null }, scope, source, plan, now), null);
  await assert.rejects(() => planAutomaticTask({ ...adapter, planTask: () => { throw new Error("fixture-planner-blocked"); } }, scope, source, plan, now), /fixture-planner-blocked/);
});

test("adapter role eligibility is declared and evaluated generically", () => {
  for (const definition of automaticAdapters) {
    const adapter = automaticAdapter(definition.resource)!;
    if (!adapter.requiredAnyRoles?.length) continue;
    assert.equal(automaticAdapterHasRequiredRoles(adapter, false, adapter.requiredAnyRoles), false, `${adapter.resource} requires role attestation`);
    assert.equal(automaticAdapterHasRequiredRoles(adapter, true, []), false);
    assert.equal(automaticAdapterHasRequiredRoles(adapter, true, [adapter.requiredAnyRoles[0]]), true);
  }
  assert.equal(automaticAdapterHasRequiredRoles(automaticAdapter("catalog")!, false, []), true);
});

test("registered planners freeze resource-specific automatic windows and snapshot slots", async () => {
  const scope = { organizationId: "fixture-org", workspaceId: "default" };
  const plan = { id: "plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 };
  const marketplaceId = "ATVPDKIKX0DER", marketplaceTimeZone = "America/Los_Angeles";
  const sourceBase = { id: "source", revision: 1, authorizationId: "auth", marketplaceId, authorization: { id: "auth", revision: 2, status: "CONFIGURED" }, resourceCursor: null };
  const source = (resource: string, fields: Record<string, unknown> = {}) => ({ ...sourceBase, resource, ...fields }) as unknown as Parameters<typeof planAutomaticTask>[2];
  const context = { now, initialFrom: automaticBackfillStart(now), applicationId: "fixture-app", marketplaceId, marketplaceTimeZone };
  const ordersPolicy = automaticAdapter("orders")!.createMarketplacePolicy!(context).orderPolicy;
  const financePolicy = automaticAdapter("finance")!.createSellerPolicy!({ ...context, marketplaces: [{ marketplaceId, marketplaceTimeZone }] }).financePolicy;
  const returnsPolicy = automaticAdapter("returns")!.createMarketplacePolicy!(context).returnsPolicy;
  const pricingPolicy = automaticAdapter("pricing")!.createMarketplacePolicy!({ ...context, catalogSourceId: "catalog-source" }).domainPolicy;
  const orders = await planAutomaticTask(automaticAdapter("orders")!, scope, source("orders", { orderPolicy: ordersPolicy }), plan, now);
  const finance = await planAutomaticTask(automaticAdapter("finance")!, scope, source("finance", { financePolicy }), plan, now);
  const returns = await planAutomaticTask(automaticAdapter("returns")!, scope, source("returns", { returnsPolicy }), plan, now);
  const events = await planAutomaticTask(automaticAdapter("inventory_events")!, scope, source("inventory_events"), plan, now, { readDayHistory: async () => [], readFinanceHistory: async () => [] });
  const reimbursements = await planAutomaticTask(automaticAdapter("reimbursements")!, scope, source("reimbursements"), plan, now, { readDayHistory: async () => [], readFinanceHistory: async () => [] });
  const mfnReturns = await planAutomaticTask(automaticAdapter("mfn_returns")!, scope, source("mfn_returns"), plan, now);
  const removalCursor = { watermarkFrom: new Date("2026-11-01T00:00:00Z"), watermarkTo: new Date("2026-11-01T23:59:59Z"), status: "SUCCEEDED" };
  const removals = await planAutomaticTask(automaticAdapter("removal_order_report")!, scope, source("removal_order_report", { resourceCursor: removalCursor }), plan, now);
  assert.equal(removals?.keyFrom, "2026-11-02");
  assert.equal(removals?.backfill, true);
  const removalShipments = await planAutomaticTask(automaticAdapter("removal_shipment_report")!, scope, source("removal_shipment_report", { resourceCursor: removalCursor }), plan, now);
  assert.deepEqual(removalShipments?.payload.reportWindow, removals?.payload.reportWindow);
  assert.equal(removalShipments?.backfill, true);
  const pricing = await planAutomaticTask(automaticAdapter("pricing")!, scope, source("pricing", { domainPolicy: pricingPolicy }), plan, now);
  assert.equal(orders?.payload.orderWindow?.from, automaticBackfillStart(now));
  assert.ok(finance?.payload.financeWindow?.from);
  assert.ok(returns?.payload.returnWindow?.from);
  assert.equal(events?.payload.reportWindow && "eventType" in events.payload.reportWindow ? events.payload.reportWindow.eventType : null, "");
  assert.ok(reimbursements?.payload.reportWindow && "dataStartTime" in reimbursements.payload.reportWindow && reimbursements.payload.reportWindow.dataStartTime);
  assert.deepEqual(mfnReturns?.payload.reportWindow && "from" in mfnReturns.payload.reportWindow ? [mfnReturns.payload.reportWindow.from, mfnReturns.payload.reportWindow.to] : null, ["2026-09-06", "2026-11-04"]);
  assert.equal(mfnReturns?.keyTo, "2026-11-04");
  assert.equal(pricing?.keyFrom, automaticSnapshotSlot(now, plan.intervalMinutes));
});

test("automatic source factories preserve resource-specific windows and seller scope", () => {
  const context = { now, initialFrom: automaticBackfillStart(now), applicationId: "fixture-app", marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" };
  const orders = automaticAdapter("orders")?.createMarketplacePolicy?.(context).orderPolicy as { windowMinutes: number; safetyLagSeconds: number };
  const returns = automaticAdapter("returns")?.createMarketplacePolicy?.(context).returnsPolicy as { windowMinutes: number; safetyLagSeconds: number };
  const products = automaticAdapter("pricing")?.createMarketplacePolicy?.({ ...context, catalogSourceId: "catalog-source" }).domainPolicy as { resource: string; discovery: { sourceId: string; maxObjects: number } };
  const sellerContext = { now, initialFrom: automaticBackfillStart(now), applicationId: "fixture-app", marketplaces: [{ marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" }] };
  const finance = automaticAdapter("finance")?.createSellerPolicy?.(sellerContext);
  const notifications = automaticAdapter("notifications")?.createSellerPolicy?.(sellerContext);
  assert.deepEqual([orders.windowMinutes, orders.safetyLagSeconds], [1440, 180]);
  assert.deepEqual([returns.windowMinutes, returns.safetyLagSeconds], [43200, 86400]);
  assert.deepEqual([products.resource, products.discovery.sourceId, products.discovery.maxObjects], ["pricing", "catalog-source", 1000]);
  assert.equal((finance?.financePolicy as { sellerWide: boolean }).sellerWide, true);
  assert.equal(Array.isArray((notifications?.domainPolicy as { notificationTypes: string[] }).notificationTypes), true);
});

test("plan-time policy normalization is supplied by the adapter registry", () => {
  const initialFrom = automaticBackfillStart(now);
  const orderPolicy = automaticAdapter("orders")!.createMarketplacePolicy!({ now, initialFrom, applicationId: "fixture", marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" });
  const financePolicy = automaticAdapter("finance")!.createSellerPolicy!({ now, initialFrom, applicationId: "fixture", marketplaces: [{ marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" }] });
  const returnPolicy = automaticAdapter("returns")!.createMarketplacePolicy!({ now, initialFrom, applicationId: "fixture", marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" });
  const orders = automaticAdapter("orders")!;
  const finance = automaticAdapter("finance")!;
  const returns = automaticAdapter("returns")!;
  const original = structuredClone({ orderPolicy, financePolicy, returnPolicy });
  const preparedOrder = orders.prepareSchedulePolicy!(orderPolicy, initialFrom).orderPolicy as { initialFrom: string; windowMinutes: number };
  const preparedFinance = finance.prepareSchedulePolicy!(financePolicy, initialFrom).financePolicy as { initialFrom: string; windowMinutes: number };
  const preparedReturns = returns.prepareSchedulePolicy!(returnPolicy, initialFrom).returnsPolicy as { initialFrom: string; windowMinutes: number };
  assert.deepEqual([preparedOrder.initialFrom, preparedOrder.windowMinutes], [initialFrom, 1440]);
  const financeInitialFrom = (financePolicy.financePolicy as { initialFrom: string }).initialFrom;
  assert.deepEqual([preparedFinance.initialFrom, preparedFinance.windowMinutes], [financeInitialFrom, 43200]);
  assert.deepEqual([preparedReturns.initialFrom, preparedReturns.windowMinutes], [initialFrom, 43200]);
  assert.equal(finance.scheduleInitialFrom!(financePolicy, "fallback"), financeInitialFrom);
  assert.equal(automaticAdapter("inventory")!.prepareSchedulePolicy, undefined);
  assert.deepEqual({ orderPolicy, financePolicy, returnPolicy }, original, "plan adoption must not mutate source evidence");
  const brand = automaticAdapter("brand_analytics")!;
  const brandPolicy = brand.createMarketplacePolicy!({ now, initialFrom, applicationId: "fixture", marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles" });
  assert.equal(brand.scheduleReady!(brandPolicy), true);
  assert.throws(() => brand.scheduleReady!({ domainPolicy: { ...brandPolicy.domainPolicy as Record<string, unknown>, automaticDiscovery: false } }));
});

test("automatic connection persists every policy produced by registered adapters", () => {
  const policies = { orderPolicy: { windowMinutes: 1440 }, financePolicy: { sellerWide: true }, returnsPolicy: { windowMinutes: 43200 }, domainPolicy: { resource: "notifications" }, coverage: { historicalComplete: false } };
  assert.deepEqual(automaticSourcePolicyFields(policies), policies);
  assert.deepEqual(automaticSourcePolicyFields({ orderPolicy: policies.orderPolicy }), { orderPolicy: policies.orderPolicy });
});

test("automatic schedule readiness follows each adapter's required policy declaration", () => {
  for (const resource of ["orders", "finance", "returns", "fulfillment", "listing_details", "catalog_items", "pricing", "brand_analytics", "buy_box_history", "notifications", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory"]) {
    const adapter = automaticAdapter(resource)!;
    if (adapter.requiredPolicy) {
      assert.equal(automaticAdapterHasRequiredPolicy(adapter, {}), false, `${resource} should wait for its policy`);
      assert.equal(automaticAdapterHasRequiredPolicy(adapter, { [adapter.requiredPolicy]: {} }), true, `${resource} should schedule with its policy`);
    } else assert.equal(automaticAdapterHasRequiredPolicy(adapter, {}), true, `${resource} requires no stored policy`);
  }
  for (const resource of ["catalog", "inventory", "sales_traffic", "settlements", "reimbursements", "inventory_age", "inventory_events"]) {
    assert.equal(automaticAdapterHasRequiredPolicy(automaticAdapter(resource)!, {}), true, `${resource} has no stored source policy requirement`);
  }
});

test("every registered policy factory satisfies its declared source policy contract", () => {
  const marketplaceContext = { now, initialFrom: automaticBackfillStart(now), applicationId: "fixture-app", marketplaceId: "ATVPDKIKX0DER", marketplaceTimeZone: "America/Los_Angeles", catalogSourceId: "catalog-source" };
  const sellerContext = { now, initialFrom: automaticBackfillStart(now), applicationId: "fixture-app", marketplaces: [{ marketplaceId: marketplaceContext.marketplaceId, marketplaceTimeZone: marketplaceContext.marketplaceTimeZone }] };
  for (const resource of automaticAdapterResources) {
    const adapter = automaticAdapter(resource)!;
    if (!adapter.requiredPolicy) continue;
    const policies = adapter.discoveryScope === "seller" ? adapter.createSellerPolicy?.(sellerContext) : adapter.createMarketplacePolicy?.(marketplaceContext);
    assert.ok(policies && automaticAdapterHasRequiredPolicy(adapter, policies), `${adapter.resource} policy factory must satisfy ${adapter.requiredPolicy}`);
    assert.doesNotThrow(() => assertAutomaticAdapterPolicy(adapter, policies));
    for (const invalid of [{}, [], "fixture-invalid-policy", 42, false]) {
      assert.throws(() => assertAutomaticAdapterPolicy(adapter, { [adapter.requiredPolicy]: invalid }), `${resource} must reject malformed policy`);
    }
  }
});

test("sales traffic backfill advances in inclusive windows of at most 31 days", () => {
  const first = nextSalesTrafficRange("ATVPDKIKX0DER", now, []);
  assert.equal(first.range.from, "2024-11-05");
  assert.equal(first.range.to, "2024-12-05");
  assert.equal(first.backfill, true);

  const second = nextSalesTrafficRange("ATVPDKIKX0DER", now, [{ from: first.range.from, to: first.range.to }]);
  assert.equal(second.range.from, "2024-12-06");
  assert.equal(second.range.to, "2025-01-05");
  assert.equal(Date.parse(`${second.range.to}T00:00:00Z`) - Date.parse(`${second.range.from}T00:00:00Z`), 30 * 86_400_000);
  assert.equal(second.backfill, true);
});

test("every registered adapter explicitly declares snapshot or window publication", () => {
  for (const adapter of automaticAdapters) assert.ok(["snapshot", "window"].includes(adapter.publicationMode));
  for (const resource of ["catalog", "inventory", "inventory_age", "listing_details", "catalog_items", "pricing", "fulfillment", "notifications"]) assert.equal(automaticAdapter(resource)?.publicationMode, "snapshot");
  for (const resource of ["sales_traffic", "orders", "finance", "returns", "settlements", "reimbursements", "inventory_events", "brand_analytics", "buy_box_history"]) assert.equal(automaticAdapter(resource)?.publicationMode, "window");
});

test("sales repair stops before completed islands and selects the next uncovered interval", () => {
  const coverage = [{ from: "2024-11-05", to: "2024-12-05" }, { from: "2024-12-08", to: "2025-01-31" }];
  const gap = nextSalesTrafficRange("ATVPDKIKX0DER", now, coverage);
  assert.deepEqual([gap.range.from, gap.range.to, gap.refresh], ["2024-12-06", "2024-12-07", false]);
  const next = nextSalesTrafficRange("ATVPDKIKX0DER", now, [...coverage, { from: gap.range.from, to: gap.range.to }]);
  assert.equal(next.range.from, "2025-02-01");
});

test("completed reimbursement windows refresh by adapter cadence but unfinished windows retain identity", async () => {
  const adapter = automaticAdapter("reimbursements")!;
  const source = { id: "source", revision: 1, resource: "reimbursements", authorizationId: "auth", marketplaceId: "ATVPDKIKX0DER", orderPolicy: null, financePolicy: null, returnsPolicy: null, domainPolicy: null,
    authorization: { revision: 1, status: "CONFIGURED" }, resourceCursor: { status: "SUCCEEDED", watermarkFrom: new Date("2026-11-04T00:00:00Z"), watermarkTo: new Date("2026-11-04T23:59:59Z") } };
  const plan = { id: "plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 };
  const scope = { organizationId: "fixture", workspaceId: "fixture" };
  const historyRuntime = { readDayHistory: async () => [{ from: "2024-11-05", to: "2026-11-04" }], readFinanceHistory: async () => [] };
  const first = await planAutomaticTask(adapter, scope, source, plan, now, historyRuntime);
  const duplicate = await planAutomaticTask(adapter, scope, source, plan, now, historyRuntime);
  assert.equal(first?.keyTo, duplicate?.keyTo);
  assert.match(first!.keyTo!, /:refresh:/);
  const pending = await planAutomaticTask(adapter, scope, { ...source, resourceCursor: { ...source.resourceCursor, status: "FAILED" } }, plan, now);
  assert.equal(pending?.keyTo, "2026-11-04");
  assert.deepEqual(first?.payload, pending?.payload);
  const gap = await planAutomaticTask(adapter, scope, source, plan, now, { readDayHistory: async () => [
    { from: "2024-11-05", to: "2025-01-01" }, { from: "2025-01-10", to: "2026-11-04" },
  ], readFinanceHistory: async () => [] });
  assert.equal(gap?.payload.reimbursementHistoryReplay, true);
  assert.deepEqual([gap?.payload.reportWindow && "from" in gap.payload.reportWindow ? gap.payload.reportWindow.from : null, gap?.payload.reportWindow && "to" in gap.payload.reportWindow ? gap.payload.reportWindow.to : null], ["2025-01-02", "2025-01-09"]);
});

test("inventory event internal gaps are planned as history replay windows", async () => {
  const adapter = automaticAdapter("inventory_events")!;
  const cursor = { status: "SUCCEEDED", watermarkFrom: new Date("2026-11-01T00:00:00Z"), watermarkTo: new Date("2026-11-04T23:59:59Z") };
  const source = { id: "source", revision: 1, resource: "inventory_events", authorizationId: "auth", marketplaceId: "ATVPDKIKX0DER", orderPolicy: null, financePolicy: null, returnsPolicy: null, domainPolicy: null,
    authorization: { revision: 1, status: "CONFIGURED" }, resourceCursor: cursor };
  const plan = { id: "plan", revision: 1, maxAttempts: 3, priority: 1, intervalMinutes: 1440 };
  const scope = { organizationId: "fixture", workspaceId: "fixture" };
  const planned = await planAutomaticTask(adapter, scope, source, plan, now, { readDayHistory: async () => [
    { from: "2024-11-05", to: "2025-08-01" }, { from: "2025-08-10", to: "2026-11-04" },
  ], readFinanceHistory: async () => [] });
  assert.equal(planned?.payload.inventoryEventHistoryReplay, true);
  assert.equal(planned?.payload.reportWindow && "eventType" in planned.payload.reportWindow ? planned.payload.reportWindow.eventType : null, "");
  assert.deepEqual(planned?.payload.reportWindow && "from" in planned.payload.reportWindow ? [planned.payload.reportWindow.from, planned.payload.reportWindow.to] : null, ["2025-08-02", "2025-08-09"]);
});

test("sales traffic daily schedule rechecks seven closed days after history is covered", () => {
  const covered = nextSalesTrafficRange("A2EUQ1WTGCTBG2", now, [{ from: "2024-11-05", to: "2026-11-04" }]);
  assert.equal(covered.range.from, "2026-10-29");
  assert.equal(covered.range.to, "2026-11-04");
  assert.equal(covered.backfill, false);
});

test("automatic resume is immediate and task keys isolate configuration revisions", async () => {
  const { automaticTaskKey, nextPlanRunAt } = await import('@/lib/amazon-sync/automatic-schedule');
  assert.equal(nextPlanRunAt(true, true, 1440, now)?.toISOString(), now.toISOString());
  assert.equal(nextPlanRunAt(false, true, 1440, now), null);
  assert.equal(nextPlanRunAt(true, false, 60, now)?.getTime(), now.getTime()+3600000);
  const plan={id:'plan',revision:1}, source={revision:1,authorization:{revision:2}};
  const key=automaticTaskKey(plan,source,'from','to');
  assert.equal(key,automaticTaskKey(plan,source,'from','to'));
  assert.notEqual(key,automaticTaskKey({...plan,revision:2},source,'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,{...source,revision:2},'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,{...source,authorization:{revision:3}},'from','to'));
  assert.notEqual(key,automaticTaskKey(plan,source,'from','other'));
  assert.ok(key.length<=160);
});


test("completed incremental cursors survive automatic plan adoption and reimbursement starts at retention", async () => {
  const { nextOrderWindow, parseOrderSyncPolicy } = await import("@/lib/amazon-sync/orders");
  const policy = parseOrderSyncPolicy({ initialFrom: automaticBackfillStart(now), windowMinutes: 1440, overlapSeconds: 60, safetyLagSeconds: 180, marketplaceTimeZone: "America/Los_Angeles", applicationId: "fixture", requestsPerSecond: .0056, burst: 1, statusMapping: {} });
  const cursor = { watermarkFrom: new Date("2026-10-01T00:00:00Z"), watermarkTo: new Date("2026-10-02T00:00:00Z"), status: "SUCCEEDED" };
  assert.equal(nextOrderWindow(policy, cursor, now).from, "2026-10-01T23:59:00.000Z");
  assert.equal(nextAutomaticReimbursementWindow(now).from, "2024-11-05");
});

test("scheduled sync gets bounded extra retries for transient failures only", () => {
  const base = { retryable: true, code: "TRANSIENT", trigger: "schedule", maxAttempts: 3 };
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 3 }), true);
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 4, code: "THROTTLE" }), true);
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 5 }), false);
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 3, trigger: "manual" }), false);
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 3, code: "AUTH" }), false);
  assert.equal(shouldRetrySyncFailure({ ...base, attempts: 3, retryable: false }), false);
});
