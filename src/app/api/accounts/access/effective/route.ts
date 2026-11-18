import { NextResponse } from "next/server";
import { requireAccessView } from "@/lib/accounts/access-api-guard";
import { getEffectiveAccess } from "@/lib/accounts/effective-access";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId 必填。" }, { status: 400 });
  }

  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: guard.user.organizationId, userId } },
    select: { role: true },
  });
  if (!member) {
    return NextResponse.json({ error: "该用户不属于当前组织。" }, { status: 404 });
  }

  const effective = await getEffectiveAccess({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    userId,
    roleId: member.role,
  });

  // 缺口提示：授予了数据类模块但无对应数据范围；MCP 工具已授但无店铺授权。
  const gaps: string[] = [];
  const needsAmazon = ["products", "workspace", "operations"].some((id) => Boolean(effective.modules[id]?.length));
  const needsSellfox = Boolean(effective.modules.sellfox?.length);
  if (needsAmazon && !effective.amazon.allSellers && effective.amazon.sellers.length === 0) {
    gaps.push("已授予数据类模块，但没有任何 Amazon 店铺数据范围。");
  }
  if (needsSellfox && !effective.sellfox.allStores && effective.sellfox.stores.length === 0) {
    gaps.push("已授予 Sellfox 模块，但没有任何店铺数据范围。");
  }
  const mcpEnabled = effective.mcp.some((entry) => entry.tools.length > 0);
  if (mcpEnabled && !effective.amazon.allSellers && !effective.sellfox.allStores && effective.amazon.sellers.length === 0 && effective.sellfox.stores.length === 0) {
    gaps.push("MCP 工具已授权，但没有店铺数据范围，工具调用可能被拒。");
  }

  return NextResponse.json({ effective, sources: effective.sources, gaps });
}
