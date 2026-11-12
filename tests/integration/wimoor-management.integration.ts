import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { mutateAdsBusinessChange, queryAdsBusinessChanges } from '@/lib/amazon-ads/change-service';
import { recordAdsEntityObservation } from '@/lib/amazon-ads/entity-history';
import { projectProductCenter } from '@/lib/products/product-center-projection';
import { saveProductAggregate } from '@/lib/products/product-aggregate-service';
import { emptyProductManagement } from '@/lib/products/management-contract';
import { saveProductCatalog, queryProductCatalog } from '@/lib/products/catalog-service';
import type { Product } from '@/lib/products/types';
if (process.env.AMAZON_SYNC_OFFLINE_FIXTURE !== '1') throw new Error('Disposable runner required');
const scope = { organizationId: randomUUID(), workspaceId: 'fixture' }, productScope = { ...scope, accountId: '', marketplace: '' };
const creator = randomUUID(), reviewer = randomUUID(), viewer = randomUUID(), seller = randomUUID(), profile = randomUUID(), task = randomUUID(), plan = randomUUID(), authorization = randomUUID();
const market = 'ATVPDKIKX0DER';
const query = () => new URLSearchParams({ profileRecordId: profile, entityType: 'SP:campaign', externalId: '101' });
const create = (key = randomUUID()) => mutateAdsBusinessChange(scope, creator, { action: 'create', profileRecordId: profile, entityType: 'SP:campaign', externalId: '101', patch: { dailyBudget: '30.000001' }, reason: 'Fixture review', requestKey: key });
const transition = (actor: string, draft: { id: string; revision: number }, action: string, reason?: string) => mutateAdsBusinessChange(scope, actor, { action, profileRecordId: profile, id: draft.id, revision: draft.revision, ...(reason ? { reason } : {}) });
function product(sku: string): Product { return { id: randomUUID(), sku, chineseName: '隔离商品', englishName: '', asin: '', developer: '', purchasePrice: 0, status: 'pending', supplierName: '', supplierUrl: '', specs: '', purchaseLeadTime: '', createdAt: '2026-11-12T00:00:00Z', keywords: '', note: '', cancelReason: '', hsCode: '', images: [], competitorAsins: [], productWeightG: 0, packageWeightG: 0, productSizeCm: { length: 0, width: 0, height: 0 }, packageSizeCm: { length: 0, width: 0, height: 0 }, management: emptyProductManagement() }; }
const save = (value: Product) => prisma.$transaction(tx => saveProductAggregate(tx, { product: value, user: { id: creator, organizationId: scope.organizationId }, scope: productScope, expectedRevision: value.revision }));
before(async () => {
  await prisma.organization.create({ data: { id: scope.organizationId, name: 'Fixture', slug: scope.organizationId } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: scope.workspaceId, name: 'Fixture' } });
  await prisma.workspaceScope.create({ data: { organizationId: scope.organizationId, id: 'other', name: 'Other fixture' } });
  for (const [id, role] of [[creator, 'owner'], [reviewer, 'owner'], [viewer, 'viewer']] as const) await prisma.user.create({ data: { id, name: 'Fixture', email: `${id}@fixture.invalid`, passwordHash: 'fixture-no-login', memberships: { create: { organizationId: scope.organizationId, role } } } });
  await prisma.sellerAccount.create({ data: { ...scope, id: seller, accountKey: seller, displayName: 'Fixture store', marketplaceCode: 'US' } });
  for (const userId of [creator, reviewer, viewer]) await prisma.amazonDataAccessGrant.create({ data: { ...scope, id: randomUUID(), userId, sellerAccountId: seller, marketplaceIds: [market], actions: ['view'] } });
  await prisma.amazonSellerBinding.create({ data: { ...scope, sellerAccountId: seller, marketplaceId: market, amazonSellerId: 'FIXTURE-SELLER' } });
  await prisma.amazonAdsAuthorization.create({ data: { ...scope, id: authorization, name: 'Fixture', consentRegion: 'NA', status: 'CONNECTED', credentialsCiphertext: 'fixture-unused', authorizedByUserId: creator } });
  await prisma.amazonAdsProfile.create({ data: { ...scope, id: profile, authorizationId: authorization, profileId: '90001', region: 'NA', countryCode: 'US', sellerAccountId: seller, marketplaceId: market, accountInfo: {} } });
  await prisma.amazonAdsSyncPlan.create({ data: { ...scope, id: plan, profileId: profile, actorUserId: creator, sellerAccountId: seller, authorizationRevision: 1 } });
  await prisma.amazonAdsSyncTask.create({ data: { ...scope, id: task, profileId: profile, planId: plan, requestedByUserId: creator, planRevision: 1, idempotencyKey: randomUUID(), status: 'SUCCEEDED' } });
  await prisma.amazonAdsEntityRecord.create({ data: { ...scope, id: randomUUID(), profileId: profile, sourceTaskId: task, entityType: 'SP:campaign', externalId: '101', state: 'ENABLED', name: 'Fixture campaign', payload: { campaignId: '101', budget: { budget: '25', budgetType: 'DAILY' } } } });
});
after(() => prisma.$disconnect());

