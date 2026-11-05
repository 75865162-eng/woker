/** Fulfillment Inbound 2024-03-20 read-side contract.
 * This module does not enable a source, schedule or remote mutation. Current
 * inbound visibility across other applications/history still requires real-account
 * verification. The receiver verifies returned marketplaceIds before child reads.
 */
export const inboundApiVersion = "2024-03-20";
export const inboundReadOperations = ["listInboundPlans", "getInboundPlan", "listInboundPlanItems", "getShipment", "listShipmentItems"] as const;
export type InboundReadOperation = typeof inboundReadOperations[number];

export class InboundValidationError extends Error {
  constructor() { super("FBA 在途响应、归属或完整性校验失败；未发布新观察版本。"); this.name = "InboundValidationError"; }
}
const invalid = (): never => { throw new InboundValidationError(); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();

/** No truncation, trimming or source values in errors: identifiers are facts. */
export function inboundIdentifier(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value) ? value : invalid();
}
function text(value: unknown, max = 500): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
}
function optionalText(value: unknown): string | null { return value === undefined || value === null ? null : text(value); }
export function inboundPaginationToken(value: unknown): string | undefined {
  return value === undefined ? undefined : typeof value === "string" && value.trim().length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
}
function nextToken(root: Record<string, unknown>): string | undefined {
  return root.pagination === undefined ? undefined : inboundPaginationToken(object(root.pagination).nextToken);
}
function rows(value: unknown, max = 1000): unknown[] { return Array.isArray(value) && value.length <= max ? value : invalid(); }
function quantity(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 500_000 ? value : invalid(); }
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : invalid();
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return invalid();
  date(value.slice(0, 10));
  if (+value.slice(11, 13) > 23 || +value.slice(14, 16) > 59 || +value.slice(17, 19) > 59 || /[+-]\d{2}:\d{2}$/.test(value) && (+value.slice(-5, -3) > 23 || +value.slice(-2) > 59)) return invalid();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : invalid();
}
function optionalTimestamp(value: unknown): string | null { return value === undefined || value === null ? null : timestamp(value); }

export type InboundPlanObservation = {
  inboundPlanId: string; name: string | null; sourceStatus: string;
  sourceCreatedAt: string; sourceUpdatedAt: string;
  marketplaceIds: string[];
};
export type InboundShipmentReference = { inboundPlanId: string; shipmentId: string };
export type InboundPlanDetail = InboundPlanObservation & { shipments: InboundShipmentReference[] };
export type InboundShipmentObservation = InboundShipmentReference & {
  name: string | null; shipmentConfirmationId: string | null; amazonReferenceId: string | null;
  sourceStatus: string | null; destinationType: string | null; destinationWarehouseId: string | null;
};
export type InboundItemContext = { inboundPlanId: string; shipmentId?: string };
export type InboundItemObservation = {
  inboundPlanId: string; shipmentId: string | null; sellerSku: string; asin: string | null; fnsku: string | null;
  expiration: string | null; manufacturingLotCode: string | null;
  declaredQuantity: number; quantitySemantics: "PLAN_DECLARED" | "SHIPMENT_DECLARED";
  // The API item.quantity is a declaration, never evidence of physical movement.
  shippedQuantity: null; receivedQuantity: null; inTransitQuantity: null;
};

function planObservation(value: unknown): InboundPlanObservation {
  const row = object(value);
  const sourceCreatedAt = timestamp(row.createdAt), sourceUpdatedAt = timestamp(row.lastUpdatedAt);
  if (sourceUpdatedAt < sourceCreatedAt) return invalid();
  const marketplaceIds = rows(row.marketplaceIds, 30).map(inboundIdentifier);
  if (!marketplaceIds.length || new Set(marketplaceIds).size !== marketplaceIds.length) return invalid();
  return { inboundPlanId: inboundIdentifier(row.inboundPlanId), name: optionalText(row.name), sourceStatus: text(row.status, 100), sourceCreatedAt, sourceUpdatedAt, marketplaceIds };
}

