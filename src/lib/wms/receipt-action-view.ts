import type { WmsCommandPayload } from "./contracts";

export type ReceiptAction = "RECEIVE" | "INSPECT" | "PUTAWAY" | "RETURN_REJECTED";
export type ReceiptActionValues = Record<string, { quantity: string; acceptedQty: string; rejectedQty: string; locationId: string }>;
type Line = Record<string, unknown>;

export function receiptActionRemaining(line: Line, action: ReceiptAction): number {
  if (action === "RECEIVE") return Number(line.expectedQty) - Number(line.receivedQty ?? 0);
  if (action === "INSPECT") return Number(line.receivedQty) - Number(line.acceptedQty) - Number(line.rejectedQty);
  if (action === "RETURN_REJECTED") return Number(line.rejectedQty) - Number(line.returnedQty ?? 0);
  return Number(line.acceptedQty) - Number(line.putawayQty);
}

/** Form validation only; inventory authority remains in the application service. */
export function receiptActionPayload(lines: Line[], action: ReceiptAction, values: ReceiptActionValues): WmsCommandPayload {
  const quantity = (raw: string | undefined): number => {
    const n = Number(raw);
    if (raw === undefined || !raw.trim() || !Number.isSafeInteger(n) || n < 0 || n > 2_147_483_647) throw new Error("数量必须是有效的非负整数。");
    return n;
  };
  const selected = lines.map(line => {
    const lineId = String(line.id);
    const value = values[lineId];
    const remaining = receiptActionRemaining(line, action);
    const amount = action === "INSPECT" ? quantity(value?.acceptedQty) + quantity(value?.rejectedQty) : quantity(value?.quantity);
    if (!Number.isSafeInteger(remaining) || remaining < 0 || amount > remaining) throw new Error("作业数量不能超过该明细的剩余数量，请刷新单据后重试。");
    return { lineId, value, amount };
  }).filter(line => line.amount > 0);
  if (!selected.length) throw new Error(action === "RECEIVE" ? "至少填写一行大于零的实收数量；零收明细将记录为短收。" : "请填写至少一行有效数量。");
  if (action === "INSPECT") return { action, lines: selected.map(({ lineId, value }) => ({ lineId, acceptedQty: Number(value.acceptedQty), rejectedQty: Number(value.rejectedQty) })) };
  if (action === "PUTAWAY") return { action, lines: selected.map(({ lineId, value, amount }) => {
    if (!value.locationId.trim()) throw new Error("请选择有上架数量的明细的目标库位。");
    return { lineId, locationId: value.locationId, quantity: amount };
  }) };
  return { action, lines: selected.map(({ lineId, amount }) => ({ lineId, quantity: amount })) };
}
