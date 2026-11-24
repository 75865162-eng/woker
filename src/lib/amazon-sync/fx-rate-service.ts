import { prisma } from "@/lib/db/prisma";
import { WmsError, type WmsScope } from "@/lib/wms/contracts";
import { scoped } from "@/lib/wms/access";

/**
 * 亚马逊汇率配置 service（租户隔离 upsert）。
 * 保守口径：用户显式录入，系统不自动抓汇率。纯亚马逊模块，不接赛狐。
 */

const CCY_RE = /^[A-Z]{3}$/;
const MAX_ITEMS = 200;

export type FxRateUpsert = {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  effectiveAt?: string | null;
  note?: string;
};

function parseRate(value: unknown): string {
  if (value === null || value === undefined || value === "") throw new WmsError("汇率不能为空。", 400);
  let s = String(value).trim();
  if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new WmsError("汇率须为正数。", 400);
  if (!/^\d+(\.\d{1,8})?$/.test(s)) throw new WmsError("汇率最多 8 位小数。", 400);
  return s;
}

function parseEffectiveAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new WmsError("生效日期格式须为 YYYY-MM-DD。", 400);
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function queryFxRates(scope: WmsScope) {
  return prisma.amazonFxRate.findMany({
    where: scoped(scope),
    orderBy: [{ fromCurrency: "asc" }, { toCurrency: "asc" }],
    take: MAX_ITEMS,
  });
}

export async function mutateFxRates(scope: WmsScope, items: unknown) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new WmsError(`一次须提交 1–${MAX_ITEMS} 条汇率记录。`, 400);
  }
  const parsed: FxRateUpsert[] = items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new WmsError(`第 ${i + 1} 条记录格式无效。`, 400);
    const r = raw as Record<string, unknown>;
    const fromCurrency = String(r.fromCurrency ?? "").trim().toUpperCase();
    const toCurrency = String(r.toCurrency ?? "").trim().toUpperCase();
    if (!CCY_RE.test(fromCurrency) || !CCY_RE.test(toCurrency)) throw new WmsError(`第 ${i + 1} 条币种须为 3 位大写字母。`, 400);
    if (fromCurrency === toCurrency) throw new WmsError(`第 ${i + 1} 条币种对不能相同。`, 400);
    return {
      fromCurrency, toCurrency,
      rate: parseRate(r.rate),
      effectiveAt: parseEffectiveAt(r.effectiveAt)?.toISOString() ?? null,
      note: String(r.note ?? "").trim().slice(0, 200),
    };
  });

  return prisma.$transaction(async tx => {
    const results = [];
    for (const p of parsed) {
      const data = {
        fromCurrency: p.fromCurrency,
        toCurrency: p.toCurrency,
        rate: p.rate,
        effectiveAt: p.effectiveAt ? new Date(p.effectiveAt) : null,
        note: p.note ?? "",
        createdBy: scope.actorUserId,
      };
      const item = await tx.amazonFxRate.upsert({
        where: {
          organizationId_workspaceId_fromCurrency_toCurrency: {
            organizationId: scope.organizationId, workspaceId: scope.workspaceId,
            fromCurrency: p.fromCurrency, toCurrency: p.toCurrency,
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

export async function deleteFxRate(scope: WmsScope, id: string) {
  const key = String(id ?? "").trim();
  if (!key) throw new WmsError("缺少汇率记录 ID。", 400);
  const existing = await prisma.amazonFxRate.findFirst({ where: { ...scoped(scope), id: key } });
  if (!existing) throw new WmsError("汇率记录不存在。", 404);
  await prisma.amazonFxRate.delete({ where: { id: key } });
  return { id: key, deleted: true };
}