test('persisted draft idempotency, independent review, version conflict, and execution blocker', async () => {
  const key = randomUUID(), created = await create(key), reused = await create(key);
  assert.equal(reused.draft.id, created.draft.id); assert.equal(reused.reused, true);
  await assert.rejects(() => mutateAdsBusinessChange(scope, creator, { action: 'create', profileRecordId: profile, entityType: 'SP:campaign', externalId: '101', patch: { dailyBudget: '31' }, reason: 'Fixture review', requestKey: key }));
  const submitted = await transition(creator, created.draft, 'submit');
  await assert.rejects(() => transition(creator, submitted.draft, 'approve'));
  await assert.rejects(() => transition(reviewer, created.draft, 'approve'));
  const approved = await transition(reviewer, submitted.draft, 'approve');
  assert.equal(approved.draft.status, 'APPROVED'); assert.equal(approved.executionEnabled, false);
  await assert.rejects(() => transition(creator, approved.draft, 'execute'));
  const cancelled = await transition(creator, approved.draft, 'cancel');
  assert.equal(cancelled.draft.status, 'CANCELLED');
  assert.deepEqual((await prisma.amazonAdsEntityRecord.findFirstOrThrow({ where: { ...scope, profileId: profile } })).payload, { campaignId: '101', budget: { budget: '25', budgetType: 'DAILY' } });
  await assert.rejects(() => prisma.amazonAdsChangeDraft.update({ where: { id: created.draft.id }, data: { patch: { dailyBudget: '99' } } }));
  await assert.rejects(() => prisma.amazonAdsChangeDraft.delete({ where: { id: created.draft.id } }));
});

test('live revocation, disabled user, cross workspace and read-only mutation are denied', async () => {
  await assert.rejects(() => queryAdsBusinessChanges({ ...scope, workspaceId: 'other' }, creator, query()));
  await assert.rejects(() => mutateAdsBusinessChange(scope, viewer, { action: 'create', profileRecordId: profile }));
  const grant = await prisma.amazonDataAccessGrant.findFirstOrThrow({ where: { ...scope, userId: creator } });
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { enabled: false } });
  await assert.rejects(() => create());
  await prisma.amazonDataAccessGrant.update({ where: { id: grant.id }, data: { enabled: true } });
  await prisma.user.update({ where: { id: reviewer }, data: { status: 'disabled' } });
  await assert.rejects(() => queryAdsBusinessChanges(scope, reviewer, query()));
  await prisma.user.update({ where: { id: reviewer }, data: { status: 'active' } });
  const read = await queryAdsBusinessChanges(scope, viewer, query());
  assert.deepEqual(read.editableFields, []); assert.ok(read.drafts.every(row => row.availableActions.length === 0));
});