/** Identical overlap is idempotent; contradictory rows never silently win. */
export function mergeInboundRows<T>(existing: readonly T[], incoming: readonly T[], key: (row: T) => string, maxRows = 50_000): T[] {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 50_000 || existing.length > maxRows || incoming.length > maxRows) return invalid();
  const merged = new Map<string, T>();
  for (const row of [...existing, ...incoming]) {
    const id = key(row);
    if (merged.has(id) && JSON.stringify(merged.get(id)) !== JSON.stringify(row)) return invalid();
    merged.set(id, row);
    if (merged.size > maxRows) return invalid();
  }
  return [...merged.values()];
}

export function parseInboundPlansPage(value: unknown): { plans: InboundPlanObservation[]; nextToken?: string } {
  const root = object(value);
  const plans = rows(root.inboundPlans, 30).map(planObservation);
  return { plans: mergeInboundRows([], plans, row => row.inboundPlanId), nextToken: nextToken(root) };
}

export function parseInboundPlan(value: unknown, expectedPlanId: string): InboundPlanDetail {
  const root = object(value), plan = planObservation(root);
  if (plan.inboundPlanId !== inboundIdentifier(expectedPlanId)) return invalid();
  const shipments = rows(root.shipments ?? []).map(raw => {
    const row = object(raw);
    return { inboundPlanId: plan.inboundPlanId, shipmentId: inboundIdentifier(row.shipmentId) };
  });
  return { ...plan, shipments: mergeInboundRows([], shipments, inboundShipmentKey) };
}

export function parseInboundShipment(value: unknown, context: InboundShipmentReference): InboundShipmentObservation {
  const root = object(value), inboundPlanId = inboundIdentifier(context.inboundPlanId), shipmentId = inboundIdentifier(context.shipmentId);
  if (root.shipmentId !== shipmentId || root.inboundPlanId !== undefined && root.inboundPlanId !== inboundPlanId) return invalid();
  // Do not project source/destination addresses, contacts or tracking payloads.
  const destination = root.destination === undefined ? null : object(root.destination);
  return { inboundPlanId, shipmentId, name: optionalText(root.name), shipmentConfirmationId: optionalText(root.shipmentConfirmationId), amazonReferenceId: optionalText(root.amazonReferenceId),
    sourceStatus: optionalText(root.status), destinationType: destination ? optionalText(destination.destinationType) : null, destinationWarehouseId: destination ? optionalText(destination.warehouseId) : null };
}

export function inboundItemKey(row: Pick<InboundItemObservation, "inboundPlanId" | "shipmentId" | "sellerSku" | "fnsku" | "expiration" | "manufacturingLotCode">): string {
  return JSON.stringify([row.inboundPlanId, row.shipmentId, row.sellerSku, row.fnsku, row.expiration, row.manufacturingLotCode]);
}
export function inboundShipmentKey(row: InboundShipmentReference): string { return JSON.stringify([row.inboundPlanId, row.shipmentId]); }

export function parseInboundItemsPage(value: unknown, context: InboundItemContext): { items: InboundItemObservation[]; nextToken?: string } {
  const root = object(value), inboundPlanId = inboundIdentifier(context.inboundPlanId);
  const shipmentId = context.shipmentId === undefined ? null : inboundIdentifier(context.shipmentId);
  const items = rows(root.items).map((raw): InboundItemObservation => {
    const row = object(raw);
    const expiration = row.expiration === undefined || row.expiration === null ? null : typeof row.expiration === "string" && row.expiration.length === 10 ? date(row.expiration) : timestamp(row.expiration);
    return { inboundPlanId, shipmentId, sellerSku: text(row.msku, 255), asin: optionalText(row.asin), fnsku: optionalText(row.fnsku), expiration, manufacturingLotCode: optionalText(row.manufacturingLotCode),
      declaredQuantity: quantity(row.quantity), quantitySemantics: shipmentId === null ? "PLAN_DECLARED" : "SHIPMENT_DECLARED", shippedQuantity: null, receivedQuantity: null, inTransitQuantity: null };
  });
  return { items: mergeInboundRows([], items, inboundItemKey), nextToken: nextToken(root) };
}

