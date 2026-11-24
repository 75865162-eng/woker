import { prisma } from "@/lib/db/prisma";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { scoped } from "@/lib/wms/access";

/**
 * 亚马逊 SKU 成本录入 service（租户隔离 upsert）。
 * 纯亚马逊模块数据，不接赛狐。金额字符串保真，Decimal 存库。
 */

const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CCY_RE = /^[A-Z]{3}$/;
const MAX_ITEMS = 500;

export type SkuCostUpsert = {
  sku: string;
  asin?: string;
  costCurrency: string;
  purchaseCost: string;
  freightCost: string;
  otherCost: string;
  note?: string;
  effectiveAt?: string | null;
};

function dec(value: unknown, field: string): string {
  if (value === null || value === undefined || value === "") return "0";
  let s = String(value).trim();
  if (s.includes(",")) {
    if (s.includes(".")) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new WmsError(`${field} 须为非负数字。`, 400);
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new WmsError(`${field} 最多 6 位小数。`, 400);
  return s;
}

function parseEffectiveAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WmsError("生效日期格式须为 YYYY-MM-DD。", 400);
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 查询成本录入列表。 */
export async function querySkuCosts(scope: WmsScope, params: URLSearchParams) {
  const sku = params.get("sku")?.trim().slice(0, 128) ?? "";
  return prisma.amazonSkuCost.findMany({
    where: { ...scoped(scope), ...(sku ? { sku: { contains: sku } } : {}) },
    orderBy: [{ sku: "asc" }, { costCurrency: "asc" }],
    take: MAX_ITEMS,
  });
}

/** 批量 upsert 成本录入（SKU + 成本币种唯一）。 */
export async function mutateSkuCosts(scope: WmsScope, items: unknown) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new WmsError(`一次须提交 1–${MAX_ITEMS} 条成本记录。`, 400);
  }
  const parsed: SkuCostUpsert[] = items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new WmsError(`第 ${i + 1} 条记录格式无效。`, 400);
    const r = raw as Record<string, unknown>;
    const sku = String(r.sku ?? "").trim();
    const costCurrency = String(r.costCurrency ?? "").trim().toUpperCase();
    if (!SKU_RE.test(sku)) throw new WmsError(`第 ${i + 1} 条 SKU 无效。`, 400);
    if (!CCY_RE.test(costCurrency)) throw new WmsError(`第 ${i + 1} 条成本币种须为 3 位大写字母。`, 400);
    const asin = String(r.asin ?? "").trim().slice(0, 20);
    if (asin && !/^[A-Z0-9]{10}$/.test(asin.toUpperCase())) throw new WmsError(`第 ${i + 1} 条 ASIN 无效。`, 400);
    return {
      sku,
      asin: asin.toUpperCase(),
      costCurrency,
      purchaseCost: dec(r.purchaseCost, "采购成本"),
      freightCost: dec(r.freightCost, "头程成本"),
      otherCost: dec(r.otherCost, "其他成本"),
      note: String(r.note ?? "").trim().slice(0, 200),
      effectiveAt: parseEffectiveAt(r.effectiveAt)?.toISOString() ?? null,
    };
  });

  return prisma.$transaction(async tx => {
    const results = [];
    for (const p of parsed) {
      const data = {
        sku: p.sku,
        asin: p.asin ?? "",
        costCurrency: p.costCurrency,
        purchaseCost: p.purchaseCost,
        freightCost: p.freightCost,
        otherCost: p.otherCost,
        note: p.note ?? "",
        effectiveAt: p.effectiveAt ? new Date(p.effectiveAt) : null,
        createdBy: scope.actorUserId,
      };
      const item = await tx.amazonSkuCost.upsert({
        where: {
          organizationId_workspaceId_sku_costCurrency: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId,
            sku: p.sku, costCurrency: p.costCurrency,
          },
        },
        create: { ...data, ...scoped(scope) },
        update: { ...data },
      });
      results.push(item);
    }
    return { items: results, count: results.length };
  });
}

/** 删除单条成本录入。 */
export async function deleteSkuCost(scope: WmsScope, id: string) {
  const key = String(id ?? "").trim();
  if (!key) throw new WmsError("缺少成本记录 ID。", 400);
  const existing = await prisma.amazonSkuCost.findFirst({ where: { ...scoped(scope), id: key } });
  if (!existing) throw new WmsError("成本记录不存在。", 404);
  await prisma.amazonSkuCost.delete({ where: { id: key } });
  return { id: key, deleted: true };
}
