import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { assertWorkspaceAccess } from '@/lib/workspace/access';
import { ProductManagementError } from './management-contract';

export type ProductCatalogScope = { organizationId: string; workspaceId: string; actor: string };
const catalogKind = (value: unknown) => { if (value !== 'BRAND' && value !== 'CATEGORY') throw new ProductManagementError('字典类型无效。'); return value; };
function field(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) throw new ProductManagementError(`${label}无效。`);
  return value.trim();
}
export async function queryProductCatalog(scope: ProductCatalogScope, params: URLSearchParams) {
  if (!await assertWorkspaceAccess(scope.organizationId, scope.workspaceId)) throw new ProductManagementError('工作区不可访问。', 403);
  const search = (params.get('search') ?? '').trim();
  if (search.length > 100) throw new ProductManagementError('搜索词过长。');
  const kind = params.get('kind');
  const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const [catalogs, suppliers, products] = await Promise.all([
    prisma.productCatalogEntry.findMany({ where: { ...where, ...(kind ? { kind: catalogKind(kind) } : {}), ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 101 }),
    prisma.supplier.findMany({ where: { organizationId: scope.organizationId, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 101 }),
    prisma.productRecord.findMany({ where: { ...where, ...(search ? { OR: [{ sku: { contains: search, mode: 'insensitive' as const } }, { chineseName: { contains: search, mode: 'insensitive' as const } }] } : {}) }, select: { id: true, sku: true, chineseName: true }, orderBy: [{ sku: 'asc' }, { id: 'asc' }], take: 101 }),
  ]);
  return { catalogs: catalogs.slice(0, 100), suppliers: suppliers.slice(0, 100), products: products.slice(0, 100), truncated: catalogs.length > 100 || suppliers.length > 100 || products.length > 100 };
}
export async function saveProductCatalog(scope: ProductCatalogScope, body: Record<string, unknown>) {
  const allowed = ['id', 'revision', 'kind', 'code', 'name', 'color', 'notes', 'enabled', 'workspaceId'];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ProductManagementError('字典字段无效。');
  const kind = catalogKind(body.kind), code = field(body.code, '编码', 50, true), name = field(body.name, '名称', 100, true);
  const color = field(body.color, '颜色', 10), notes = field(body.notes, '备注', 500);
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color) || typeof body.enabled !== 'boolean') throw new ProductManagementError('颜色/启用状态无效。');
  return prisma.$transaction(async tx => {
    if (!await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, tx)) throw new ProductManagementError('工作区不可访问。', 403);
    const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
    const data = { kind, code, name, color, notes, enabled: body.enabled as boolean };
    const id = body.id === undefined ? randomUUID() : field(body.id, '字典 ID', 200, true);
    let entry;
    if (body.id !== undefined) {
      if (!Number.isInteger(body.revision)) throw new ProductManagementError('缺少字典版本。', 409);
      const changed = await tx.productCatalogEntry.updateMany({ where: { ...where, id, kind, revision: body.revision as number }, data: { ...data, revision: { increment: 1 } } });
      if (changed.count !== 1) throw new ProductManagementError('字典版本已变化或不可访问。', 409);
      entry = await tx.productCatalogEntry.findFirstOrThrow({ where: { ...where, id } });
    } else entry = await tx.productCatalogEntry.create({ data: { id, ...where, ...data } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: scope.actor, action: 'products.catalog.save', entityType: 'ProductCatalogEntry', entityId: id, metadata: { workspaceId: scope.workspaceId, revision: entry.revision, kind } } });
    return entry;
  });
}
