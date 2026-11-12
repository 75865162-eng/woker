export type WmsAction = "ACTIVATE_COST_RULE" | "VALUE_COMMAND" | "SKU_CONVERSION_REVERSE" | "CONSUMABLE_ISSUE" | "SKU_CONVERT" | "TRANSFER_ORDER_SHIP" | "TRANSFER_ORDER_RECEIVE" | "TRANSFER_ORDER_CANCEL" | "LOCATION_FREEZE" | "LOCATION_UNFREEZE" | "RECEIVE" | "INSPECT" | "PUTAWAY" | "RETURN_REJECTED" | "RESERVE" | "TRANSFER" | "RELEASE" | "PICK" | "UNPICK" | "DISPATCH" | "CANCEL" | "STOCKTAKE_START" | "STOCKTAKE_COUNT" | "STOCKTAKE_REVIEW" | "STOCKTAKE_CANCEL" | "STOCKTAKE_POST";

export type WmsScope = { organizationId: string; workspaceId: string; actorUserId: string };

export type WmsLineQuantity = {
  lineId: string;
  quantity: number;
};

export type WmsCommandPayload =
  | {action:"ACTIVATE_COST_RULE";reason:string}
  | {action:"VALUE_COMMAND";reason:string;rules:{movementId:string;ruleId:string}[]}
  | {action:"SKU_CONVERSION_REVERSE";reason:string}
  | {action:"CONSUMABLE_ISSUE";sourceBalanceId:string;mainQuantity:number;reason:string}
  | {action:"SKU_CONVERT";targetLotId:string;quantity:number;reason:string}
  | {action:"TRANSFER_ORDER_SHIP"|"TRANSFER_ORDER_RECEIVE";lines:WmsLineQuantity[];reference:string}
  | {action:"TRANSFER_ORDER_CANCEL";reason:string}
  | { action: "LOCATION_FREEZE" | "LOCATION_UNFREEZE"; reason: string }
  | { action: "RECEIVE"; lines: WmsLineQuantity[] }
  | { action: "INSPECT"; lines: Array<{ lineId: string; acceptedQty: number; rejectedQty: number }> }
  | { action: "PUTAWAY"; lines: Array<{ lineId: string; locationId: string; quantity: number }> }
  | { action: "RETURN_REJECTED"; lines: WmsLineQuantity[] }
  | { action: "RESERVE"; number: string; quantity: number; outboundLineId?: string }
  | { action: "TRANSFER"; targetLocationId: string; quantity: number }
  | { action: "RELEASE" | "PICK" | "UNPICK" | "DISPATCH"; quantity: number }
  | { action: "CANCEL" }
  | { action: "STOCKTAKE_START" }
  | { action: "STOCKTAKE_REVIEW" }
  | { action: "STOCKTAKE_CANCEL" }
  | { action: "STOCKTAKE_POST" }
  | { action: "STOCKTAKE_COUNT"; lines: Array<{ locationId: string; lotId: string; countedQty: number }> };

export type WmsBalanceSnapshot = {
  onHand: number;
  pendingQc: number;
  pendingPutaway: number;
  rejected: number;
  reserved: number;
  revision: number;
};

export type WmsApprovalView = {
  id: string;
  action: WmsAction;
  aggregateId: string;
  expectedRevision: number;
  requestHash: string;
  request: WmsCommandPayload;
  requestedBy: string;
  approvedBy: string | null;
  expiresAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CONSUMED";
  revision: number;
};

export class WmsError extends Error {
  constructor(message: string, readonly status = 409) { super(message); this.name = "WmsError"; }
}
export type WmsCommandInput = { workspaceId: string; aggregateId: string; expectedRevision: number; idempotencyKey: string; payload: WmsCommandPayload };
