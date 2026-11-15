/**
 * 发票入账来源冒烟：在单个事务里造「采购单 + 已核准发票」，跑来源读取与科目草稿计算，
 * 断言金额与分录后整单回滚，不在库里留任何数据。
 * 用法：node --import ./scripts/runtime/database-bootstrap.mjs node_modules/tsx/dist/cli.mjs scripts/smoke-invoice-source.ts
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { readPurchaseInvoiceFinanceSource } from '@/lib/procurement/finance-source-query';
import { INVOICE_COST_ACCOUNT, INVOICE_INPUT_VAT_ACCOUNT, INVOICE_PAYABLE_ACCOUNT } from '@/lib/procurement/invoice-posting-rules';
import type { WmsScope } from '@/lib/wms/contracts';

const org = 'smoke-inv-org';
const ws = 'default';
const requester = 'smoke-inv-requester';
const approver = 'smoke-inv-approver';
const scope: WmsScope = { organizationId: org, workspaceId: ws, actorUserId: approver };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  let checks = 0;
  try {
    await prisma.$transaction(async tx => {
      await tx.organization.create({ data: { id: org, name: '发票冒烟', slug: 'smoke-inv' } });
      await tx.workspaceScope.create({ data: { organizationId: org, id: ws, name: '默认空间' } });
      await tx.user.create({ data: { id: requester, email: 'smoke-inv-r@example.com', name: '制单', passwordHash: 'x' } });
      await tx.user.create({ data: { id: approver, email: 'smoke-inv-a@example.com', name: '复核', passwordHash: 'x' } });
      await tx.supplier.create({ data: { id: 'smoke-inv-sup', organizationId: org, name: '冒烟供应商', normalizedName: 'maoyan-supplier' } });
      await tx.productRecord.create({ data: { id: 'smoke-inv-prod', organizationId: org, workspaceId: ws, userId: requester, sku: 'INV-SKU', payload: {} } });
      await tx.purchaseOrder.create({
        data: {
          id: 'smoke-inv-po', organizationId: org, workspaceId: ws, number: 'PO-SMOKE-1', supplierId: 'smoke-inv-sup',
          status: 'RECEIVING', currency: 'CNY', createdBy: requester, wmsReceiptIds: [],
        },
      });
      await tx.purchaseInvoice.create({
        data: {
          id: 'smoke-inv-doc', organizationId: org, workspaceId: ws, number: 'INV-SMOKE-1', supplierInvoiceNo: 'SUP-001',
          purchaseOrderId: 'smoke-inv-po', supplierId: 'smoke-inv-sup', currency: 'CNY', status: 'APPROVED', matchStatus: 'MATCHED',
          invoiceDate: new Date('2026-11-01T00:00:00Z'), subtotal: new Prisma.Decimal('1000.000000'), taxAmount: new Prisma.Decimal('130.000000'),
          totalAmount: new Prisma.Decimal('1130.000000'), createdBy: requester,
          lines: { create: [{ productRecordId: 'smoke-inv-prod', orderedQty: 100, receivedQty: 100, invoicedQty: 100, poUnitPrice: new Prisma.Decimal('10'), unitPrice: new Prisma.Decimal('10'), amount: new Prisma.Decimal('1000') }] },
        },
      });
      await tx.purchaseInvoiceApproval.create({
        data: {
          id: 'smoke-inv-approval', organizationId: org, workspaceId: ws, invoiceId: 'smoke-inv-doc', status: 'APPROVED',
          expectedRevision: 1, requestHash: 'smoke', requestedBy: requester, approvedBy: approver,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const source = await readPurchaseInvoiceFinanceSource(tx, scope, 'smoke-inv-doc');
      checks += 1;
      assert(source.sourceKey === 'PURCHASE-INVOICE:smoke-inv-doc', '来源标识应为发票命名空间');
      assert(source.sourceDate === '2026-11-01', '凭证日期取开票日');
      assert(source.lines.length === 3, '未收货时应生成成本、税额、应付三条分录');
      assert(source.lines[0].account === INVOICE_COST_ACCOUNT && source.lines[0].debit === '1000.000000', '成本按不含税金额一次确认');
      assert(source.lines[1].account === INVOICE_INPUT_VAT_ACCOUNT && source.lines[1].debit === '130.000000', '进项税单独列示');
      assert(source.lines[2].account === INVOICE_PAYABLE_ACCOUNT && source.lines[2].credit === '1130.000000', '应付按价税合计');
      const evidence = source.evidence as { bookedVoucherCount: number; supplierId: string; purchaseOrderId: string };
      checks += 1;
      assert(evidence.bookedVoucherCount === 0, '无收货计价时暂估为零');
      assert(evidence.supplierId === 'smoke-inv-sup' && evidence.purchaseOrderId === 'smoke-inv-po', '往来对象与采购单写入依据');

      // 未核准的发票不能入账
      await tx.purchaseInvoice.update({ where: { id: 'smoke-inv-doc' }, data: { status: 'DRAFT' } });
      let rejected = false;
      try { await readPurchaseInvoiceFinanceSource(tx, scope, 'smoke-inv-doc'); } catch { rejected = true; }
      checks += 1;
      assert(rejected, '草稿发票必须被拒绝');

      throw new Error('SMOKE_ROLLBACK');
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'SMOKE_ROLLBACK') throw error;
  }
  console.log(`发票入账冒烟通过：${checks} 组断言，事务已回滚，未落库。`);
  await prisma.$disconnect();
}

main().catch(async error => { console.error('发票入账冒烟失败：', error); await prisma.$disconnect(); process.exit(1); });