test('changed baseline and expiry prevent submission; parallel reviews accept exactly one', async () => {
  const stale = await create();
  await prisma.amazonAdsEntityRecord.updateMany({ where: { ...scope, profileId: profile }, data: { name: 'Changed fixture' } });
  await assert.rejects(() => transition(creator, stale.draft, 'submit'));
  const current = await create(), submitted = await transition(creator, current.draft, 'submit');
  const attempts = await Promise.allSettled([transition(reviewer, submitted.draft, 'approve'), transition(reviewer, submitted.draft, 'reject', 'Fixture rejection')]);
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(row => row.status === 'rejected').length, 1);
  // Separate inserted fixture tests service expiry without changing immutable evidence.
  const expired = await prisma.amazonAdsChangeDraft.create({ data: { ...scope, id: randomUUID(), profileId: profile, entityType: 'SP:campaign', externalId: '101', requestKey: randomUUID(), before: {}, patch: { state: 'PAUSED' }, snapshotHash: 'fixture-expired', reason: 'Fixture expired', createdBy: creator, expiresAt: new Date(0) } });
  await assert.rejects(() => transition(creator, expired, 'submit'));
});

test('observations deduplicate, redact secrets, remain immutable and exclude unfinished tasks', async () => {
  const input = { scope, profileId: profile, entityType: 'SP:campaign', externalId: '101', sourceTaskId: task, before: { bid: '1' }, after: { bid: '2', accessToken: 'never-publish' } };
  await prisma.$transaction(async tx => { await recordAdsEntityObservation(tx, input); await recordAdsEntityObservation(tx, input); });
  assert.equal(await prisma.amazonAdsEntityHistory.count({ where: scope }), 1);
  const observation = await prisma.amazonAdsEntityHistory.findFirstOrThrow({ where: scope });
  assert.deepEqual(observation.after, { bid: '2' });
  await assert.rejects(() => prisma.amazonAdsEntityHistory.update({ where: { id: observation.id }, data: { after: {} } }));
  await assert.rejects(() => prisma.amazonAdsEntityHistory.delete({ where: { id: observation.id } }));
  await prisma.$transaction(tx => recordAdsEntityObservation(tx, { ...input, before: { bid: '2' }, after: { bid: '2' } }));
  assert.equal(await prisma.amazonAdsEntityHistory.count({ where: scope }), 1);
  assert.equal((await queryAdsBusinessChanges(scope, creator, query())).history.length, 1);
  await prisma.amazonAdsSyncTask.update({ where: { id: task }, data: { status: 'FAILED' } });
  assert.equal((await queryAdsBusinessChanges(scope, creator, query())).history.length, 0);
  await prisma.amazonAdsSyncTask.update({ where: { id: task }, data: { status: 'SUCCEEDED' } });
});

test('product aggregate saves and rereads managed facts with audit, outbox, disabled catalog and supplier removal', async () => {
  const brand = await saveProductCatalog({ ...scope, actor: creator }, { kind: 'BRAND', code: 'FIXTURE', name: 'Fixture brand', color: '', notes: '', enabled: true });
  const supplier = await prisma.supplier.create({ data: { id: randomUUID(), organizationId: scope.organizationId, name: 'Fixture supplier', normalizedName: 'fixture supplier' } });
  const input = product('FIXTURE-MAIN');
  input.management!.brandId = brand.id;
  input.management!.suppliers = [{ supplierId: supplier.id, supplierSku: 'SUP-1', productUrl: '', purchaseLeadTime: '14 days', moq: 10, isPrimary: true, notes: '' }];
  input.management!.listingIdentifiers = [{ sellerAccountId: seller, marketplaceId: market, sellerSku: 'SELLER-SKU', asin: 'B012345678', fnsku: 'X001FIXTURE' }];
  const saved = await save(input);
  assert.equal(saved.product.supplierName, supplier.name);
  await prisma.$transaction(tx => projectProductCenter(tx, { product: saved.product, ...productScope, sourceRevision: saved.product.revision! }));
  assert.equal((await prisma.productMaster.findUniqueOrThrow({ where: { productRecordId: saved.product.id } })).brand, brand.name);
  assert.equal(await prisma.productSupplier.count({ where: { ...scope, supplierId: supplier.id } }), 1);
  const read = await prisma.productRecord.findUniqueOrThrow({ where: { id: saved.product.id } });
  assert.deepEqual((read.payload as Prisma.JsonObject).management, saved.product.management);
  assert.ok(await prisma.auditLog.count({ where: { organizationId: scope.organizationId, entityId: input.sku } }));
  assert.ok(await prisma.productOutboxEvent.count({ where: { ...scope, entityId: input.sku } }));
  await saveProductCatalog({ ...scope, actor: creator }, { id: brand.id, revision: brand.revision, kind: brand.kind, code: brand.code, name: brand.name, color: brand.color, notes: brand.notes, enabled: false });
  const updated = await save({ ...saved.product, management: { ...saved.product.management!, suppliers: [] } });
  assert.equal(updated.product.supplierName, ''); assert.equal(updated.product.supplierUrl, '');
  await prisma.$transaction(tx => projectProductCenter(tx, { product: updated.product, ...productScope, sourceRevision: updated.product.revision! }));
  assert.equal(await prisma.productSupplier.count({ where: { ...scope, supplierId: supplier.id } }), 0);
  await assert.rejects(() => save(saved.product));
  const restored = await prisma.$transaction(tx => saveProductAggregate(tx, { product: { ...saved.product, revision: updated.product.revision }, user: { id: creator, organizationId: scope.organizationId }, scope: productScope, expectedRevision: updated.product.revision, eventType: 'product_restored', allowStatusRollback: true }));
  assert.equal(restored.product.management!.suppliers[0].supplierId, supplier.id);
  const cleared = await save({ ...restored.product, management: { ...restored.product.management!, suppliers: [] } });
  await assert.rejects(() => save({ ...product('NEW-WITH-DISABLED'), management: { ...emptyProductManagement(), brandId: brand.id } }));
  const legacy = { ...cleared.product }; delete legacy.management;
  const preserved = await save(legacy); assert.deepEqual(preserved.product.management, updated.product.management);
  const choices = await queryProductCatalog({ ...scope, actor: creator }, new URLSearchParams());
  assert.equal(choices.listingChoices[0].sellerAccountId, seller);
});

