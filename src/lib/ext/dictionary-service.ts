import { prisma } from "@/lib/db/prisma";
import { auditEntity, authorizeEntity, json, scoped } from "./access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireRevision, requireText } from "@/lib/wms/rules";
import { Prisma } from "@prisma/client";
import { requireEnum, requireInt } from "./rules";

export async function saveDictionary(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '字典 ID', 64) : null;
  const draft = {
    code: requireText(body.code, '字典编码', 60).toUpperCase(),
    name: requireText(body.name, '字典名称', 80),
    description: typeof body.description === 'string' ? body.description.slice(0, 300) : '',
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.dataDictionary.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('字典不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('字典已被他人修改，请刷新后重试。', 409);
      const updated = await tx.dataDictionary.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'dictionary.update', id, { code: draft.code });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.dataDictionary.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'dictionary.create', created.id, { code: draft.code });
    return created;
  });
}

export async function saveDictionaryItem(scope: WmsScope, body: Record<string, unknown>) {
  const dictionaryId = requireText(body.dictionaryId, '字典', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = scoped(scope);
    const dictionary = await tx.dataDictionary.findFirst({ where: { ...where, id: dictionaryId } });
    if (!dictionary) throw new WmsError('字典不存在或不属于当前工作区。', 404);
    const value = requireText(body.value, '字典值', 60);
    const label = requireText(body.label, '显示名', 80);
    const sort = requireInt(body.sort ?? 0, '排序', { max: 99_999 });
    const enabled = body.enabled !== false;
    const saved = await tx.dataDictionaryItem.upsert({
      where: { organizationId_workspaceId_dictionaryId_value: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, dictionaryId, value } },
      create: { id: crypto.randomUUID(), ...where, dictionaryId, value, label, sort, enabled },
      update: { label, sort, enabled },
    });
    const itemCount = await tx.dataDictionaryItem.count({ where: { ...where, dictionaryId } });
    await tx.dataDictionary.update({ where: { id: dictionaryId }, data: { itemCount, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'dictionary-item.save', saved.id, { dictionaryId, value });
    return saved;
  });
}

export async function deleteDictionaryItem(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '字典项 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = scoped(scope);
    const current = await tx.dataDictionaryItem.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('字典项不存在。', 404);
    await tx.dataDictionaryItem.delete({ where: { id } });
    const itemCount = await tx.dataDictionaryItem.count({ where: { ...where, dictionaryId: current.dictionaryId } });
    await tx.dataDictionary.update({ where: { id: current.dictionaryId }, data: { itemCount, revision: { increment: 1 } } });
    await auditEntity(tx, scope, 'dictionary-item.delete', id, { dictionaryId: current.dictionaryId, value: current.value });
    return { ok: true };
  });
}

export async function saveCustomField(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '字段 ID', 64) : null;
  const options = Array.isArray(body.options) ? body.options.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 60)) : [];
  const draft = {
    entity: requireEnum(body.entity, '目标实体', ['PRODUCT', 'SUPPLIER', 'PURCHASE_ORDER', 'ORDER'] as const),
    code: requireText(body.code, '字段编码', 40),
    label: requireText(body.label, '字段名称', 60),
    fieldType: requireEnum(body.fieldType, '字段类型', ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'] as const, 'TEXT'),
    required: body.required === true,
    options: options.length ? json(options) : Prisma.DbNull,
    enabled: body.enabled !== false,
    sortOrder: requireInt(body.sortOrder ?? 0, '排序', { max: 99_999 }),
  };
  if (draft.fieldType === 'SELECT' && !options.length) throw new WmsError('选择型字段必须至少提供一个选项。', 400);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.customFieldDefinition.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('自定义字段不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('字段已被他人修改，请刷新后重试。', 409);
      const updated = await tx.customFieldDefinition.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'custom-field.update', id, { entity: draft.entity, code: draft.code });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.customFieldDefinition.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'custom-field.create', created.id, { entity: draft.entity, code: draft.code });
    return created;
  });
}
