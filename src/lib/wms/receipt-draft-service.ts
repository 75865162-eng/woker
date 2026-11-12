import { prisma } from "@/lib/db/prisma";
import { authorizeWms, auditWms, scoped, json } from "./access";
import { WmsError, type WmsScope } from "./contracts";
import { lockAggregate } from "./repository";
import { requireText, requireRevision, requirePositiveQuantity, strictKeys } from "./rules";

export async function updateReceiptDraft(scope: WmsScope, body: Record<string, unknown>) {
  strictKeys(body, ["id", "revision", "lines"]);
  const id = requireText(body.id, "收货单 ID");
  const revision = requireRevision(body.revision);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) throw new WmsError("请提交全部草稿明细。", 400);
  const lines = body.lines.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WmsError("明细格式无效。", 400);
    const line = raw as Record<string, unknown>;
    strictKeys(line, ["lineId", "expectedQty"]);
    return { lineId: requireText(line.lineId, "明细 ID"), expectedQty: requirePositiveQuantity(line.expectedQty) };
  });
  return prisma.$transaction(async tx => {
    await authorizeWms(tx, scope, "edit");
    await lockAggregate(tx, scope, id, "receipt");
    const receipt = await tx.wmsReceipt.findFirst({ where: { ...scoped(scope), id }, include: { lines: true } });
    if (!receipt) throw new WmsError("收货单不存在。", 404);
    if (receipt.createdBy !== scope.actorUserId) throw new WmsError("仅创建人可编辑草稿。", 403);
    if (receipt.status !== "DRAFT" || receipt.revision !== revision) throw new WmsError("收货单已变更或不再是草稿，请刷新。");
    if (await tx.purchaseOrder.findFirst({ where: { ...scoped(scope), wmsReceiptIds: { has: id } }, select: { id: true } })) throw new WmsError("收货单已关联采购单，不能修改计划数量。");
    if (lines.length !== receipt.lines.length || new Set(lines.map(line => line.lineId)).size !== lines.length || lines.some(line => !receipt.lines.some(stored => stored.id === line.lineId))) throw new WmsError("请提交本收货单的全部明细，不能重复或替换批次。", 422);
    const changes = lines.filter(line => receipt.lines.find(stored => stored.id === line.lineId)!.expectedQty !== line.expectedQty);
    if (!changes.length) return receipt;
    for (const line of changes) await tx.wmsReceiptLine.update({ where: { id: line.lineId }, data: { expectedQty: line.expectedQty, revision: { increment: 1 } } });
    await tx.wmsReceipt.update({ where: { id }, data: { revision: { increment: 1 } } });
    await auditWms(tx, scope, "receipts.edit-draft", id, json({ revision, lines: changes }));
    return tx.wmsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  });
}
