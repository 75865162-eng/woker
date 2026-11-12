/** Wimoor Material/Assembly/Supplier semantics, expressed in the ERP product aggregate.
 * Identity scope, cycle prevention and decimal text are target ERP safeguards.
 */
export type ProductManagement = {
  brandId: string | null;
  categoryId: string | null;
  carton: { lengthCm: string | null; widthCm: string | null; heightCm: string | null; grossWeightG: string | null; unitsPerCarton: number | null } | null;
  components: Array<{ productRecordId: string; quantity: number; notes: string }>;
  listingIdentifiers: Array<{ sellerAccountId: string; marketplaceId: string; sellerSku: string; asin: string | null; fnsku: string | null }>;
  suppliers: Array<{ supplierId: string; supplierSku: string; productUrl: string; purchaseLeadTime: string; moq: number | null; isPrimary: boolean; notes: string }>;
};

export class ProductManagementError extends Error {
  constructor(message: string, readonly status = 422) { super(message); this.name = 'ProductManagementError'; }
}
export function emptyProductManagement(): ProductManagement {
  return { brandId: null, categoryId: null, carton: null, components: [], listingIdentifiers: [], suppliers: [] };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new ProductManagementError('商品管理字段无效。');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new ProductManagementError(`${label}无效。`);
  return value.trim();
}
function nullableText(value: unknown, label: string) { return value === null ? null : text(value, label, 200, true); }
function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new ProductManagementError(`${label}须为正整数。`);
  return value;
}
function decimal(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value)) throw new ProductManagementError('外箱尺寸/毛重须为正数十进制文本，未知请留空。');
  return value;
}
function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > 100) throw new ProductManagementError(`${label}最多 100 项。`);
  return value;
}
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) throw new ProductManagementError(`${label}不能重复。`); }

export function parseProductManagement(value: unknown): ProductManagement {
  const input = record(value, ['brandId', 'categoryId', 'carton', 'components', 'listingIdentifiers', 'suppliers']);
  const output = emptyProductManagement();
  output.brandId = nullableText(input.brandId, '品牌'); output.categoryId = nullableText(input.categoryId, '分类');
  if (input.carton !== null) {
    const carton = record(input.carton, ['lengthCm', 'widthCm', 'heightCm', 'grossWeightG', 'unitsPerCarton']);
    output.carton = { lengthCm: decimal(carton.lengthCm), widthCm: decimal(carton.widthCm), heightCm: decimal(carton.heightCm), grossWeightG: decimal(carton.grossWeightG), unitsPerCarton: carton.unitsPerCarton === null ? null : positiveInteger(carton.unitsPerCarton, '单箱数量') };
  }
  output.components = rows(input.components, '组合明细').map(raw => {
    const row = record(raw, ['productRecordId', 'quantity', 'notes']);
    return { productRecordId: text(row.productRecordId, '子商品', 200, true), quantity: positiveInteger(row.quantity, '组成用量'), notes: text(row.notes, '组成备注', 500) };
  });
  unique(output.components.map(row => row.productRecordId), '子商品');
  output.listingIdentifiers = rows(input.listingIdentifiers, '刊登标识').map(raw => {
    const row = record(raw, ['sellerAccountId', 'marketplaceId', 'sellerSku', 'asin', 'fnsku']);
    const asin = nullableText(row.asin, 'ASIN'), fnsku = nullableText(row.fnsku, 'FNSKU');
    if (asin && !/^[A-Z0-9]{10}$/.test(asin) || fnsku && !/^[A-Za-z0-9]{1,50}$/.test(fnsku)) throw new ProductManagementError('ASIN/FNSKU 格式无效。');
    return { sellerAccountId: text(row.sellerAccountId, '卖家账号', 200, true), marketplaceId: text(row.marketplaceId, '站点', 200, true), sellerSku: text(row.sellerSku, '卖家 SKU', 200, true), asin, fnsku };
  });
  unique(output.listingIdentifiers.map(row => JSON.stringify([row.sellerAccountId, row.marketplaceId, row.sellerSku])), '刊登标识');
  output.suppliers = rows(input.suppliers, '供应商关系').map(raw => {
    const row = record(raw, ['supplierId', 'supplierSku', 'productUrl', 'purchaseLeadTime', 'moq', 'isPrimary', 'notes']);
    if (typeof row.isPrimary !== 'boolean') throw new ProductManagementError('主供应商标记无效。');
    const productUrl = text(row.productUrl, '采购链接', 2000);
    if (productUrl) { let url: URL; try { url = new URL(productUrl); } catch { throw new ProductManagementError('采购链接无效。'); } if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ProductManagementError('采购链接无效。'); }
    return { supplierId: text(row.supplierId, '供应商', 200, true), supplierSku: text(row.supplierSku, '供应商编码', 200), productUrl, purchaseLeadTime: text(row.purchaseLeadTime, '采购周期'), moq: row.moq === null ? null : positiveInteger(row.moq, 'MOQ'), isPrimary: row.isPrimary, notes: text(row.notes, '供应商备注', 2000) };
  });
  unique(output.suppliers.map(row => row.supplierId), '供应商');
  if (output.suppliers.length && output.suppliers.filter(row => row.isPrimary).length !== 1) throw new ProductManagementError('有供货关系时须选定且仅选定一个主供应商。');
  return output;
}

/** Iterative DFS; shared parts in a DAG are valid, back edges are not. */
export function assertProductCompositionAcyclic(rootId: string, graph: ReadonlyMap<string, readonly string[]>) {
  const active = new Set<string>(), visited = new Set<string>();
  const stack: Array<{ id: string; leaving: boolean }> = [{ id: rootId, leaving: false }];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.leaving) { active.delete(node.id); visited.add(node.id); continue; }
    if (active.has(node.id)) throw new ProductManagementError('组合品不能自引用或形成循环。');
    if (visited.has(node.id)) continue;
    if (active.size > 50 || visited.size > 5000) throw new ProductManagementError('组合关系超过可验证范围。');
    active.add(node.id); stack.push({ id: node.id, leaving: true });
    for (const child of graph.get(node.id) ?? []) stack.push({ id: child, leaving: false });
  }
}
