import { prisma } from "@/lib/db/prisma";
import { auditEntity, authorizeEntity, scoped } from "./access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { requireRevision, requireText } from "@/lib/wms/rules";
import { requireDate, requireEnum, requireInt, requireMoney } from "./rules";

export async function saveChannelAccount(scope: WmsScope, body: Record<string, unknown>) {
  const id = body.id ? requireText(body.id, '账号 ID', 64) : null;
  const draft = {
    channel: requireEnum(body.channel, '渠道', ['EBAY', 'WALMART', 'TEMU', 'TIKTOK', 'SHOPIFY', 'OTHER'] as const),
    name: requireText(body.name, '店铺名称', 80),
    sellerId: requireText(body.sellerId, '平台卖家 ID', 80),
    marketplace: typeof body.marketplace === 'string' ? body.marketplace.trim().toUpperCase().slice(0, 8) : '',
    credentialsRef: typeof body.credentialsRef === 'string' ? body.credentialsRef.trim().slice(0, 200) : '',
    status: requireEnum(body.status, '账号状态', ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const, 'ACTIVE'),
  };
  return prisma.$transaction(async tx => {
    const where = scoped(scope);
    if (id) {
      await authorizeEntity(tx, scope, 'edit');
      const current = await tx.multiChannelAccount.findFirst({ where: { ...where, id } });
      if (!current) throw new WmsError('渠道账号不存在。', 404);
      if (current.revision !== requireRevision(body.revision)) throw new WmsError('账号已被他人修改，请刷新后重试。', 409);
      const updated = await tx.multiChannelAccount.update({ where: { id }, data: { ...draft, revision: { increment: 1 } } });
      await auditEntity(tx, scope, 'channel-account.update', id, { channel: draft.channel });
      return updated;
    }
    await authorizeEntity(tx, scope, 'create');
    const created = await tx.multiChannelAccount.create({ data: { id: crypto.randomUUID(), ...where, ...draft, createdBy: scope.actorUserId } });
    await auditEntity(tx, scope, 'channel-account.create', created.id, { channel: draft.channel, sellerId: draft.sellerId });
    return created;
  });
}

export async function saveChannelOrder(scope: WmsScope, body: Record<string, unknown>) {
  const accountId = requireText(body.accountId, '渠道账号', 64);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'create');
    const where = scoped(scope);
    const account = await tx.multiChannelAccount.findFirst({ where: { ...where, id: accountId } });
    if (!account) throw new WmsError('渠道账号不存在或不属于当前工作区。', 400);
    const created = await tx.multiChannelOrder.create({
      data: {
        id: crypto.randomUUID(), ...where, accountId,
        channel: account.channel,
        externalOrderNo: requireText(body.externalOrderNo, '平台订单号', 80),
        sellerSku: requireText(body.sellerSku, 'SKU', 120),
        quantity: requireInt(body.quantity, '数量', { min: 1 }),
        currency: typeof body.currency === 'string' && body.currency ? body.currency.toUpperCase() : 'USD',
        amount: requireMoney(body.amount, '订单金额'),
        status: requireEnum(body.status, '订单状态', ['PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const, 'PENDING'),
        orderedAt: requireDate(body.orderedAt, '下单日期'),
        buyerCountry: typeof body.buyerCountry === 'string' ? body.buyerCountry.trim().toUpperCase().slice(0, 8) : '',
        trackingNo: typeof body.trackingNo === 'string' ? body.trackingNo.trim().slice(0, 80) : '',
        createdBy: scope.actorUserId,
      },
    });
    await auditEntity(tx, scope, 'channel-order.create', created.id, { channel: account.channel, orderNo: created.externalOrderNo });
    return created;
  });
}

export async function transitionChannelOrder(scope: WmsScope, body: Record<string, unknown>) {
  const id = requireText(body.id, '订单 ID', 64);
  const status = requireEnum(body.status, '订单状态', ['SHIPPED', 'DELIVERED', 'CANCELLED'] as const);
  return prisma.$transaction(async tx => {
    await authorizeEntity(tx, scope, 'edit');
    const current = await tx.multiChannelOrder.findFirst({ where: { ...scoped(scope), id } });
    if (!current) throw new WmsError('渠道订单不存在。', 404);
    if (current.revision !== requireRevision(body.revision)) throw new WmsError('订单已被他人修改，请刷新后重试。', 409);
    if (current.status === 'CANCELLED') throw new WmsError('已取消订单不能再流转。', 409);
    const updated = await tx.multiChannelOrder.update({
      where: { id },
      data: { status, revision: { increment: 1 }, ...(typeof body.trackingNo === 'string' && body.trackingNo ? { trackingNo: body.trackingNo.trim().slice(0, 80) } : {}) },
    });
    await auditEntity(tx, scope, 'channel-order.transition', id, { from: current.status, to: status });
    return updated;
  });
}
