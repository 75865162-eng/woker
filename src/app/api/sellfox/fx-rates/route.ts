import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { buildFxMap, availableDisplayCurrencies, type ReviewedFxRate } from "@/lib/sellfox/display-fx";

export const runtime = "nodejs";

/**
 * 只读已复核汇率：仅 ACTIVE 且 reviewedBy 非空的汇率进入前端展示换算，
 * 绝不返回草稿/未复核记录，避免把未经审计的汇率用于金额展示。
 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  if (!process.env.DATABASE_URL) return NextResponse.json({ rates: [], currencies: [] });

  const scope = workspaceScopeFromRequest(request);
  try {
    const records = await prisma.financeExchangeRate.findMany({
      where: {
        organizationId: permission.user.organizationId,
        workspaceId: scope.workspaceId,
        status: "ACTIVE",
        reviewedBy: { not: null },
      },
      select: { sourceCurrency: true, targetCurrency: true, rate: true, reference: true, observedAt: true },
      orderBy: { observedAt: "desc" },
      take: 500,
    });
    const rates: ReviewedFxRate[] = records.map((row) => ({
      sourceCurrency: row.sourceCurrency,
      targetCurrency: row.targetCurrency,
      rate: Number(row.rate),
      reference: row.reference,
      observedAt: row.observedAt.toISOString(),
    }));
    const map = buildFxMap(rates);
    return NextResponse.json({
      rates: [...map.values()],
      currencies: availableDisplayCurrencies(map),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "汇率读取失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