export function assertInboundPageProgress(requestedToken: string | undefined, responseToken: string | undefined, priorTokens: readonly string[]): void {
  inboundPaginationToken(requestedToken); inboundPaginationToken(responseToken);
  if (priorTokens.length > 1000 || priorTokens.some(token => !inboundPaginationToken(token)) || responseToken !== undefined && (priorTokens.length >= 1000 || responseToken === requestedToken || priorTokens.includes(responseToken))) return invalid();
}

/** Source marketplace is verified against an upstream fact, never a warehouse.
 * Multi-marketplace plans cannot be assigned to one site without item evidence.
 */
export function assertInboundPlanMarketplace(plan: InboundPlanObservation, marketplaceId: string): void {
  if (plan.marketplaceIds.length !== 1 || plan.marketplaceIds[0] !== marketplaceId) return invalid();
}

export function assertInboundRoles(auth: { approvedRoles: readonly string[]; rolesAttestedAt: Date | null }): void {
  if (!(auth.rolesAttestedAt instanceof Date) || !Number.isFinite(auth.rolesAttestedAt.getTime()) || !auth.approvedRoles.includes("Amazon Fulfillment")) return invalid();
}

export type InboundTraversalEvidence = {
  planListComplete: boolean;
  plans: readonly InboundPlanObservation[];
  planDetails: readonly InboundPlanDetail[];
  completedPlanItems: readonly string[];
  shipmentDetails: readonly InboundShipmentObservation[];
  completedShipmentItems: readonly InboundShipmentReference[];
};

/** Complete means all visible plans traversed, never all account/history coverage.
 * No marketplace is inferred from an inbound plan, SKU, ASIN or destination.
 */
export function assertInboundTraversalComplete(evidence: InboundTraversalEvidence): { coverage: "VISIBLE_PLANS_ONLY"; marketplaceVerified: false; plans: number; shipments: number } {
  if (evidence.planListComplete !== true || evidence.plans.length > 1000 || evidence.planDetails.length > 1000 || evidence.completedPlanItems.length > 1000 || evidence.shipmentDetails.length > 50_000 || evidence.completedShipmentItems.length > 50_000) return invalid();
  const planIds = evidence.plans.map(row => inboundIdentifier(row.inboundPlanId));
  const detailIds = evidence.planDetails.map(row => inboundIdentifier(row.inboundPlanId));
  const completedPlanIds = evidence.completedPlanItems.map(inboundIdentifier);
  function sameSet(a: readonly string[], b: readonly string[]) {
    const right = new Set(b);
    return new Set(a).size === a.length && right.size === b.length && a.length === b.length && a.every(id => right.has(id));
  }
  if (!sameSet(planIds, detailIds) || !sameSet(planIds, completedPlanIds)) return invalid();
  const expectedShipments: string[] = [];
  for (const plan of evidence.planDetails) {
    if (plan.shipments.length > 1000) return invalid();
    for (const shipment of plan.shipments) {
      if (shipment.inboundPlanId !== plan.inboundPlanId) return invalid();
      inboundIdentifier(shipment.shipmentId);
      expectedShipments.push(inboundShipmentKey(shipment));
      if (expectedShipments.length > 50_000) return invalid();
    }
  }
  const actualKeys = evidence.shipmentDetails.map(row => { inboundIdentifier(row.inboundPlanId); inboundIdentifier(row.shipmentId); return inboundShipmentKey(row); });
  const completedKeys = evidence.completedShipmentItems.map(row => { inboundIdentifier(row.inboundPlanId); inboundIdentifier(row.shipmentId); return inboundShipmentKey(row); });
  if (!sameSet(expectedShipments, actualKeys) || !sameSet(expectedShipments, completedKeys)) return invalid();
  return { coverage: "VISIBLE_PLANS_ONLY", marketplaceVerified: false, plans: planIds.length, shipments: expectedShipments.length };
}

/** A received timestamp is intentionally absent: observed time is not an event. */
export function inboundObservationTime(value: unknown): string { return timestamp(value); }
export function inboundSourceUpdatedTime(value: unknown): string | null { return optionalTimestamp(value); }
