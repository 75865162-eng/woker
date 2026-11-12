import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import { actOnFbaLocalPlan } from '../../src/lib/fba-local/service';
import { prisma } from '../../src/lib/db/prisma';
export async function verifyFinanceSourceBrowser(page: Page, base: string) {
  const role = await prisma.organizationRosterRole.findUniqueOrThrow({ where: { organizationId_id: { organizationId: 'fba-fixture', id: 'owner' } } });
  try {
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: 'fba-fixture', id: 'owner' } }, data: { permissions: { operations: ['view', 'create', 'approve'], wms: ['view', 'create', 'edit', 'approve'], products: ['view'] } } });
    const book = await prisma.financeBook.findFirstOrThrow({ where: { organizationId: 'fba-fixture', code: 'HANDOFF' } });
    const period = await prisma.financePeriod.findFirstOrThrow({ where: { bookId: book.id } });
    const subjects = await prisma.financeSubject.findMany({ where: { bookId: book.id } });
    const draft = await prisma.fbaLocalFinanceDraft.findFirstOrThrow({ where: { organizationId: 'fba-fixture', status: 'DRAFT_RULES', adjustment: { bill: { fee: { plan: { number: 'BROWSER-CORE' } } } } }, include: { adjustment: { include: { bill: { include: { fee: { include: { plan: true } } } } } } } });
    const plan = draft.adjustment.bill.fee.plan;
    await actOnFbaLocalPlan({ organizationId: 'fba-fixture', workspaceId: 'default', actorUserId: 'supervisor' }, { action: 'REVIEW_FINANCE_DRAFT', id: plan.id, expectedRevision: plan.revision, financeDraft: { draftId: draft.id } });
    const sourceKey = `FBA-ADJUSTMENT:${draft.adjustmentId}`;
    await page.goto(base + `/operations/finance-ledger?${new URLSearchParams({ sourceKind: 'FBA_ADJUSTMENT', sourceId: draft.id })}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('当前账套', { exact: true }).selectOption(book.id);
    await page.getByLabel('当前期间', { exact: true }).selectOption(period.id);
    const panel = page.getByRole('region', { name: '核算来源转入总账', exact: true });
    await expect(panel.getByLabel('核算来源类型', { exact: true })).toHaveValue('FBA_ADJUSTMENT');
    await expect(panel.getByLabel('核算草稿 ID', { exact: true })).toHaveValue(draft.id);
    await panel.getByRole('button', { name: '预览来源', exact: true }).click();
    await expect(panel).toContainText(sourceKey);
    await panel.getByLabel('来源科目 1405', { exact: true }).selectOption(subjects.find(row => row.code === '1001')!.id);
    await panel.getByLabel('来源科目 2202', { exact: true }).selectOption(subjects.find(row => row.code === '2001')!.id);
    await panel.getByLabel('来源凭证会计日期', { exact: true }).fill('2026-11-12');
    await panel.getByRole('button', { name: '保存为总账草稿', exact: true }).click();
    await expect(panel.getByRole('button', { name: '保存为总账草稿', exact: true })).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel('当前账套', { exact: true }).selectOption(book.id);
    await page.getByLabel('当前期间', { exact: true }).selectOption(period.id);
    await expect(page.getByRole('row').filter({ hasText: sourceKey })).toContainText('草稿');
    assert.equal(await prisma.financeVoucher.count({ where: { organizationId: 'fba-fixture', sourceKey: sourceKey } }), 1);
    console.log('PASS: browser previews reviewed FBA source, maps formal accounts, creates a new ledger draft and retains it after refresh');
  } finally {
    await prisma.organizationRosterRole.update({ where: { organizationId_id: { organizationId: 'fba-fixture', id: 'owner' } }, data: { permissions: role.permissions! } });
  }
}
