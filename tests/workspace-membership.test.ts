import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { changeWorkspaceMembership } from "@/lib/workspace/memberships";
import { explicitAmazonDataAccess } from "@/lib/amazon-sync/data-access";
import { prisma } from "@/lib/db/prisma";

function fixture() {
  const grants = new Set<string>();
  const users = new Map([['owner', { role: 'owner', status: 'active' }], ['member', { role: 'viewer', status: 'active' }], ['other-owner', { role: 'owner', status: 'active' }]]);
  const audit: unknown[] = [];
  const db = {
    workspaceScope: { findUnique: async ({ where }: { where: { organizationId_id: { organizationId: string; id: string } } }) => where.organizationId_id.organizationId === 'org' && where.organizationId_id.id === 'workspace' ? { id: 'workspace' } : null },
    organizationMember: { findUnique: async ({ where }: { where: { organizationId_userId: { organizationId: string; userId: string } } }) => {
      const key = where.organizationId_userId;
      const user = users.get(key.userId);
      if (!user || key.organizationId !== (key.userId === 'other-owner' ? 'other-org' : 'org')) return null;
      return { role: user.role, user: { status: user.status } };
    } },
    workspaceMembership: {
      findUnique: async ({ where }: { where: { organizationId_workspaceId_userId: { organizationId: string; workspaceId: string; userId: string } } }) => grants.has(JSON.stringify(where.organizationId_workspaceId_userId)) ? { userId: 'member' } : null,
      upsert: async ({ create }: { create: object }) => { grants.add(JSON.stringify(create)); },
      deleteMany: async ({ where }: { where: object }) => { grants.delete(JSON.stringify(where)); },
    },
    amazonDataAccessGrant: { findMany: async () => [{ sellerAccountId: 'seller' }] },
    auditLog: { create: async (value: unknown) => { audit.push(value); } },
  };
  return { db: db as never, users, audit, grants };
}

test('显式成员授权、撤销、停用、owner与跨组织边界', async () => {
  const { db, users, audit } = fixture();
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', db), false);
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'owner', db), true);
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'other-owner', db), false);
  assert.equal(await assertWorkspaceAccess('other-org', 'workspace', 'other-owner', db), false);
  await assert.rejects(() => changeWorkspaceMembership('org', 'workspace', 'member', 'member', true, db), /所有者/);
  await assert.rejects(() => changeWorkspaceMembership('org', 'workspace', 'owner', 'other-owner', true, db), /组织成员/);
  assert.equal(audit.length, 0);
  await changeWorkspaceMembership('org', 'workspace', 'owner', 'member', true, db);
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', db), true);
  users.get('member')!.status = 'disabled';
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', db), false);
  await assert.rejects(() => changeWorkspaceMembership('org', 'workspace', 'owner', 'member', true, db), /组织成员/);
  users.get('member')!.status = 'active';
  await changeWorkspaceMembership('org', 'workspace', 'owner', 'member', false, db);
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', db), false);
  users.get('owner')!.status = 'disabled';
  assert.equal(await assertWorkspaceAccess('org', 'workspace', 'owner', db), false);
  assert.equal(audit.length, 2);
});

test('权限去重只在当前Request内，撤权在新请求立即生效', async () => {
  const fixtureState = fixture();
  const globals = globalThis as typeof globalThis & { prisma?: unknown };
  const previous = globals.prisma;
  globals.prisma = fixtureState.db;
  try {
    await changeWorkspaceMembership('org', 'workspace', 'owner', 'member', true, fixtureState.db);
    const request = new Request('http://fixture.invalid/api/workspace');
    assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', prisma, request), true);
    await changeWorkspaceMembership('org', 'workspace', 'owner', 'member', false, fixtureState.db);
    assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', prisma, request), true);
    assert.equal(await assertWorkspaceAccess('org', 'workspace', 'member', prisma, new Request(request)), false);
    assert.equal(await assertWorkspaceAccess('org', 'workspace', 'other-owner', prisma, request), false);
  } finally { globals.prisma = previous; }
});

test('Amazon seller grant不能替代workspace membership', async () => {
  const { db } = fixture();
  await assert.rejects(() => explicitAmazonDataAccess({ organizationId: 'org', workspaceId: 'workspace' }, 'member', db), /不可访问/);
  await changeWorkspaceMembership('org', 'workspace', 'owner', 'member', true, db);
  assert.deepEqual(await explicitAmazonDataAccess({ organizationId: 'org', workspaceId: 'workspace' }, 'member', db), { allSellers: false, sellerIds: ['seller'] });
});
