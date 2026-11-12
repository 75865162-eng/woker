import { requirePositiveQuantity, requireText, strictKeys, WmsInputError } from '@/lib/wms/rules';

export function parsePurchaseReceiptLines(raw: unknown) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new WmsInputError('本次收货明细须为 1-100 行。');
  const lines = raw.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new WmsInputError('本次收货明细格式无效。');
    strictKeys(item, ['productRecordId', 'expectedQty']);
    return { productRecordId: requireText(item.productRecordId, '采购商品', 120), expectedQty: requirePositiveQuantity(item.expectedQty, '本次计划收货数量') };
  });
  if (new Set(lines.map(line => line.productRecordId)).size !== lines.length) throw new WmsInputError('本次收货商品不能重复。');
  return lines;
}
