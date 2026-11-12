import { requirePositiveQuantity, requireText, strictKeys, WmsInputError } from '@/lib/wms/rules';

function optionalText(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new WmsInputError(`${label}格式或长度无效。`);
  return value.trim();
}

/** Shared purchase draft contract; money stays decimal text. */
export function parsePurchaseDraft(body: Record<string, unknown>) {
  strictKeys(body, ['action', 'id', 'revision', 'number', 'supplierId', 'currency', 'expectedAt', 'notes', 'lines']);
  const number = requireText(body.number, '采购单号', 80);
  const supplierId = requireText(body.supplierId, '供应商', 120);
  const currency = body.currency === undefined ? 'CNY' : body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new WmsInputError('币种须为三个大写英文字母。');
  const date = optionalText(body.expectedAt, '预计交期', 10);
  const expectedAt = date ? new Date(`${date}T00:00:00.000Z`) : null;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(expectedAt!.getTime()) || expectedAt!.toISOString().slice(0, 10) !== date)) throw new WmsInputError('预计交期须为有效日期。');
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) throw new WmsInputError('采购明细须为 1-100 行。');
  const lines = body.lines.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WmsInputError('采购明细格式无效。');
    const line = raw as Record<string, unknown>;
    strictKeys(line, ['productRecordId', 'expectedQty', 'unitPrice', 'notes']);
    if (typeof line.unitPrice !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(line.unitPrice)) throw new WmsInputError('单价须为最多六位小数的非负金额文本。');
    return { productRecordId: requireText(line.productRecordId, '采购商品', 120), expectedQty: requirePositiveQuantity(line.expectedQty, '采购数量'), unitPrice: line.unitPrice, notes: optionalText(line.notes, '商品备注', 500) };
  });
  if (new Set(lines.map(line => line.productRecordId)).size !== lines.length) throw new WmsInputError('同一采购单内商品不能重复，请合并数量。');
  return { number, supplierId, currency, expectedAt, notes: optionalText(body.notes, '采购备注', 1000), lines };
}
