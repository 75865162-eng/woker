/**
 * WIMOOR 页面功能迁移：通用主数据 / 业务单据数据层。
 *
 * 设计原则（架构红线）：
 * - 租户隔离：所有读写强制带 organizationId + workspaceId。
 * - 不造数：初始为空，只有用户显式创建才有数据；查询不返回伪造默认值。
 * - 幂等：写操作按唯一键 upsert，重复提交不产生重复行。
 * - 审计：记录 createdBy/updatedBy。
 * - kind 区分类型：标签/品牌/品类/辅料/包材/库位/凭证字等共用一张表。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { scoped, json } from "@/lib/wms/access";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";

const MAX_ROWS = 500;

export type EntryInput = {
  code: string;
  name: string;
  parentCode?: string | null;
  color?: string | null;
  status?: string;
  sortOrder?: number;
  payload?: Record<string, unknown>;
};

export type DocumentInput = {
  docNo: string;
  status?: string;
  partnerCode?: string | null;
  businessDate?: string | null;
  amount?: string | null;
  currency?: string | null;
  remark?: string | null;
  payload?: Record<string, unknown>;
};

function requireScope(scope: WmsScope) {
  if (!scope?.organizationId || !scope?.workspaceId) throw new WmsError("缺少租户上下文。", 403);
}

function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== "string" || !value.trim()) throw new WmsError(`${label}不能为空。`, 422);
  const s = value.trim();
  if (s.length > max) throw new WmsError(`${label}过长。`, 422);
  return s;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new WmsError(`${label}格式无效。`, 422);
  if (value.length > max) throw new WmsError(`${label}过长。`, 422);
  return value;
}

// ---------------------------------------------------------------------------
// 主数据条目（标签 / 品牌 / 品类 / 辅料 / 包材 / 库位 / 凭证字 / 部门 ...）
// ---------------------------------------------------------------------------

export async function queryEntries(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const kind = text(params.get("kind"), "数据类型", 64);
  const parentCode = params.get("parentCode") || undefined;
  const search = (params.get("search") || "").trim();
  const take = Math.min(MAX_ROWS, Math.max(1, Number(params.get("pageSize") ?? 100) || 100));
  const where: Prisma.MasterDataEntryWhereInput = {
    ...scoped(scope), kind,
    ...(parentCode ? { parentCode } : {}),
    ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { code: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.masterDataEntry.findMany({
    where, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], take,
  });
  return {
    kind, rows,
    basis: "主数据由用户在页面显式创建；未创建时为空，不返回伪造默认值。按 kind + parentCode 过滤，租户隔离。",
  };
}

export async function mutateEntries(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const action = String(body.action ?? "");
  const kind = text(body.kind, "数据类型", 64);

  if (action === "upsert") {
    const input = body.input as EntryInput;
    if (!input || typeof input !== "object") throw new WmsError("数据内容无效。", 422);
    const code = text(input.code, "编码", 128);
    const name = text(input.name, "名称", 256);
    const status = input.status ?? "ACTIVE";
    if (!["ACTIVE", "INACTIVE"].includes(status)) throw new WmsError("状态无效。", 422);
    const row = await prisma.masterDataEntry.upsert({
      where: {
        organizationId_workspaceId_kind_code: { ...scoped(scope), kind, code },
      },
      create: {
        id: crypto.randomUUID(), ...scoped(scope), kind, code, name, status,
        parentCode: optionalText(input.parentCode, "父级编码", 128),
        color: optionalText(input.color, "颜色", 32),
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0,
        payload: input.payload ? json(input.payload) : undefined,
        createdBy: scope.actorUserId, updatedBy: scope.actorUserId,
      },
      update: {
        name, status,
        parentCode: optionalText(input.parentCode, "父级编码", 128),
        color: optionalText(input.color, "颜色", 32),
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0,
        payload: input.payload ? json(input.payload) : undefined,
        updatedBy: scope.actorUserId,
      },
    });
    return { action, row };
  }

  if (action === "delete") {
    const code = text(body.code, "编码", 128);
    // 软删除：置为 INACTIVE，保留历史引用，不物理删除
    const row = await prisma.masterDataEntry.update({
      where: { organizationId_workspaceId_kind_code: { ...scoped(scope), kind, code } },
      data: { status: "INACTIVE", updatedBy: scope.actorUserId },
    });
    return { action, row };
  }

  throw new WmsError("不支持的操作。", 400);
}

// ---------------------------------------------------------------------------
// 业务单据（加工单 / 换货单 / 发货准备 / 盘点单 / 库存调整 ...）
// ---------------------------------------------------------------------------

export async function queryDocuments(scope: WmsScope, params: URLSearchParams) {
  requireScope(scope);
  const kind = text(params.get("kind"), "单据类型", 64);
  const status = params.get("status") || undefined;
  const search = (params.get("search") || "").trim();
  const take = Math.min(MAX_ROWS, Math.max(1, Number(params.get("pageSize") ?? 100) || 100));
  const where: Prisma.MasterDataDocumentWhereInput = {
    ...scoped(scope), kind,
    ...(status ? { status } : {}),
    ...(search ? { OR: [{ docNo: { contains: search, mode: "insensitive" } }, { partnerCode: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.masterDataDocument.findMany({
    where, orderBy: [{ createdAt: "desc" }], take,
  });
  return {
    kind, rows,
    basis: "业务单据由用户在页面显式创建；状态流转需按动作推进，不自动过账。租户隔离。",
  };
}

export async function mutateDocuments(scope: WmsScope, body: Record<string, unknown>) {
  requireScope(scope);
  const action = String(body.action ?? "");
  const kind = text(body.kind, "单据类型", 64);

  if (action === "upsert") {
    const input = body.input as DocumentInput;
    if (!input || typeof input !== "object") throw new WmsError("单据内容无效。", 422);
    const docNo = text(input.docNo, "单号", 128);
    let amount: Prisma.Decimal | undefined;
    if (input.amount !== undefined && input.amount !== null && input.amount !== "") {
      const n = Number(input.amount);
      if (!Number.isFinite(n)) throw new WmsError("金额格式无效。", 422);
      amount = new Prisma.Decimal(input.amount as string);
    }
    const row = await prisma.masterDataDocument.upsert({
      where: { organizationId_workspaceId_kind_docNo: { ...scoped(scope), kind, docNo } },
      create: {
        id: crypto.randomUUID(), ...scoped(scope), kind, docNo,
        status: input.status ?? "DRAFT",
        partnerCode: optionalText(input.partnerCode, "往来单位", 128),
        businessDate: optionalText(input.businessDate, "业务日期", 10),
        amount,
        currency: input.currency ? optionalText(input.currency, "币种", 3) : null,
        remark: optionalText(input.remark, "备注", 1024),
        payload: input.payload ? json(input.payload) : undefined,
        createdBy: scope.actorUserId, updatedBy: scope.actorUserId,
      },
      update: {
        ...(input.status ? { status: input.status } : {}),
        partnerCode: optionalText(input.partnerCode, "往来单位", 128),
        businessDate: optionalText(input.businessDate, "业务日期", 10),
        ...(amount !== undefined ? { amount } : {}),
        currency: input.currency ? optionalText(input.currency, "币种", 3) : null,
        remark: optionalText(input.remark, "备注", 1024),
        payload: input.payload ? json(input.payload) : undefined,
        updatedBy: scope.actorUserId,
      },
    });
    return { action, row };
  }

  if (action === "transition") {
    const docNo = text(body.docNo, "单号", 128);
    const to = text(body.to, "目标状态", 32);
    const allowed = ["DRAFT", "SUBMITTED", "APPROVED", "COMPLETED", "CANCELLED"];
    if (!allowed.includes(to)) throw new WmsError("目标状态无效。", 422);
    const row = await prisma.masterDataDocument.update({
      where: { organizationId_workspaceId_kind_docNo: { ...scoped(scope), kind, docNo } },
      data: { status: to, updatedBy: scope.actorUserId },
    });
    return { action, row };
  }

  throw new WmsError("不支持的操作。", 400);
}
