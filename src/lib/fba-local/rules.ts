import { reservationProgress as warehouseProgress } from "@/lib/wms/reservation-view";
import { createHash } from "node:crypto";
import { requirePositiveQuantity, requireRevision, requireText, strictKeys, WmsInputError } from "@/lib/wms/rules";
import type { WmsCommandInput } from "@/lib/wms/contracts";

export type FbaPlanDraft = {
  number: string; sellerAccountId: string; marketplaceId: string; idempotencyKey: string;
  lines: Array<{ balanceId: string; quantity: number }>;
};

export function parseFbaPlanDraft(raw: unknown): FbaPlanDraft {
  const value = object(raw);
  strictKeys(value, ["number", "sellerAccountId", "marketplaceId", "idempotencyKey", "lines"]);
  if (!Array.isArray(value.lines) || !value.lines.length || value.lines.length > 100) throw new WmsInputError("计划明细行数须为 1-100。");
  const seen = new Set<string>();
  const lines = value.lines.map(rawLine => {
    const line = object(rawLine);
    strictKeys(line, ["balanceId", "quantity"]);
    const balanceId = requireText(line.balanceId, "库存余额 ID", 100);
    if (seen.has(balanceId)) throw new WmsInputError("同一计划不能重复选择库存余额。");
    seen.add(balanceId);
    return { balanceId, quantity: requirePositiveQuantity(line.quantity) };
  }).sort((a, b) => a.balanceId.localeCompare(b.balanceId));
  return {
    number: requireText(value.number, "计划单号"),
    sellerAccountId: requireText(value.sellerAccountId, "Amazon 账号"),
    marketplaceId: requireText(value.marketplaceId, "Amazon 站点"),
    idempotencyKey: requireText(value.idempotencyKey, "幂等键"), lines,
  };
}

export function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsInputError("请求内容须为对象。");
  return raw as Record<string, unknown>;
}

export function draftHash(draft: FbaPlanDraft) {
  return createHash("sha256").update(JSON.stringify(parseFbaPlanDraft(draft))).digest("hex");
}

/** One immutable local line binds every stock approval to this plan and balance revision. */
export function reservationCommand(workspaceId: string, line: { id: string; balanceId: string; quantity: number }, balanceRevision: number): WmsCommandInput {
  const id = requireText(line.id, "计划明细 ID", 100);
  const revision = requireRevision(balanceRevision);
  return {
    workspaceId, aggregateId: line.balanceId, expectedRevision: revision,
    idempotencyKey: `fba-reserve:${id}:${revision}`,
    payload: { action: "RESERVE", number: `FBA-LOCAL:${id}`, quantity: requirePositiveQuantity(line.quantity) },
  };
}

export type ReservationQuantities = { requestedQty: number; releasedQty: number; dispatchedQty: number; pickedQty: number };
export function reservationProgress(quantity: number, reservation: ReservationQuantities | null) {
  if (!reservation) return { status: "NEEDS_RESERVATION" as const, reservedQty: 0, pickedQty: 0, unpickedQty: 0, warehouseStatus: null, dispatchedQty: 0, releasedQty: 0 };
  const { requestedQty, releasedQty, dispatchedQty, pickedQty } = reservation;
  if (requestedQty !== quantity || [requestedQty, releasedQty, dispatchedQty, pickedQty].some(q => !Number.isSafeInteger(q) || q < 0) || releasedQty + dispatchedQty + pickedQty > requestedQty) {
    throw new WmsInputError("计划关联预占数量不一致。", 409);
  }
  const reservedQty = requestedQty - releasedQty - dispatchedQty;
  return { status: dispatchedQty === quantity ? "DISPATCHED" as const : releasedQty === quantity ? "RELEASED" as const : releasedQty > 0 ? "PARTIALLY_RELEASED" as const : dispatchedQty > 0 ? "PARTIALLY_DISPATCHED" as const : "RESERVED" as const, reservedQty, pickedQty, unpickedQty: warehouseProgress(reservation).unpickedQty, warehouseStatus: warehouseProgress(reservation).workflowStatus, dispatchedQty, releasedQty };
}

export function assertPlanCancellable(reservations: Array<ReservationQuantities | null>) {
  if (reservations.some(r => r && (r.requestedQty !== r.releasedQty || r.dispatchedQty !== 0 || r.pickedQty !== 0))) {
    throw new WmsInputError("计划仍有预占或已出库数量；请先按 WMS 审批流程释放，已出库计划不能直接取消。", 409);
  }
}
