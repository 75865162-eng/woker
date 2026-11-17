import { prisma } from "@/lib/db/prisma";
import { auditEntity, authorizeEntity, scoped } from "./access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireRevision, requireText } from "@/lib/wms/rules";
import { taxAmountOf, taxPeriodOf, requireDate, requireEnum, requireInt, requireMoney } from "./rules";
const num = (value: unknown) => Number(value);

export async function saveTaxInvoice(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '发票 ID', 64) : null;
  const taxableAmount = requireMoney(body.taxableAmount, '计税金额');
  const taxRateBp = requireInt(body.taxRateBp, '税率（万分比）', { max: 10_000 });
  const invoiceDate = requireDate(body.invoiceDate, '开票日期');
  const draft = {
    country: requireText(body.country, '国家/地区', 8).toUpperCase(),
    taxType: requireEnum(body.taxType, '税种', ['VAT', 'GST', 'SALES_TAX'] as const, 'VAT'),
    invoiceNo: requireText(body.invoiceNo, '发票号', 60),
    invoiceDate,
    counterparty: typeof body.counterparty === 'string' ? body.counterparty.trim().slice(0, 200) : '',
    currency: typeof body.currency === 'string' && body.currency ? body.currency.toUpperCase() : 'EUR',
    taxableAmount,
    taxRateBp,
    taxAmount: taxAmountOf(taxableAmount, taxRateBp),
    direction: requireEnum(body.direction, '进销项', ['INPUT', 'OUTPUT'] as const, 'OUTPUT'),
    status: requireEnum(body.status, '发票状态', ['DRAFT', 'FILED', 'PAID', 'VOID'] as const, 'DRAFT'),
    filingPeriod: body.filingPeriod ? requireText(body.filingPeriod, '申报期', 7) : taxPeriodOf(invoiceDate),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.taxInvoice.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('税务发票不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('发票已被他人修改，请刷新后重试。', 409);
      if (current.status === 'VOID') throw new WmsError('已作废发票不能再修改。', 409);
      const updated = await tx.taxInvoice.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'tax-invoice.update', id, { invoiceNo: draft.invoiceNo, taxAmount: draft.taxAmount });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.taxInvoice.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'tax-invoice.create', created.id, { invoiceNo: draft.invoiceNo, taxAmount: draft.taxAmount });
    return created;
  });
}

export async function computeTaxPeriod(scope: WmsScope, body: Record<string, unknown>) {
  const country = requireText(body.country, '国家/地区', 8).toUpperCase();
  const taxType = requireEnum(body.taxType, '税种', ['VAT', 'GST', 'SALES_TAX'] as const, 'VAT');
  const period = requireText(body.period, '申报期', 7);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'export');
    const where = scoped(scope);
    const invoices = await tx.taxInvoice.findMany({ where: { ...where, country, taxType, filingPeriod: period, status: { not: 'VOID' } } });
    if (!invoices.length) throw new WmsError('该申报期没有有效发票，无法归集。', 400);
    const taxableAmount = Math.round(invoices.reduce((sum, row) => sum + num(row.taxableAmount), 0) * 1_000_000) / 1_000_000;
    const taxAmount = Math.round(invoices.reduce((sum, row) => sum + num(row.taxAmount), 0) * 1_000_000) / 1_000_000;
    const saved = await tx.taxFilingPeriod.upsert({
      where: { organizationId_workspaceId_country_taxType_period: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, country, taxType, period } },
      create: { id: crypto.randomUUID(), ...where, country, taxType, period, taxableAmount, taxAmount, createdBy: scope.actorUserId },
      update: { taxableAmount, taxAmount, revision: { increment: 1 } },
    });
    await auditEntity(tx, scope, 'tax-period.compute', saved.id, { country, period, invoices: invoices.length });
    return { ...saved, invoiceCount: invoices.length };
  });
}

export async function fileTaxPeriod(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '申报期 ID', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'approve');
    const current = await tx.taxFilingPeriod.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('申报期不存在。', 404);
    if (current.status === 'FILED') throw new WmsError('该申报期已申报，不能重复操作。', 409);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('申报期已被他人修改，请刷新后重试。', 409);
    const reference = requireText(body.reference, '申报凭证号', 80);
    const updated = await tx.taxFilingPeriod.update({
      where: { id },
      data: { status: 'FILED', filedAt: new Date(), reference, revision: { increment: 1 } },
    });
    await tx.taxInvoice.updateMany({ where: { ...scoped(scope), country: current.country, taxType: current.taxType, filingPeriod: current.period, status: 'DRAFT' }, data: { status: 'FILED' } });
    await auditEntity(tx, scope, 'tax-period.file', id, { period: current.period, reference });
    return updated;
  });
}
