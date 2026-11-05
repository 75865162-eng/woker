import assert from "node:assert/strict";
import test from "node:test";
import { AmazonSpApiClient, type AmazonRequestEvent } from "../src/lib/amazon/sp-api-client";
import { implementedDomain } from "../src/lib/amazon-sync/policy";
import { automaticResources } from "../src/lib/amazon-sync/automatic-schedule";
import {
  assertInboundPageProgress, assertInboundRoles, assertInboundTraversalComplete,
  inboundItemKey, inboundObservationTime, inboundSourceUpdatedTime, InboundValidationError,
  mergeInboundRows, parseInboundItemsPage, parseInboundPlan, parseInboundPlansPage, parseInboundShipment,
  type InboundTraversalEvidence,
} from "../src/lib/amazon-sync/inbound";

const plan = { inboundPlanId: "plan-1", name: "fixture plan", status: "ACTIVE", marketplaceIds: ["fixture-marketplace"], createdAt: "2026-10-01T12:00:00Z", lastUpdatedAt: "2026-11-01T12:00:00Z" };
const item = { msku: "fixture SKU / 中文", asin: "B000000001", fnsku: "X000000001", quantity: 20 };
const shipment = { shipmentId: "shipment-1", status: "SHIPPED", destination: { destinationType: "AMAZON_WAREHOUSE", warehouseId: "ABC1", address: { name: "private destination", phoneNumber: "private phone" } }, source: { address: { name: "private sender" } } };

test("inbound plan pages reject malformed lists and pagination without leaking values", () => {
  const result = parseInboundPlansPage({ inboundPlans: [plan], pagination: { nextToken: "opaque+/=&token" } });
  assert.equal(result.plans[0].sourceUpdatedAt, "2026-11-01T12:00:00.000Z");
  assert.equal(result.nextToken, "opaque+/=&token");
  for (const value of [{}, { inboundPlans: null }, { inboundPlans: [null] }, { inboundPlans: [plan], pagination: null }, { inboundPlans: [plan], pagination: { nextToken: 1 } }, { inboundPlans: [plan], pagination: { nextToken: "" } }, { inboundPlans: Array.from({ length: 31 }, () => plan) }]) {
    assert.throws(() => parseInboundPlansPage(value), InboundValidationError);
  }
  const secret = "private-token\nprivate-address";
  assert.throws(() => parseInboundPlansPage({ inboundPlans: [{ ...plan, inboundPlanId: secret }] }), error => error instanceof InboundValidationError && !error.message.includes(secret));
});

test("inbound timestamps preserve source time and reject invalid calendar or offset dates", () => {
  assert.equal(inboundObservationTime("2026-11-01T08:00:00+08:00"), "2026-11-01T00:00:00.000Z");
  assert.equal(inboundSourceUpdatedTime(undefined), null);
  for (const value of ["2026-02-30T00:00:00Z", "2026-11-01", "2026-11-01T24:00:00Z", "2026-11-01T00:00:00+00:99", "2026-11-01T00:00:00"]) assert.throws(() => inboundObservationTime(value));
  assert.throws(() => parseInboundPlansPage({ inboundPlans: [{ ...plan, lastUpdatedAt: "2026-09-01T12:00:00Z" }] }));
});

test("plan details require matching identity and explicit shipment membership", () => {
  const detail = parseInboundPlan({ ...plan, shipments: [{ shipmentId: "shipment-1" }, { shipmentId: "shipment-2" }] }, "plan-1");
  assert.equal(detail.shipments.length, 2);
  assert.equal(detail.shipments[0].inboundPlanId, "plan-1");
  assert.throws(() => parseInboundPlan({ ...plan, shipments: [] }, "other-plan"));
  assert.equal(parseInboundPlan(plan, "plan-1").shipments.length, 0);
  assert.throws(() => parseInboundPlan({ ...plan, shipments: [{}] }, "plan-1"));
});

test("shipment facts strip address/contact/tracking data and never infer marketplace", () => {
  const result = parseInboundShipment({ ...shipment, trackingDetails: { privateTracking: "hidden" } }, { inboundPlanId: "plan-1", shipmentId: "shipment-1" });
  assert.equal(result.destinationWarehouseId, "ABC1");
  assert.equal(result.sourceStatus, "SHIPPED");
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!("marketplaceId" in result));
  assert.ok(!("trackingDetails" in result));
  assert.throws(() => parseInboundShipment({ ...shipment, inboundPlanId: "another-plan" }, { inboundPlanId: "plan-1", shipmentId: "shipment-1" }));
  assert.throws(() => parseInboundShipment(shipment, { inboundPlanId: "plan-1", shipmentId: "another-shipment" }));
});