test('product references deny cross workspace and graph edits serialize to prevent two-product cycles', async () => {
  const other = await prisma.productRecord.create({ data: { organizationId: scope.organizationId, workspaceId: 'other', id: randomUUID(), userId: creator, sku: 'FOREIGN-PART', payload: {} } });
  await assert.rejects(() => save({ ...product('FOREIGN-REF'), management: { ...emptyProductManagement(), components: [{ productRecordId: other.id, quantity: 1, notes: '' }] } }));
  const a = (await save(product('FIXTURE-A'))).product, b = (await save(product('FIXTURE-B'))).product;
  const updates = await Promise.allSettled([
    save({ ...a, management: { ...a.management!, components: [{ productRecordId: b.id, quantity: 1, notes: '' }] } }),
    save({ ...b, management: { ...b.management!, components: [{ productRecordId: a.id, quantity: 1, notes: '' }] } }),
  ]);
  assert.equal(updates.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(updates.filter(row => row.status === 'rejected').length, 1);
  await assert.rejects(() => save({ ...product('MISSING-PART'), management: { ...emptyProductManagement(), components: [{ productRecordId: 'nonexistent', quantity: 1, notes: '' }] } }));
  await assert.rejects(() => save({ ...product('MISSING-SITE'), management: { ...emptyProductManagement(), listingIdentifiers: [{ sellerAccountId: seller, marketplaceId: 'UNBOUND', sellerSku: 'SKU', asin: null, fnsku: null }] } }));
});

test('revocation while evidence query waits on SQL withholds all draft and history results', async () => {
  let release = () => {}, ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { ready = resolve; });
  const lock = prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "AmazonAdsEntityHistory" IN ACCESS EXCLUSIVE MODE');
    ready(); await gate;
  }, { timeout: 10000 });
  await acquired;
  const pending = queryAdsBusinessChanges(scope, creator, query()).then(value => ({ value, error: null }), error => ({ value: null, error }));
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%AmazonAdsEntityHistory%' AND query LIKE 'SELECT%') AS waiting`;
      if (rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waiting, 'must reach actual temporary-table SQL lock');
    await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: creator }, data: { enabled: false } });
  } finally { release(); await lock; }
  try { const result = await pending; assert.equal(result.value, null); assert.ok(result.error); }
  finally { await prisma.amazonDataAccessGrant.updateMany({ where: { ...scope, userId: creator }, data: { enabled: true } }); }
});
