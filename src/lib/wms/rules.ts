import {parseTransferOrderPayload} from './transfer-order-rules';
import { createHash } from "node:crypto";
import type { WmsAction, WmsBalanceSnapshot, WmsCommandPayload } from "./contracts";

export const wmsQuantityLimit = 2_147_483_647;
export const wmsMaxReceiptLines = 100;
export const wmsApprovalLifetimeMs = 15 * 60 * 1000;

export class WmsInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "WmsInputError";
  }
}

export class WmsConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "WmsConflictError";
  }
}

export function requireText(value: unknown, label: string, maxLength = 120) {
  if (typeof value !== "string") throw new WmsInputError(`${label}不能为空。`);
  const result = value.trim();
  if (!result || result.length > maxLength) throw new WmsInputError(`${label}长度须为 1-${maxLength} 个字符。`);
  return result;
}

export function normalizeCode(value: unknown, label: string) {
  return requireText(value, label, 64).toUpperCase();
}

export function requirePositiveQuantity(value: unknown, label = "数量") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > wmsQuantityLimit) {
    throw new WmsInputError(`${label}必须是 1-${wmsQuantityLimit} 的整数。`);
  }
  return value;
}

export function requireRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new WmsInputError("revision 无效。", 409);
  return value;
}

export function normalizeWmsPayload(input: unknown): WmsCommandPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new WmsInputError("命令内容无效。");
  const value = input as Record<string, unknown>;
  const action = value.action;
  if(action==="TRANSFER_ORDER_SHIP"||action==="TRANSFER_ORDER_RECEIVE"||action==="TRANSFER_ORDER_CANCEL")return parseTransferOrderPayload(value);
  if (action === "LOCATION_FREEZE" || action === "LOCATION_UNFREEZE") {
    strictKeys(value, ["action", "reason"]);
    return { action, reason: requireText(value.reason, "冻结/解冻原因", 500) };
  }
  if (action === "STOCKTAKE_START" || action === "STOCKTAKE_REVIEW" || action === "STOCKTAKE_CANCEL" || action === "STOCKTAKE_POST") {
    strictKeys(value, ["action"]); return { action };
  }
  if (action === "STOCKTAKE_COUNT") {
    strictKeys(value, ["action", "lines"]);
    if (!Array.isArray(value.lines) || !value.lines.length || value.lines.length > wmsMaxReceiptLines) throw new WmsInputError("盘点明细须为 1-100 行。");
    const seen = new Set<string>();
    const lines = value.lines.map(raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsInputError("盘点明细无效。");
      const line = raw as Record<string, unknown>;
      strictKeys(line, ["locationId", "lotId", "countedQty"]);
      const locationId = requireText(line.locationId, "库位 ID");
      const lotId = requireText(line.lotId, "批次 ID");
      const key = JSON.stringify([locationId, lotId]);
      if (seen.has(key)) throw new WmsInputError("同一库位批次不能重复。");
      seen.add(key);
      return { locationId, lotId, countedQty: line.countedQty === 0 ? 0 : requirePositiveQuantity(line.countedQty, "实盘数量") };
    });
    return { action, lines };
  }
  if (action === "CANCEL") { strictKeys(value, ["action"]); return { action }; }
  if (action === "RESERVE") { strictKeys(value, ["action", "number", "quantity", "outboundLineId"]); return { action, number: requireText(value.number, "预占单号"), quantity: requirePositiveQuantity(value.quantity), ...(value.outboundLineId === undefined ? {} : { outboundLineId: requireText(value.outboundLineId, "出库需求明细 ID", 100) }) }; }
  if (action === "CONSUMABLE_ISSUE") { strictKeys(value,["action","sourceBalanceId","mainQuantity","reason"]);return {action,sourceBalanceId:requireText(value.sourceBalanceId,"耗材来源余额"),mainQuantity:requirePositiveQuantity(value.mainQuantity,"主商品数量"),reason:requireText(value.reason,"发料依据",1000)}; }
  if(action==="ACTIVATE_COST_RULE"){strictKeys(value,["action","reason"]);return {action,reason:requireText(value.reason,"规则生效依据",1000)};}
  if(action==="VALUE_COMMAND"){strictKeys(value,["action","reason","rules"]);if(!Array.isArray(value.rules)||!value.rules.length||value.rules.length>200)throw new WmsInputError("计价规则须为 1-200 行。");const seen=new Set<string>();const rules=value.rules.map(raw=>{if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new WmsInputError("计价规则无效。");const row=raw as Record<string,unknown>;strictKeys(row,["movementId","ruleId"]);const movementId=requireText(row.movementId,"流水");if(seen.has(movementId))throw new WmsInputError("计价流水重复。");seen.add(movementId);return {movementId,ruleId:requireText(row.ruleId,"成本规则")};}).sort((a,b)=>a.movementId.localeCompare(b.movementId));return {action,reason:requireText(value.reason,"补充计价依据",1000),rules};}
  if (action === "SKU_CONVERSION_REVERSE") {strictKeys(value,["action","reason"]);return {action,reason:requireText(value.reason,"冲销依据",1000)};}
  if (action === "SKU_CONVERT") { strictKeys(value, ["action", "targetLotId", "quantity", "reason"]); return {action, targetLotId: requireText(value.targetLotId, "目标批次"), quantity: requirePositiveQuantity(value.quantity), reason: requireText(value.reason, "转换依据", 1000)}; }
  if (action === "TRANSFER") { strictKeys(value, ["action", "targetLocationId", "quantity"]); return { action, targetLocationId: requireText(value.targetLocationId, "目标库位 ID", 100), quantity: requirePositiveQuantity(value.quantity) }; }
  if (action === "RELEASE" || action === "PICK" || action === "UNPICK" || action === "DISPATCH") { strictKeys(value, ["action", "quantity"]); return { action, quantity: requirePositiveQuantity(value.quantity) }; }
  strictKeys(value, ["action", "lines"]);
  if (!["RECEIVE", "INSPECT", "PUTAWAY", "RETURN_REJECTED"].includes(String(action))) throw new WmsInputError("不支持的库存动作。");
  if (!Array.isArray(value.lines) || !value.lines.length || value.lines.length > wmsMaxReceiptLines) throw new WmsInputError(`明细行数须为 1-${wmsMaxReceiptLines}。`);
  const seen = new Set<string>();
  const lineId = (line: Record<string, unknown>) => {
    const id = requireText(line.lineId, "明细 ID", 100);
    if (seen.has(id)) throw new WmsInputError("同一命令不能重复包含明细。", 409);
    seen.add(id);
    return id;
  };
  const lines = value.lines.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsInputError("库存明细无效。");
    const line = raw as Record<string, unknown>;
    strictKeys(line, action === "INSPECT" ? ["lineId", "acceptedQty", "rejectedQty"] : action === "PUTAWAY" ? ["lineId", "locationId", "quantity"] : ["lineId", "quantity"]);
    if (action === "RECEIVE" || action === "RETURN_REJECTED") return { lineId: lineId(line), quantity: requirePositiveQuantity(line.quantity) };
    if (action === "INSPECT") return {
      lineId: lineId(line),
      acceptedQty: line.acceptedQty === 0 ? 0 : requirePositiveQuantity(line.acceptedQty, "合格数量"),
      rejectedQty: line.rejectedQty === 0 ? 0 : requirePositiveQuantity(line.rejectedQty, "拒收数量"),
    };
    return { lineId: lineId(line), locationId: requireText(line.locationId, "目标库位 ID", 100), quantity: requirePositiveQuantity(line.quantity) };
  });
  return { action, lines } as WmsCommandPayload;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashWmsRequest(input: { action: WmsAction; aggregateId: string; expectedRevision: number; payload: WmsCommandPayload }) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function assertBalanceInvariant(balance: WmsBalanceSnapshot) {
  const values = [balance.onHand, balance.pendingQc, balance.pendingPutaway, balance.rejected, balance.reserved];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > wmsQuantityLimit)) throw new WmsConflictError("库存余额越界。");
  if (balance.pendingQc + balance.pendingPutaway + balance.rejected + balance.reserved > balance.onHand) throw new WmsConflictError("库存分类数量超过实物数量。");
}

export function availableQuantity(balance: WmsBalanceSnapshot) {
  assertBalanceInvariant(balance);
  return balance.onHand - balance.pendingQc - balance.pendingPutaway - balance.rejected - balance.reserved;
}

export function strictKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new WmsInputError("包含未知字段。");
}

export function parseWmsCommand(raw: unknown): import('./contracts').WmsCommandInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsInputError('命令无效。');
  const value = raw as Record<string, unknown>;
  strictKeys(value, ['workspaceId', 'aggregateId', 'expectedRevision', 'idempotencyKey', 'payload']);
  return { workspaceId: requireText(value.workspaceId, '工作区'), aggregateId: requireText(value.aggregateId, '单据 ID'), expectedRevision: requireRevision(value.expectedRevision), idempotencyKey: requireText(value.idempotencyKey, '幂等键'), payload: normalizeWmsPayload(value.payload) };
}