test("new shipment status is retained without fabricating a transport event", () => {
  const result = parseInboundShipment({ ...shipment, status: "FUTURE_SOURCE_STATUS" }, { inboundPlanId: "plan-1", shipmentId: "shipment-1" });
  assert.equal(result.sourceStatus, "FUTURE_SOURCE_STATUS");
  assert.ok(!("shippedAt" in result));
  assert.ok(!("receivedAt" in result));
});

test("plan and shipment quantities have distinct semantics, never physical shipment evidence", () => {
  const planRow = parseInboundItemsPage({ items: [item] }, { inboundPlanId: "plan-1" }).items[0];
  const shipmentRow = parseInboundItemsPage({ items: [item] }, { inboundPlanId: "plan-1", shipmentId: "shipment-1" }).items[0];
  assert.equal(planRow.quantitySemantics, "PLAN_DECLARED");
  assert.equal(shipmentRow.quantitySemantics, "SHIPMENT_DECLARED");
  assert.equal(shipmentRow.declaredQuantity, 20);
  assert.equal(shipmentRow.shippedQuantity, null);
  assert.equal(shipmentRow.receivedQuantity, null);
  assert.equal(shipmentRow.inTransitQuantity, null);
  assert.notEqual(inboundItemKey(planRow), inboundItemKey(shipmentRow));
  assert.equal(shipmentRow.sellerSku, item.msku);
});

test("declared quantity respects the official 1..500000 contract", () => {
  assert.equal(parseInboundItemsPage({ items: [{ ...item, quantity: 1 }] }, { inboundPlanId: "plan-1" }).items[0].declaredQuantity, 1);
  for (const quantity of [undefined, null, "0", 0, 500001, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.throws(() => parseInboundItemsPage({ items: [{ ...item, quantity }] }, { inboundPlanId: "plan-1" }));
  }
  assert.throws(() => parseInboundItemsPage({ items: [{ ...item, msku: "A".repeat(501) }] }, { inboundPlanId: "plan-1" }));
});

test("item lot and expiration split business keys; overlaps are idempotent, conflicts fail", () => {
  const context = { inboundPlanId: "plan-1", shipmentId: "shipment-1" };
  const a = { ...item, manufacturingLotCode: "lot-a", expiration: "2027-01-01" };
  const b = { ...item, manufacturingLotCode: "lot-b", expiration: "2027-01-01" };
  const result = parseInboundItemsPage({ items: [a, a, b] }, context);
  assert.equal(result.items.length, 2);
  assert.throws(() => parseInboundItemsPage({ items: [a, { ...a, quantity: 21 }] }, context));
  assert.throws(() => parseInboundItemsPage({ items: [{ ...a, expiration: "2027-02-30" }] }, context));
  const newer = parseInboundItemsPage({ items: [{ ...a, quantity: 21 }] }, context);
  assert.throws(() => mergeInboundRows(result.items, newer.items, inboundItemKey));
  assert.throws(() => mergeInboundRows([], result.items, inboundItemKey, 1));
});

test("pagination cycles cannot turn into unbounded inbound reads", () => {
  assert.doesNotThrow(() => assertInboundPageProgress(undefined, "a", []));
  assert.doesNotThrow(() => assertInboundPageProgress("a", undefined, ["a"]));
  assert.throws(() => assertInboundPageProgress("a", "a", []));
  assert.throws(() => assertInboundPageProgress("b", "a", ["a"]));
  assert.throws(() => assertInboundPageProgress(undefined, undefined, Array.from({ length: 1001 }, () => "a")));
});

function traversal(): InboundTraversalEvidence {
  return {
    planListComplete: true, plans: parseInboundPlansPage({ inboundPlans: [plan] }).plans,
    planDetails: [parseInboundPlan({ ...plan, shipments: [{ shipmentId: "shipment-1" }] }, "plan-1")],
    completedPlanItems: ["plan-1"], shipmentDetails: [parseInboundShipment(shipment, { inboundPlanId: "plan-1", shipmentId: "shipment-1" })],
    completedShipmentItems: [{ inboundPlanId: "plan-1", shipmentId: "shipment-1" }],
  };
}
test("complete traversal means visible plans only, never marketplace/account-wide completeness", () => {
  assert.deepEqual(assertInboundTraversalComplete(traversal()), { coverage: "VISIBLE_PLANS_ONLY", marketplaceVerified: false, plans: 1, shipments: 1 });
  assert.deepEqual(assertInboundTraversalComplete({ planListComplete: true, plans: [], planDetails: [], completedPlanItems: [], shipmentDetails: [], completedShipmentItems: [] }), { coverage: "VISIBLE_PLANS_ONLY", marketplaceVerified: false, plans: 0, shipments: 0 });
});

test("missing or foreign child reads block complete traversal", () => {
  for (const patch of [
    { planListComplete: false }, { planDetails: [] }, { completedPlanItems: [] }, { shipmentDetails: [] }, { completedShipmentItems: [] },
    { completedShipmentItems: [{ inboundPlanId: "other-plan", shipmentId: "shipment-1" }] }, { completedPlanItems: ["plan-1", "plan-1"] },
  ]) assert.throws(() => assertInboundTraversalComplete({ ...traversal(), ...patch }));
  const evidence = traversal();
  evidence.planDetails[0].shipments[0].inboundPlanId = "other-plan";
  assert.throws(() => assertInboundTraversalComplete(evidence));
});

test("Marketplace participation alone cannot attest Amazon Fulfillment role", () => {
  assert.throws(() => assertInboundRoles({ approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: null }));
  assert.throws(() => assertInboundRoles({ approvedRoles: ["Inventory and Order Tracking"], rolesAttestedAt: new Date() }));
  assert.throws(() => assertInboundRoles({ approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date(NaN) }));
  assert.doesNotThrow(() => assertInboundRoles({ approvedRoles: ["Amazon Fulfillment"], rolesAttestedAt: new Date("2026-11-01T00:00:00Z") }));
});

function mockClient(respond: (url: URL, init?: RequestInit) => Response, events: AmazonRequestEvent[] = []) {
  return new AmazonSpApiClient({ lwaClientId: "fixture-client", lwaClientSecret: "fixture-secret", refreshToken: "fixture-refresh", awsAccessKeyId: "", awsSecretAccessKey: "", region: "fixture-region", endpoint: "https://spapi.fixture.invalid" }, {
    tokenEndpoint: "https://lwa.fixture.invalid/token", onResponse: event => events.push(event),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "lwa.fixture.invalid") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
      assert.equal(url.hostname, "spapi.fixture.invalid", "no external network is allowed");
      assert.equal(init?.method, "GET");
      return respond(url, init);
    },
  });
}

