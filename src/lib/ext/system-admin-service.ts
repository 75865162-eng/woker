/**
 * 系统管理升级（2026-11-24，对标 wimoor sys 域，排除亚马逊）。
 * 部门 / 公告 / 个人记事本 / 在线用户会话监控。
 *
 * 架构红线：全部为本系统内主数据，不覆盖外部快照；公告发布后进入
 * UserNotification 投递（幂等 dedupeKey），不改会话/权限主链路。
 * 沿用组织+工作区双围栏、乐观锁 revision、审计 erp.ext.* 范式。
 */
import { prisma } from '@/lib/db/prisma';
import { auditEntity, authorizeEntity, json, scoped } from './access';
import { WmsError, type WmsScope } from '@/lib/wms/contracts';
import { requireRevision, requireText } from '@/lib/wms/rules';
import { requireEnum, requireInt, optionalDate } from './rules';

const DEPARTMENT_CODE = /^[A-Z0-9_-]{1,40}$/;

function requireDepartmentCode(value: unknown) {
  const code = requireText(value, '部门编码', 40).toUpperCase();
  if (!DEPARTMENT_CODE.test(code)) throw new WmsError('部门编码只能包含大写字母、数字、下划线和连字符。', 400);
  return code;
}

/** 部门：新建 / 编辑（revision 乐观锁）。 */
export async function saveDepartment(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '部门 ID', 64) : null;
  const draft = {
    code: requireDepartmentCode(body.code),
    name: requireText(body.name, '部门名称', 80),
    parentId: typeof body.parentId === 'string' && body.parentId ? body.parentId.slice(0, 64) : null,
    leader: typeof body.leader === 'string' ? body.leader.slice(0, 80) : '',
    sortOrder: requireInt(body.sortOrder ?? 0, '排序', { max: 99_999 }),
    enabled: body.enabled !== false,
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id && draft.parentId === id) throw new WmsError('部门不能把自己设为上级。', 400);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.department.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('部门不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('部门已被他人修改，请刷新后重试。', 409);
      const updated = await tx.department.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'department.update', id, { code: draft.code, name: draft.name });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    if (draft.parentId) {
      const parent = await tx.department.findFirst({ where: { ...where, id: draft.parentId } });
      if (!parent) throw new WmsError('上级部门不存在或不属于当前工作区。', 404);
    }
    const created = await tx.department.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'department.create', created.id, { code: draft.code, name: draft.name });
    return created;
  });
}

/** 公告：新建 / 编辑；发布时写入 UserNotification（幂等）。 */
export async function saveAnnouncement(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '公告 ID', 64) : null;
  const status = requireEnum(body.status, '公告状态', ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const, 'DRAFT');
  const audience = requireEnum(body.audience, '发布范围', ['ALL', 'ROLE', 'DEPARTMENT'] as const, 'ALL');
  const draft = {
    title: requireText(body.title, '公告标题', 160),
    body: typeof body.body === 'string' ? body.body.slice(0, 20_000) : '',
    audience,
    audienceValue: typeof body.audienceValue === 'string' ? body.audienceValue.slice(0, 80) : '',
    pinned: body.pinned === true,
    status,
    publishedAt: status === 'PUBLISHED' ? (body.publishedAt ? optionalDate(body.publishedAt, '发布日期') : new Date()) : null,
  };
  if (audience !== 'ALL' && !draft.audienceValue) throw new WmsError('指定范围发布时须填写角色或部门。', 400);
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    let announcementId = id;
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.announcement.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('公告不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('公告已被他人修改，请刷新后重试。', 409);
      await tx.announcement.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'announcement.update', id, { title: draft.title, status });
    } else {
      await authorizeEntity(tx, scope, 'create');
      const created = await tx.announcement.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
      announcementId = created.id;
      await auditEntity(tx, scope, 'announcement.create', created.id, { title: draft.title, status });
    }
    // 发布即投递：仅 ALL 范围做全员投递；定向范围留待通知中心按角色/部门解析，
    // 这里不臆造成员映射，避免发错人。dedupeKey 保证重复发布不重复打扰。
    if (status === 'PUBLISHED' && audience === 'ALL' && announcementId) {
      const members = await tx.organizationMember.findMany({
        where: { organizationId: scope.organizationId },
        select: { userId: true },
      });
      const userIds = Array.from(new Set(members.map(row => row.userId)));
      for (const recipientUserId of userIds) {
        await tx.userNotification.upsert({
          where: { dedupeKey: `announcement:${announcementId}:${recipientUserId}` },
          create: {
            id: crypto.randomUUID(),
            organizationId: scope.organizationId,
            recipientUserId,
            actorUserId: scope.actorUserId,
            dedupeKey: `announcement:${announcementId}:${recipientUserId}`,
            type: 'ANNOUNCEMENT',
            title: draft.title,
            message: draft.body.slice(0, 500),
            entityType: 'ANNOUNCEMENT',
            entityId: announcementId,
            metadata: json({ workspaceId: scope.workspaceId, pinned: draft.pinned }),
          },
          update: { title: draft.title, message: draft.body.slice(0, 500) },
        });
      }
    }
    return { id: announcementId };
  });
}

/** 个人记事本：仅本人可见，按 userId 硬隔离。 */
export async function savePersonalNote(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '记事 ID', 64) : null;
  const draft = {
    title: typeof body.title === 'string' ? body.title.slice(0, 160) : '',
    content: typeof body.content === 'string' ? body.content.slice(0, 20_000) : '',
    pinned: body.pinned === true,
  };
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = { ...scoped(scope), userId: scope.actorUserId };
    if (id) {
      const current = await tx.personalNote.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('记事不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('记事已被修改，请刷新后重试。', 409);
      return tx.personalNote.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
    }
    return tx.personalNote.create({ data: { id: crypto.randomUUID(), ...where, ...draft } });
  });
}

export async function deletePersonalNote(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '记事 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const where = { ...scoped(scope), userId: scope.actorUserId };
    const current = await tx.personalNote.findFirst({ where: { ...where, id } });
    if (!current) throw new WmsError('记事不存在。', 404);
    await tx.personalNote.delete({ where: { id } });
    await auditEntity(tx, scope, 'personal-note.delete', id, {});
    return { ok: true };
  });
}

/** 强制下线：删除目标用户的会话令牌（权限由 API 路由 requireApiPermission 把关）。 */
export async function revokeSession(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '会话 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const session = await tx.userSession.findFirst({
      where: { id, user: { memberships: { some: { organizationId: scope.organizationId } } } },
    });
    if (!session) throw new WmsError('会话不存在或不属于当前组织。', 404);
    await tx.userSession.delete({ where: { id } });
    await auditEntity(tx, scope, 'session.revoke', id, { userId: session.userId });
    return { ok: true };
  });
}
