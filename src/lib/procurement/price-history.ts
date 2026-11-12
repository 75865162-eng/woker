import { WmsInputError } from '@/lib/wms/rules';

export function parsePurchasePriceHistoryQuery(params: URLSearchParams) {
  if ([...params.keys()].some(key => !['view', 'supplierId', 'productRecordId'].includes(key))) throw new WmsInputError('采购历史价筛选字段无效。');
  const supplierId = (params.get('supplierId') ?? '').trim();
  const productRecordIds = [...new Set(params.getAll('productRecordId').map(value => value.trim()).filter(Boolean))];
  if (!supplierId || supplierId.length > 120 || !productRecordIds.length || productRecordIds.length > 100 || productRecordIds.some(id => id.length > 120)) throw new WmsInputError('须提供一个供应商和 1-100 个有效商品。');
  return { supplierId, productRecordIds };
}