test("inbound client uses five scoped GET routes and labels operation-specific quota events", async () => {
  const requests: URL[] = [], events: AmazonRequestEvent[] = [];
  const client = mockClient(url => { requests.push(url); return Response.json({ fixture: true }); }, events);
  await client.listInboundPlans();
  await client.getInboundPlan({ inboundPlanId: "plan-1" });
  await client.listInboundPlanItems({ inboundPlanId: "plan-1" });
  await client.getInboundShipment({ inboundPlanId: "plan-1", shipmentId: "shipment-1" });
  await client.listInboundShipmentItems({ inboundPlanId: "plan-1", shipmentId: "shipment-1" });
  const prefix = "/inbound/fba/2024-03-20/inboundPlans";
  assert.deepEqual(requests.map(url => url.pathname), [prefix, `${prefix}/plan-1`, `${prefix}/plan-1/items`, `${prefix}/plan-1/shipments/shipment-1`, `${prefix}/plan-1/shipments/shipment-1/items`]);
  assert.deepEqual(events.map(event => event.operation), ["LWA", "listInboundPlans", "getInboundPlan", "listInboundPlanItems", "getShipment", "listShipmentItems"]);
  assert.equal(requests[0].searchParams.get("pageSize"), "10");
  assert.ok(requests.every(url => !url.searchParams.has("marketplaceIds")));
});

test("inbound continuation tokens are encoded once and invalid request IDs fail before HTTP", async () => {
  const requests: URL[] = [];
  const client = mockClient(url => { requests.push(url); return Response.json({ items: [] }); });
  const token = "opaque+/=&%2F";
  await client.listInboundPlanItems({ inboundPlanId: "plan-1", paginationToken: token });
  assert.equal(requests[0].searchParams.get("paginationToken"), token);
  for (const id of ["", "../secrets", "a?marketplace=foreign", "a/b", "x".repeat(201)]) await assert.rejects(client.getInboundPlan({ inboundPlanId: id }));
  await assert.rejects(client.listInboundPlans({ paginationToken: "" }));
  await assert.rejects(client.listInboundShipmentItems({ inboundPlanId: "plan-1", shipmentId: "shipment-1", paginationToken: "private\ntoken" }));
  assert.equal(requests.length, 1);
});

test("client retains exact raw response for encrypted archive; normalized facts exclude PII", async () => {
  const raw = JSON.stringify({ ...shipment, notes: "fixture-private-note" });
  const client = mockClient(() => new Response(raw, { headers: { "content-type": "application/json" } }));
  const result = await client.getInboundShipment({ inboundPlanId: "plan-1", shipmentId: "shipment-1" });
  assert.equal(result.rawBody, raw);
  assert.ok(!JSON.stringify(parseInboundShipment(result.body, { inboundPlanId: "plan-1", shipmentId: "shipment-1" })).includes("private"));
});

test("read-side implementation does not silently enable real tasks or automatic plans", () => {
  assert.equal(implementedDomain("fulfillment"), "fulfillment");
  assert.ok(!(automaticResources as readonly string[]).includes("fulfillment"));
});
