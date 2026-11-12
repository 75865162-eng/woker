import { remainingPurchaseQuantities, type PurchaseQuantityLine } from './receipt-allocation';

type Receipt = { status: string; lines: Array<{ productRecordId: string; expectedQty: number; receivedQty: number; acceptedQty: number; rejectedQty: number; putawayQty: number }> };
export function summarizePurchaseReceipts(orderLines: PurchaseQuantityLine[], receipts: Receipt[]) {
  if (!orderLines.length || orderLines.some(line => !Number.isInteger(line.expectedQty) || line.expectedQty <= 0) || new Set(orderLines.map(line => line.productRecordId)).size !== orderLines.length) return null;
  const remaining = remainingPurchaseQuantities(orderLines, receipts);
  if (!remaining || [...remaining.values()].some(value => value < 0)) return null;
  const putawayByProduct = new Map(orderLines.map(line => [line.productRecordId, 0]));
  let receivedQty = 0, acceptedQty = 0, rejectedQty = 0, putawayQty = 0, activeReceipts = 0;
  for (const receipt of receipts) {
    if (receipt.status === 'CANCELLED') continue;
    if (receipt.status !== 'PUTAWAY') activeReceipts++;
    for (const line of receipt.lines) {
      if ([line.expectedQty, line.receivedQty, line.acceptedQty, line.rejectedQty, line.putawayQty].some(value => !Number.isInteger(value) || value < 0) || line.receivedQty > line.expectedQty || line.acceptedQty + line.rejectedQty > line.receivedQty || line.putawayQty > line.acceptedQty) return null;
      if (receipt.status === 'PUTAWAY' && (line.acceptedQty + line.rejectedQty !== line.receivedQty || line.putawayQty !== line.acceptedQty)) return null;
      receivedQty += line.receivedQty; acceptedQty += line.acceptedQty; rejectedQty += line.rejectedQty; putawayQty += line.putawayQty;
      putawayByProduct.set(line.productRecordId, (putawayByProduct.get(line.productRecordId) ?? 0) + line.putawayQty);
    }
  }
  if (orderLines.some(line => (putawayByProduct.get(line.productRecordId) ?? 0) > line.expectedQty)) return null;
  const plannedQty = orderLines.reduce((sum, line) => sum + line.expectedQty, 0);
  const remainingQty = [...remaining.values()].reduce((sum, value) => sum + value, 0);
  const complete = activeReceipts === 0 && orderLines.every(line => putawayByProduct.get(line.productRecordId) === line.expectedQty);
  const state = complete ? 'COMPLETED' : activeReceipts > 0 ? 'IN_PROGRESS' : receipts.some(receipt => receipt.status === 'PUTAWAY') ? 'NEEDS_RECEIPT' : 'NOT_STARTED';
  return { state, plannedQty, receivedQty, acceptedQty, rejectedQty, putawayQty, remainingToPutawayQty: plannedQty - putawayQty, remainingQty, activeReceipts };
}
export type PurchaseReceiptSummary = NonNullable<ReturnType<typeof summarizePurchaseReceipts>>;
export const purchaseReceiptStateLabels: Record<PurchaseReceiptSummary['state'], string> = { NOT_STARTED: '尚未收货', IN_PROGRESS: '收货处理中', NEEDS_RECEIPT: '待补收', COMPLETED: '已全部上架' };
